import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3VectorsClient, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';

const REGION = process.env.REGION ?? 'ap-northeast-1';
const EMBEDDING_MODEL_ID = process.env.EMBEDDING_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';
const VECTOR_BUCKET_NAME = process.env.VECTOR_BUCKET_NAME!;
const VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_NAME ?? 'documents';
const RAW_UPLOAD_BUCKET = process.env.RAW_UPLOAD_BUCKET!;

const bedrockClient = new BedrockRuntimeClient({ region: REGION });
const s3VectorsClient = new S3VectorsClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });

// -------------------------------------------------------
// テキストをチャンクに分割 (スライディングウィンドウ)
// -------------------------------------------------------
function splitIntoChunks(text: string, chunkSize = 500, overlap = 50): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);

  let buffer = '';
  for (const para of paragraphs) {
    if ((buffer + para).length > chunkSize && buffer.length > 0) {
      chunks.push(buffer.trim());
      buffer = buffer.slice(-overlap) + '\n\n' + para;
    } else {
      buffer = buffer ? buffer + '\n\n' + para : para;
    }
  }
  if (buffer.trim().length > 0) chunks.push(buffer.trim());

  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= chunkSize) {
      finalChunks.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += chunkSize - overlap) {
        finalChunks.push(chunk.slice(i, i + chunkSize));
      }
    }
  }

  return finalChunks.filter((c) => c.trim().length > 5);
}

// -------------------------------------------------------
// Titan Embeddings V2 でテキストをベクトル化
// -------------------------------------------------------
async function embedText(text: string): Promise<number[]> {
  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: EMBEDDING_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify({
        inputText: text.slice(0, 8000),
        dimensions: 1024,
        normalize: true,
      })),
    }),
  );
  const body = JSON.parse(new TextDecoder().decode(response.body)) as { embedding: number[] };
  return body.embedding;
}

// -------------------------------------------------------
// SQS トリガー Lambda ハンドラー
//
// メッセージ: { s3Key: string; source: string; userId: string }
// 処理: S3 からコンテンツ取得 → チャンク分割 → Titan Embeddings → S3 Vectors への書き込み
// 処理完了後は一時ファイルを S3 から削除する
// エラー時は失敗メッセージ ID を返し、SQS がリトライ後 DLQ へ送る
// -------------------------------------------------------
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const { s3Key, source, userId, tags = [], isPublic = false } = JSON.parse(record.body) as {
        s3Key: string;
        source: string;
        userId: string;
        tags?: string[];
        isPublic?: boolean;
      };

      // S3 から一時アップロードファイルを読み込む
      const s3Response = await s3Client.send(
        new GetObjectCommand({ Bucket: RAW_UPLOAD_BUCKET, Key: s3Key }),
      );
      const content = await s3Response.Body!.transformToString('utf-8');

      if (!content?.trim()) {
        console.warn(`[${record.messageId}] content が空のため スキップ (s3Key: ${s3Key})`);
        await s3Client.send(new DeleteObjectCommand({ Bucket: RAW_UPLOAD_BUCKET, Key: s3Key }));
        continue; // 空コンテンツは成功扱い (DLQ に送らない)
      }

      const chunks = splitIntoChunks(content);
      if (chunks.length === 0) {
        console.warn(`[${record.messageId}] チャンク分割結果が0件 (source: ${source})`);
        await s3Client.send(new DeleteObjectCommand({ Bucket: RAW_UPLOAD_BUCKET, Key: s3Key }));
        continue;
      }

      console.log(`[${record.messageId}] "${source}" を ${chunks.length} チャンクに分割 (userId: ${userId})`);

      // 埋め込みベクトル生成 (同時実行数 5 でスロットリング対策)
      const EMBED_CONCURRENCY = 5;
      const createdAt = new Date().toISOString();
      // isPublic = true の場合はキーを public/ プレフィックスにし、ownerId を metadata に含める
      const keyPrefix = isPublic ? 'public' : userId;
      const vectors: Array<{
        key: string;
        data: { float32: number[] };
        metadata: { text: string; source: string; userId: string; ownerId: string; isPublic: boolean; chunkIndex: number; createdAt: string; tags?: string[] };
      }> = new Array(chunks.length);

      for (let i = 0; i < chunks.length; i += EMBED_CONCURRENCY) {
        const batch = chunks.slice(i, i + EMBED_CONCURRENCY);
        const embeddings = await Promise.all(batch.map((chunk) => embedText(chunk)));
        embeddings.forEach((embedding, j) => {
          const idx = i + j;
          vectors[idx] = {
            key: `${keyPrefix}/${crypto.randomUUID()}`,
            data: { float32: embedding },
            // S3 Vectors は空配列を metadata に許容しないため tags が空の場合は省略する
            metadata: { text: chunks[idx], source, userId, ownerId: userId, isPublic, chunkIndex: idx, createdAt, ...(tags.length > 0 ? { tags } : {}) },
          };
        });
      }

      // S3 Vectors への一括書き込み (25 件ずつバッチ)
      const BATCH_SIZE = 25;
      for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
        await s3VectorsClient.send(
          new PutVectorsCommand({
            vectorBucketName: VECTOR_BUCKET_NAME,
            indexName: VECTOR_INDEX_NAME,
            vectors: vectors.slice(i, i + BATCH_SIZE),
          }),
        );
      }

      // 処理完了後に一時ファイルを削除
      await s3Client.send(new DeleteObjectCommand({ Bucket: RAW_UPLOAD_BUCKET, Key: s3Key }));

      console.log(`[${record.messageId}] ${vectors.length} チャンクを S3 Vectors に書き込み完了`);
    } catch (err) {
      console.error(`[${record.messageId}] 処理エラー:`, err);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
