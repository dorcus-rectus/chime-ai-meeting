import { S3VectorsClient, ListVectorsCommand, DeleteVectorsCommand } from '@aws-sdk/client-s3vectors';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const REGION = process.env.REGION ?? 'ap-northeast-1';
const VECTOR_BUCKET_NAME = process.env.VECTOR_BUCKET_NAME!;
const VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_NAME ?? 'documents';

const s3VectorsClient = new S3VectorsClient({ region: REGION });

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function ok(body: unknown, status = 200): APIGatewayProxyResult {
  return { statusCode: status, headers, body: JSON.stringify(body) };
}
function err(message: string, status = 500): APIGatewayProxyResult {
  return { statusCode: status, headers, body: JSON.stringify({ error: message }) };
}

type VectorEntry = {
  key: string;
  isPublic: boolean;
  metadata: { source: string; text: string; chunkIndex: number; createdAt: string; tags?: string[]; ownerId?: string; userId?: string; isPublic?: boolean };
};

// -------------------------------------------------------
// ユーザーが管理できるベクトルを取得 (ページネーション対応)
// - private: ${userId}/ プレフィックス
// - public (自分が作成したもの): public/ プレフィックス + ownerId === userId
// -------------------------------------------------------
async function listUserManagedVectors(userId: string): Promise<VectorEntry[]> {
  const vectors: VectorEntry[] = [];
  let nextToken: string | undefined;

  do {
    const res = await s3VectorsClient.send(new ListVectorsCommand({
      vectorBucketName: VECTOR_BUCKET_NAME,
      indexName: VECTOR_INDEX_NAME,
      returnMetadata: true,
      returnData: false,
      ...(nextToken ? { nextToken } : {}),
    }));

    for (const v of res.vectors ?? []) {
      const meta = v.metadata as VectorEntry['metadata'];
      const isPrivate = v.key?.startsWith(`${userId}/`);
      const isOwnedPublic = v.key?.startsWith('public/') && meta?.ownerId === userId;
      if (isPrivate || isOwnedPublic) {
        vectors.push({
          key: v.key!,
          isPublic: isOwnedPublic ?? false,
          metadata: meta,
        });
      }
    }
    nextToken = res.nextToken;
  } while (nextToken);

  return vectors;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub as string | undefined;
  if (!userId) return err('認証情報が取得できませんでした', 401);

  // -------------------------------------------------------
  // GET /documents — ドキュメント一覧 (source 別に集約)
  // -------------------------------------------------------
  if (event.httpMethod === 'GET') {
    try {
      const vectors = await listUserManagedVectors(userId);

      // source 別に集約
      const docMap = new Map<string, { source: string; chunks: number; createdAt: string; keys: string[]; tags: string[]; isPublic: boolean }>();
      for (const v of vectors) {
        const source = v.metadata?.source ?? '不明';
        const existing = docMap.get(source);
        const chunkTags = v.metadata?.tags ?? [];
        if (existing) {
          existing.chunks += 1;
          existing.keys.push(v.key);
          // 最新の createdAt を保持
          if (v.metadata?.createdAt && v.metadata.createdAt > existing.createdAt) {
            existing.createdAt = v.metadata.createdAt;
          }
          // タグを重複排除してマージ
          for (const tag of chunkTags) {
            if (!existing.tags.includes(tag)) existing.tags.push(tag);
          }
        } else {
          docMap.set(source, {
            source,
            chunks: 1,
            createdAt: v.metadata?.createdAt ?? '',
            keys: [v.key],
            tags: [...chunkTags],
            isPublic: v.isPublic,
          });
        }
      }

      const documents = Array.from(docMap.values()).sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt),
      );

      return ok({ documents, total: vectors.length });
    } catch (e) {
      console.error('GET /documents error:', e);
      return err('ドキュメント一覧の取得に失敗しました');
    }
  }

  // -------------------------------------------------------
  // DELETE /documents — ドキュメント削除 (source 指定)
  // -------------------------------------------------------
  if (event.httpMethod === 'DELETE') {
    try {
      const body = event.body ? (JSON.parse(event.body) as { source?: string; keys?: string[] }) : {};
      const { source, keys: directKeys } = body;

      let keysToDelete: string[] = [];

      if (directKeys && directKeys.length > 0) {
        // キーを直接指定して削除: private (${userId}/) は直接許可、public/ はオーナー確認が必要
        const publicDirectKeys = directKeys.filter((k) => k.startsWith('public/'));
        const privateDirectKeys = directKeys.filter((k) => k.startsWith(`${userId}/`));
        // public keys はオーナー確認のため一覧取得
        if (publicDirectKeys.length > 0) {
          const allVectors = await listUserManagedVectors(userId);
          const ownedPublicKeys = new Set(allVectors.filter((v) => v.isPublic).map((v) => v.key));
          keysToDelete = [...privateDirectKeys, ...publicDirectKeys.filter((k) => ownedPublicKeys.has(k))];
        } else {
          keysToDelete = privateDirectKeys;
        }
      } else if (source) {
        // source 名で一致するチャンクを全削除
        const vectors = await listUserManagedVectors(userId);
        keysToDelete = vectors.filter((v) => v.metadata?.source === source).map((v) => v.key);
      }

      if (keysToDelete.length === 0) {
        return ok({ deleted: 0, message: '削除対象のドキュメントが見つかりませんでした' });
      }

      // 25 件ずつ削除 (API 上限対策)
      const BATCH_SIZE = 25;
      let deleted = 0;
      const errors: string[] = [];
      for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
        const batch = keysToDelete.slice(i, i + BATCH_SIZE);
        try {
          await s3VectorsClient.send(new DeleteVectorsCommand({
            vectorBucketName: VECTOR_BUCKET_NAME,
            indexName: VECTOR_INDEX_NAME,
            keys: batch,
          }));
          deleted += batch.length;
        } catch (batchErr) {
          console.error(`DeleteVectors バッチ失敗 (offset=${i}):`, batchErr);
          errors.push(`batch[${i}..${i + batch.length - 1}]`);
        }
      }

      if (errors.length > 0) {
        return {
          statusCode: 207,
          headers,
          body: JSON.stringify({
            deleted,
            message: `${deleted} チャンクを削除しました (一部失敗: ${errors.join(', ')})`,
          }),
        };
      }
      return ok({ deleted, message: `${deleted} チャンクを削除しました` });
    } catch (e) {
      console.error('DELETE /documents error:', e);
      return err('ドキュメントの削除に失敗しました');
    }
  }

  return err('許可されていないメソッドです', 405);
};
