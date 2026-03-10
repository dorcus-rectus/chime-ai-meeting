import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const REGION = process.env.REGION ?? 'ap-northeast-1';
const RAW_UPLOAD_BUCKET = process.env.RAW_UPLOAD_BUCKET!;

const s3Client = new S3Client({ region: REGION });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Content-Type': 'application/json',
};

// -------------------------------------------------------
// Lambda ハンドラー
// GET /documents/upload-url
//
// 認証済みユーザーに対して S3 署名付き PUT URL を発行する。
// フロントエンドはこの URL に直接テキストを PUT することで
// API Gateway / SQS のサイズ制限 (256KB) を回避できる。
// s3Key は ${userId}/${uuid} 形式で生成し、
// ingest-document Lambda で所有者検証に使用する。
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
    const s3Key = `${userId}/${crypto.randomUUID()}`;
    const command = new PutObjectCommand({
      Bucket: RAW_UPLOAD_BUCKET,
      Key: s3Key,
      ContentType: 'text/plain',
    });
    // 署名付き URL の有効期限: 5 分 (アップロード完了に十分な時間)
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ uploadUrl, s3Key }),
    };
  } catch (error) {
    console.error('署名付き URL 生成エラー:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: '署名付き URL の生成に失敗しました' }),
    };
  }
};
