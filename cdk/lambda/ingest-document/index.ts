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
// POST /documents { s3Key: string, source: string }
//
// フロントエンドが S3 署名付き URL でアップロードした後に呼び出す。
// s3Key の所有者検証を行い、SQS キューに送信して 202 を返す。
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
    const body = JSON.parse(event.body ?? '{}') as { s3Key?: string; source?: string; tags?: unknown[]; isPublic?: boolean };
    const { s3Key, source = '不明なドキュメント', tags: rawTags, isPublic = false } = body;

    if (!s3Key?.trim()) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 's3Key フィールドが必要です' }),
      };
    }

    // セキュリティ: s3Key は get-upload-url が発行した ${userId}/${uuid} 形式のみ許可
    // 他ユーザーの s3Key を指定してファイルを横取りすることを防ぐ
    if (!s3Key.startsWith(`${userId}/`)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: '不正な s3Key です' }),
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

    // SQS メッセージには s3Key のみ含める (コンテンツ本体は S3 に格納済み)
    const messageBody = JSON.stringify({ s3Key, source, userId, tags, isPublic });

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

    console.log(`ドキュメント登録リクエストをキューに送信 (source: "${source}", userId: ${userId}, s3Key: ${s3Key})`);

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
