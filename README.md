# AI ビデオ会議システム — Amazon Chime SDK × Bedrock AgentCore

Amazon Chime SDK と Amazon Bedrock AgentCore (Claude Sonnet 4.6) を組み合わせた、**話しかけると AI が音声で応答するリアルタイムビデオ会議システム**です。

## 主な機能

| 機能 | 詳細 |
|------|------|
| **AI 会話** | Bedrock AgentCore (Claude Sonnet 4.6) がセッション履歴を自動管理 |
| **音声認識** | Amazon Transcribe (ja-JP) でリアルタイム書き起こし |
| **音声応答** | Amazon Polly Neural TTS (Kazuha) で AI の発話を合成 |
| **RAG** | S3 Vectors + Titan Embeddings V2 で社内ドキュメントを参照 |
| **ユーザー管理** | Cognito によるメール認証・新規登録・アカウント削除 |
| **ビデオ会議** | Amazon Chime SDK でリアルタイムビデオ通話 |

## アーキテクチャ

```
ブラウザ (React + Amplify Hosting)
  ├── Amazon Chime SDK JS (ビデオ会議・音声)
  │     └── Amazon Transcribe (書き起こし ja-JP)
  ├── API Gateway (REST + Cognito Authorizer)
  │     ├── POST /meetings  → Lambda: create-meeting → Chime SDK Meetings
  │     ├── POST /ai-chat   → Lambda: ai-chat
  │     │     ├── S3 Vectors RAG (Titan Embeddings V2)
  │     │     ├── Bedrock AgentCore InvokeAgent (会話履歴自動管理)
  │     │     └── Amazon Polly Neural TTS → Base64 MP3
  │     ├── POST /documents → Lambda: ingest-document → S3 Vectors
  │     ├── GET  /users     → Lambda: user-management → Cognito
  │     └── DELETE /users   → Lambda: user-management → Cognito
  └── Amazon Cognito (認証・ユーザー管理)
```

## セットアップ

### 前提条件

- Node.js 20+
- AWS CLI (設定済み)
- Bedrock モデルアクセス有効化:
  - `anthropic.claude-sonnet-4-6-20251001-v1:0`
  - `amazon.titan-embed-text-v2:0`

### デプロイ

```bash
# 1. CDK Bootstrap (初回のみ)
cd cdk && npm install && npx cdk bootstrap

# 2. ワンコマンドデプロイ
cd ..
bash deploy.sh
```

### ローカル開発

```bash
# フロントエンド
cd frontend
cp .env.local.example .env.local  # API URL, Cognito 設定を記入
npm install && npm run dev        # localhost:3000
```

`.env.local` の設定:
```
VITE_API_URL=https://xxxx.execute-api.ap-northeast-1.amazonaws.com/prod
VITE_COGNITO_USER_POOL_ID=ap-northeast-1_xxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

## ディレクトリ構成

```
.
├── cdk/
│   ├── lib/chime-ai-meeting-stack.ts  # CDK スタック (Bedrock Agent 含む)
│   └── lambda/
│       ├── create-meeting/index.ts    # 会議作成
│       ├── ai-chat/index.ts           # AgentCore 呼び出し + Polly TTS
│       ├── ingest-document/index.ts   # RAG インデックス構築
│       └── user-management/index.ts   # ユーザー情報取得・削除
├── frontend/
│   └── src/
│       ├── App.tsx                    # 画面遷移 (LoginScreen/MeetingRoom/UserProfile)
│       ├── hooks/
│       │   ├── useAuth.ts             # 認証・アカウント削除
│       │   ├── useMeeting.ts          # Chime SDK セッション管理
│       │   └── useAIConversation.ts   # AI 会話・音声再生
│       └── components/
│           ├── LoginScreen.tsx        # ログイン・新規登録・確認コード
│           ├── MeetingRoom.tsx        # メイン会議画面
│           ├── UserProfile.tsx        # アカウント設定・削除
│           ├── AIParticipant.tsx      # AI アバター
│           └── DocumentUpload.tsx     # RAG ドキュメント登録
├── deploy.sh                          # デプロイスクリプト
└── article.md                         # Zenn/Qiita 向けブログ記事
```

## Bedrock AgentCore について

本システムでは、従来の Bedrock Converse API の代わりに **Amazon Bedrock AgentCore** を使用しています。

**主な変更点:**
- `BedrockRuntimeClient + ConverseCommand` → `BedrockAgentRuntimeClient + InvokeAgentCommand`
- 会話履歴を DynamoDB で自前管理 → **AgentCore が sessionId で自動管理**
- Lambda コードがシンプルに (会話履歴の読み書きコードが不要)

```typescript
// AgentCore 呼び出し例
const response = await agentClient.send(new InvokeAgentCommand({
  agentId: AGENT_ID,
  agentAliasId: AGENT_ALIAS_ID,
  sessionId,    // Chime MeetingId をそのまま使用
  inputText,    // RAG コンテキスト付きのユーザー発言
}));

// ストリーミングレスポンスを結合
let aiText = '';
for await (const event of response.completion!) {
  if (event.chunk?.bytes) aiText += new TextDecoder().decode(event.chunk.bytes);
}
```

## ユーザー管理機能

### 新規登録フロー

1. LoginScreen の「新規登録」タブでメールアドレス・パスワードを入力
2. Cognito がメールに確認コードを送信
3. 確認コード入力でアカウント確定
4. 自動的にログイン画面へ遷移

### アカウント削除フロー

1. 会議室またはロビーの「アカウント設定」ボタン
2. UserProfile 画面で「アカウントを削除する」
3. 確認のため「DELETE」と入力
4. API 経由で Cognito ユーザーを削除 + DynamoDB データを削除
5. 自動サインアウト

## ライセンス

MIT License — 詳細は [LICENSE](LICENSE) を参照
