import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const REGION = process.env.REGION ?? 'ap-northeast-1';
const INGEST_QUEUE_URL = process.env.INGEST_QUEUE_URL!;

const sqsClient = new SQSClient({ region: REGION });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

// -------------------------------------------------------
// Lambda ハンドラー
// POST /documents { content: string, source: string }
//
// 入力を検証し SQS キューに送信して即座に 202 を返す。
// 実際の埋め込み生成・S3 Vectors 書き込みは
// ingest-document-worker Lambda が非同期で処理する。
// -------------------------------------------------------
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const userId = event.requestContext.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: '認証が必要です' }),
    };
  }

  try {
    const body = JSON.parse(event.body ?? '{}') as { content?: string; source?: string; tags?: unknown[]; isPublic?: boolean };
    const { content, source = '不明なドキュメント', tags: rawTags, isPublic = false } = body;

    if (!content?.trim() || content.trim().length < 10) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'content フィールドに有効なテキストが必要です (10文字以上)' }),
      };
    }
    if (typeof source === 'string' && source.length > 500) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'source フィールドは 500 文字以内にしてください' }),
      };
    }

    // タグのバリデーション: 最大 10 件、各 50 文字以内、文字列のみ
    const tags: string[] = Array.isArray(rawTags)
      ? rawTags
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim().slice(0, 50))
          .slice(0, 10)
      : [];

    // SQS メッセージサイズ上限は 256KB。大きいドキュメントはエラー
    const messageBody = JSON.stringify({ content: content.trim(), source, userId, tags, isPublic });
    if (Buffer.byteLength(messageBody, 'utf8') > 250_000) {
      return {
        statusCode: 413,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'ドキュメントが大きすぎます (上限 250KB)。分割して登録してください' }),
      };
    }

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: INGEST_QUEUE_URL,
        MessageBody: messageBody,
        MessageAttributes: {
          source: { DataType: 'String', StringValue: source },
          userId: { DataType: 'String', StringValue: userId },
        },
      }),
    );

    console.log(`ドキュメント登録リクエストをキューに送信 (source: "${source}", userId: ${userId})`);

    return {
      statusCode: 202,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'ドキュメントの登録リクエストを受け付けました。数秒後に AI が参照できるようになります',
        source,
      }),
    };
  } catch (error) {
    console.error('ドキュメント登録キュー送信エラー:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'ドキュメントの登録に失敗しました' }),
    };
  }
};
