import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3VectorsClient, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const REGION = process.env.REGION ?? 'ap-northeast-1';
const AGENT_ID = process.env.BEDROCK_AGENT_ID!;
const AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID!;
const EMBEDDING_MODEL_ID = process.env.EMBEDDING_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';
const USAGE_TABLE = process.env.USAGE_TABLE!;
const VECTOR_BUCKET_NAME = process.env.VECTOR_BUCKET_NAME!;
const VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_NAME ?? 'documents';

// AgentCore Runtime クライアント (会話管理・AI 応答生成)
const agentClient = new BedrockAgentRuntimeClient({ region: REGION });
// Bedrock クライアント (Titan Embeddings による RAG ベクトル化のみ使用)
const bedrockClient = new BedrockRuntimeClient({ region: REGION });
const pollyClient = new PollyClient({ region: REGION });
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3VectorsClient = new S3VectorsClient({ region: REGION });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

// -------------------------------------------------------
// Titan Embeddings V2 でテキストをベクトル化 (RAG クエリ用)
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
// S3 Vectors から関連ドキュメントチャンクを検索 (RAG)
// -------------------------------------------------------
async function retrieveContext(queryText: string, topK = 3): Promise<string> {
  try {
    const queryVector = await embedText(queryText);
    const result = await s3VectorsClient.send(
      new QueryVectorsCommand({
        vectorBucketName: VECTOR_BUCKET_NAME,
        indexName: VECTOR_INDEX_NAME,
        queryVector: { float32: queryVector },
        topK: topK,
        returnMetadata: true,
      }),
    );
    if (!result.vectors || result.vectors.length === 0) return '';
    return result.vectors.map((v, i) => {
      const meta = v.metadata as { text?: string; source?: string } | undefined;
      return `[${i + 1}] (出典: ${meta?.source ?? '不明'})\n${meta?.text ?? ''}`;
    }).join('\n\n');
  } catch (err) {
    console.warn('RAG 検索失敗 (フォールバック):', err);
    return '';
  }
}

// -------------------------------------------------------
// Bedrock AgentCore Runtime を呼び出して AI 応答を生成
//
// frameBase64 が渡された場合は sessionState.files に JPEG を添付し、
// AgentCore (Claude Sonnet 4.6 Vision) が画面を直接解析して回答する。
// AgentCore はセッション ID で会話履歴を自動管理するため、
// DynamoDB への会話履歴の読み書きが不要になります。
// -------------------------------------------------------
async function invokeAgent(
  sessionId: string,
  inputText: string,
  frameBase64?: string,
): Promise<string> {
  const command = new InvokeAgentCommand({
    agentId: AGENT_ID,
    agentAliasId: AGENT_ALIAS_ID,
    sessionId,          // AgentCore がこの ID でセッションを識別・管理
    inputText,
    enableTrace: false,
    // 画面共有フレームが存在する場合はマルチモーダル入力として渡す
    // useCase: 'CHAT' により会話コンテキスト内で画像を参照可能
    ...(frameBase64
      ? {
          sessionState: {
            files: [
              {
                name: 'screen-capture.jpg',
                source: {
                  byteContent: {
                    data: Buffer.from(frameBase64, 'base64'),
                    mediaType: 'image/jpeg',
                  },
                  sourceType: 'BYTE_CONTENT',
                },
                useCase: 'CHAT',
              },
            ],
          },
        }
      : {}),
  });

  const response = await agentClient.send(command);

  // AgentCore のレスポンスはストリーミング形式 — chunk イベントを結合
  let aiText = '';
  for await (const event of response.completion!) {
    if (event.chunk?.bytes) {
      aiText += new TextDecoder().decode(event.chunk.bytes);
    }
  }
  return aiText.trim() || 'すみません、うまく聞き取れませんでした。もう一度お話しください。';
}

// -------------------------------------------------------
// DynamoDB に利用記録を保存 (非同期・失敗しても本体処理を継続)
// -------------------------------------------------------
async function recordUsage(params: {
  userId: string;
  sessionId: string;
  userMessage: string;
  aiResponse: string;
  ragUsed: boolean;
  frameAnalyzed: boolean;
}): Promise<void> {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  await ddbClient.send(
    new PutCommand({
      TableName: USAGE_TABLE,
      Item: {
        userId: params.userId,
        sk: `${dateStr}#${crypto.randomUUID()}`,
        sessionId: params.sessionId,
        userMessage: params.userMessage.slice(0, 1000),
        aiResponse: params.aiResponse.slice(0, 1000),
        ragUsed: params.ragUsed,
        frameAnalyzed: params.frameAnalyzed,
        timestamp: now.toISOString(),
      },
    }),
  );
}

// -------------------------------------------------------
// Lambda ハンドラー
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
    const body = JSON.parse(event.body ?? '{}') as {
      text?: string;
      sessionId?: string;
      frame?: string; // 画面共有フレーム (Base64 JPEG, オプション)
    };
    const { text, sessionId, frame } = body;

    if (!text?.trim()) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'text フィールドが必要です' }),
      };
    }
    if (!sessionId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'sessionId フィールドが必要です' }),
      };
    }

    // --- 1. RAG: S3 Vectors で関連ドキュメントを検索 ---
    // 画面共有フレームがある場合は RAG をスキップ (画像解析を優先)
    const ragContext = frame ? '' : await retrieveContext(text);

    // inputText の組み立て:
    //   - 画面共有あり: 画面フレームはマルチモーダルで渡すため、テキストで「画面を見ながら回答して」と指示
    //   - RAG コンテキストあり: 参考情報を付加
    //   - それ以外: ユーザー発話のみ
    // XML タグでユーザー入力を分離 → プロンプトインジェクション対策
    const inputText = frame
      ? `共有中の画面フレームを確認しながら、以下のユーザーの発言に日本語で答えてください。\n<user_input>\n${text || '（この画面について教えてください）'}\n</user_input>`
      : ragContext
        ? `[参考情報]\n<context>\n${ragContext}\n</context>\n\nユーザーの発言を元に回答してください。\n<user_input>\n${text}\n</user_input>`
        : `<user_input>\n${text}\n</user_input>`;

    // --- 2. Bedrock AgentCore Runtime でAI 応答を生成 ---
    // sessionId = Chime MeetingId (UUID形式) → AgentCore がセッション単位で会話履歴を管理
    // frame が存在する場合は sessionState.files 経由でマルチモーダル送信
    const aiText = await invokeAgent(sessionId, inputText, frame);

    // --- 3. Polly で音声合成 ---
    const pollyResponse = await pollyClient.send(
      new SynthesizeSpeechCommand({
        Engine: 'neural',
        OutputFormat: 'mp3',
        VoiceId: 'Kazuha',
        LanguageCode: 'ja-JP',
        Text: aiText.slice(0, 2800),
      }),
    );
    const audioBytes = await pollyResponse.AudioStream!.transformToByteArray();
    const audioBase64 = Buffer.from(audioBytes).toString('base64');

    // --- 4. 利用記録を DynamoDB に保存 (非同期) ---
    recordUsage({
      userId,
      sessionId,
      userMessage: text,
      aiResponse: aiText,
      ragUsed: ragContext.length > 0,
      frameAnalyzed: !!frame,
    }).catch((err) => console.error('利用記録保存エラー:', err));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        text: aiText,
        audio: audioBase64,
        ragUsed: ragContext.length > 0,
      }),
    };
  } catch (error) {
    console.error('AI チャットエラー:', error);
    const isNotFound =
      error instanceof Error && error.name === 'ResourceNotFoundException';
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: isNotFound
          ? `AgentCore エージェントが見つかりません。CDK デプロイと Bedrock コンソールのモデルアクセスを確認してください。`
          : 'AI の応答生成に失敗しました',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
