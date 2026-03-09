import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3VectorsClient, ListVectorsCommand, DeleteVectorsCommand } from '@aws-sdk/client-s3vectors';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const REGION = process.env.REGION ?? 'ap-northeast-1';
const USER_POOL_ID = process.env.USER_POOL_ID!;
const CONVERSATION_TABLE = process.env.CONVERSATION_TABLE!;
const USAGE_TABLE = process.env.USAGE_TABLE!;
const VECTOR_BUCKET_NAME = process.env.VECTOR_BUCKET_NAME!;
const VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_NAME ?? 'documents';

const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3VectorsClient = new S3VectorsClient({ region: REGION });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS',
  'Content-Type': 'application/json',
};

// -------------------------------------------------------
// ユーザーの DynamoDB データを削除 (BatchWriteCommand で効率化)
// -------------------------------------------------------
async function deleteUserData(userId: string): Promise<void> {
  const [convResult, usageResult] = await Promise.all([
    ddbClient.send(
      new QueryCommand({
        TableName: CONVERSATION_TABLE,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
      }),
    ),
    ddbClient.send(
      new QueryCommand({
        TableName: USAGE_TABLE,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
      }),
    ),
  ]);

  const BATCH_SIZE = 25; // DynamoDB BatchWrite の上限

  // 各テーブルを 25 件ずつバッチ削除 (WCU 消費を抑制しスロットリングを防止)
  const batches: Array<Promise<unknown>> = [];

  const convItems = convResult.Items ?? [];
  for (let i = 0; i < convItems.length; i += BATCH_SIZE) {
    const batch = convItems.slice(i, i + BATCH_SIZE).map((item) => ({
      DeleteRequest: { Key: { userId: item.userId as string, sessionId: item.sessionId as string } },
    }));
    batches.push(ddbClient.send(new BatchWriteCommand({ RequestItems: { [CONVERSATION_TABLE]: batch } })));
  }

  const usageItems = usageResult.Items ?? [];
  for (let i = 0; i < usageItems.length; i += BATCH_SIZE) {
    const batch = usageItems.slice(i, i + BATCH_SIZE).map((item) => ({
      DeleteRequest: { Key: { userId: item.userId as string, sk: item.sk as string } },
    }));
    batches.push(ddbClient.send(new BatchWriteCommand({ RequestItems: { [USAGE_TABLE]: batch } })));
  }

  await Promise.all(batches);
}

// -------------------------------------------------------
// ユーザーの S3 Vectors データを削除 (private + 所有する public)
// -------------------------------------------------------
async function deleteUserVectors(userId: string): Promise<void> {
  const keysToDelete: string[] = [];
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
      const isPrivate = v.key?.startsWith(`${userId}/`);
      const meta = v.metadata as { ownerId?: string } | undefined;
      const isOwnedPublic = v.key?.startsWith('public/') && meta?.ownerId === userId;
      if (isPrivate || isOwnedPublic) {
        keysToDelete.push(v.key!);
      }
    }
    nextToken = res.nextToken;
  } while (nextToken);

  if (keysToDelete.length === 0) return;

  const BATCH_SIZE = 25;
  for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
    await s3VectorsClient.send(new DeleteVectorsCommand({
      vectorBucketName: VECTOR_BUCKET_NAME,
      indexName: VECTOR_INDEX_NAME,
      keys: keysToDelete.slice(i, i + BATCH_SIZE),
    }));
  }
  console.log(`S3 Vectors: ${keysToDelete.length} 件削除 (userId: ${userId})`);
}

// -------------------------------------------------------
// Lambda ハンドラー
//
// GET  /users  → ユーザー情報取得
// DELETE /users → アカウント削除 (Cognito + DynamoDB データ)
// -------------------------------------------------------
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Cognito Authorizer が検証済みの claims から userId と username を取得
  const userId = event.requestContext.authorizer?.claims?.sub as string | undefined;
  const cognitoUsername = event.requestContext.authorizer?.claims?.['cognito:username'] as
    | string
    | undefined;
  const email = event.requestContext.authorizer?.claims?.email as string | undefined;

  if (!userId) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: '認証が必要です' }),
    };
  }

  // GET /users — ユーザー情報を返す
  if (event.httpMethod === 'GET') {
    try {
      const user = await cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: cognitoUsername ?? userId,
        }),
      );
      const emailAttr = user.UserAttributes?.find((a) => a.Name === 'email')?.Value;
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          userId,
          email: emailAttr ?? email ?? '',
          status: user.UserStatus,
          createdAt: user.UserCreateDate?.toISOString(),
        }),
      };
    } catch (error) {
      console.error('ユーザー情報取得エラー:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'ユーザー情報の取得に失敗しました' }),
      };
    }
  }

  // DELETE /users — アカウントを削除
  if (event.httpMethod === 'DELETE') {
    try {
      // 1. Cognito からユーザーを削除
      await cognitoClient.send(
        new AdminDeleteUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: cognitoUsername ?? userId,
        }),
      );

      // 2. DynamoDB のユーザーデータを削除 (非同期・失敗しても続行)
      deleteUserData(userId).catch((err) =>
        console.error('DynamoDB ユーザーデータ削除エラー:', err),
      );
      // 3. S3 Vectors のユーザーデータを削除 (非同期・失敗しても続行)
      deleteUserVectors(userId).catch((err) =>
        console.error('S3 Vectors ユーザーデータ削除エラー:', err),
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'アカウントを削除しました' }),
      };
    } catch (error) {
      console.error('アカウント削除エラー:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'アカウントの削除に失敗しました' }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'Method Not Allowed' }),
  };
};
