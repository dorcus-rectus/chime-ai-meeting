import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3VectorsClient, PutVectorsCommand } from '@aws-sdk/client-s3vectors';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const REGION = process.env.REGION ?? 'ap-northeast-1';
const EMBEDDING_MODEL_ID = process.env.EMBEDDING_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';
const VECTOR_BUCKET_NAME = process.env.VECTOR_BUCKET_NAME!;
const VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_NAME ?? 'documents';

const bedrockClient = new BedrockRuntimeClient({ region: REGION });
const s3VectorsClient = new S3VectorsClient({ region: REGION });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

// -------------------------------------------------------
// テキストをチャンクに分割 (スライディングウィンドウ)
// -------------------------------------------------------
function splitIntoChunks(text: string, chunkSize = 500, overlap = 50): string[] {
  const chunks: string[] = [];
  // まず段落単位で分割し、長い段落はさらに分割する
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);

  let buffer = '';
  for (const para of paragraphs) {
    if ((buffer + para).length > chunkSize && buffer.length > 0) {
      chunks.push(buffer.trim());
      // オーバーラップ: 前チャンクの末尾をバッファに残す
      buffer = buffer.slice(-overlap) + '\n\n' + para;
    } else {
      buffer = buffer ? buffer + '\n\n' + para : para;
    }
  }
  if (buffer.trim().length > 0) {
    chunks.push(buffer.trim());
  }

  // 段落が非常に長い場合は文字数で強制分割
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

  return finalChunks.filter((c) => c.length > 20); // 短すぎるチャンクを除外
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
  const body = JSON.parse(new TextDecoder().decode(response.body)) as {
    embedding: number[];
  };
  return body.embedding;
}

// -------------------------------------------------------
// Lambda ハンドラー
// POST /documents { content: string, source: string }
// -------------------------------------------------------
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Cognito Authorizer 検証済み userId
  const userId = event.requestContext.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: '認証が必要です' }) };
  }

  try {
    const body = JSON.parse(event.body ?? '{}') as {
      content?: string;
      source?: string;
    };
    const { content, source = '不明なドキュメント' } = body;

    if (!content?.trim() || content.trim().length < 10) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'content フィールドに有効なテキストが必要です (10文字以上)' }),
      };
    }

    // --- 1. テキストをチャンクに分割 ---
    const chunks = splitIntoChunks(content);
    if (chunks.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'テキストを解析できませんでした' }),
      };
    }

    console.log(`ドキュメント "${source}" を ${chunks.length} チャンクに分割 (userId: ${userId})`);

    // --- 2. 各チャンクを埋め込みベクトルに変換し S3 Vectors へ格納 ---
    // 同時実行数を 5 に制限して Bedrock スロットリングを回避しつつ並列処理し、
    // API Gateway の 29 秒タイムアウト内に完了させる。
    const EMBED_CONCURRENCY = 5;
    const createdAt = new Date().toISOString();
    const vectors: Array<{
      key: string;
      data: { float32: number[] };
      metadata: { text: string; source: string; userId: string; chunkIndex: number; createdAt: string };
    }> = new Array(chunks.length);

    for (let i = 0; i < chunks.length; i += EMBED_CONCURRENCY) {
      const batch = chunks.slice(i, i + EMBED_CONCURRENCY);
      const embeddings = await Promise.all(batch.map((chunk) => embedText(chunk)));
      embeddings.forEach((embedding, j) => {
        const idx = i + j;
        vectors[idx] = {
          key: `${userId}/${crypto.randomUUID()}`,
          data: { float32: embedding },
          metadata: { text: chunks[idx], source, userId, chunkIndex: idx, createdAt },
        };
      });
    }

    // --- 3. S3 Vectors に一括書き込み (25件ずつバッチ処理) ---
    const BATCH_SIZE = 25;
    let storedCount = 0;
    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
      const batch = vectors.slice(i, i + BATCH_SIZE);
      await s3VectorsClient.send(
        new PutVectorsCommand({
          vectorBucketName: VECTOR_BUCKET_NAME,
          indexName: VECTOR_INDEX_NAME,
          vectors: batch,
        }),
      );
      storedCount += batch.length;
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'ドキュメントのインデックス登録が完了しました',
        source,
        chunks: storedCount,
      }),
    };
  } catch (error) {
    console.error('ドキュメント取り込みエラー:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'ドキュメントの取り込みに失敗しました',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
