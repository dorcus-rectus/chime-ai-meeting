# AI ビデオ会議システム — Amazon Chime SDK × Bedrock AgentCore

Amazon Chime SDK と Amazon Bedrock AgentCore (Claude Sonnet 4.6) を組み合わせた、**話しかけると AI が音声で応答するリアルタイムビデオ会議システム**です。

## 主な機能

| 機能 | 詳細 |
|------|------|
| **AI 会話** | Bedrock AgentCore (Claude Sonnet 4.6) がセッション履歴を自動管理 |
| **音声認識** | Amazon Transcribe (ja-JP) でリアルタイム書き起こし / Web Speech API フォールバック |
| **音声応答** | Amazon Polly Neural TTS (Kazuha) で AI の発話を合成 |
| **RAG** | S3 Vectors + Titan Embeddings V2 + SQS 非同期インジェスト |
| **RAG 管理** | ドキュメント一覧・削除・PDF/テキストファイル登録対応 |
| **画面共有解析** | Canvas キャプチャ → AgentCore Vision (マルチモーダル) |
| **カメラ自動認識** | 発話にカメラ関連キーワード (カメラ/映像/顔/どう見え...) が含まれた時のみローカルカメラフレームを AI に送信 |
| **無音検知 UX** | 3 秒無音またはミュート時 (pendingText あり) に確認ダイアログ表示、編集・送信・破棄が可能 |
| **AI アバター** | aibot.mp4 ループ再生 + CSS AR エフェクト (解析中スキャンライン) |
| **ユーザー管理** | Cognito Admin API によるメール認証・新規登録・アカウント削除 |
| **ビデオ会議** | Amazon Chime SDK でリアルタイムビデオ通話 (VoiceFocus ノイズキャンセル) |
| **テスト** | Vitest 31 テスト + Playwright E2E + ESLint exhaustive-deps |

## アーキテクチャ

```
ブラウザ (React + Amplify Hosting)
  ├── Amazon Chime SDK JS (ビデオ会議・音声)
  │     └── Amazon Transcribe (書き起こし ja-JP)
  ├── API Gateway (REST + Cognito Authorizer)
  │     ├── POST /meetings        → Lambda: create-meeting → Chime SDK Meetings
  │     ├── POST /ai-chat         → Lambda: ai-chat
  │     │     ├── S3 Vectors RAG (Titan Embeddings V2)
  │     │     ├── Bedrock AgentCore InvokeAgent (会話履歴自動管理)
  │     │     └── Amazon Polly Neural TTS → Base64 MP3
  │     ├── POST /documents       → Lambda: ingest-document → SQS → ingest-document-worker → S3 Vectors
  │     ├── GET  /documents       → Lambda: manage-documents → S3 Vectors (一覧)
  │     ├── DELETE /documents     → Lambda: manage-documents → S3 Vectors (削除)
  │     ├── GET  /users           → Lambda: user-management → Cognito
  │     └── DELETE /users         → Lambda: user-management → Cognito
  └── Amazon Cognito (認証・ユーザー管理)
```

## セットアップ

### 前提条件

- Node.js 24+
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
│       ├── create-meeting/index.ts         # 会議作成
│       ├── ai-chat/index.ts                # AgentCore 呼び出し + Polly TTS
│       ├── ingest-document/index.ts        # RAG 受付 (SQS 送信 → 202)
│       ├── ingest-document-worker/index.ts # RAG インデックス構築 (SQS 非同期)
│       ├── manage-documents/index.ts       # RAG 一覧・削除 (GET/DELETE /documents)
│       └── user-management/index.ts        # ユーザー情報取得・削除
├── frontend/
│   ├── src/
│   │   ├── App.tsx                    # 画面遷移 (LoginScreen/MeetingRoom/UserProfile/RAGManagement)
│   │   ├── hooks/
│   │   │   ├── useAuth.ts             # 認証・アカウント削除
│   │   │   ├── useMeeting.ts          # Chime SDK + 無音検知ダイアログ
│   │   │   ├── useAIConversation.ts   # AI 会話・音声再生 (AudioContext race condition 対策済み)
│   │   │   └── useScreenShare.ts      # 画面共有・フレームキャプチャ
│   │   ├── components/
│   │   │   ├── LoginScreen.tsx        # ログイン・新規登録・確認コード
│   │   │   ├── MeetingRoom.tsx        # メイン会議画面
│   │   │   ├── UserProfile.tsx        # アカウント設定・削除
│   │   │   ├── AIParticipant.tsx      # AI アバター (aibot.mp4 + AR エフェクト)
│   │   │   ├── DocumentUpload.tsx     # RAG ドキュメント登録 (PDF / テキストファイル対応)
│   │   │   └── RAGManagement.tsx      # RAG 管理画面 (一覧・削除・追加登録)
│   │   └── __tests__/                 # Vitest 単体テスト (31 tests)
│   ├── e2e/                           # Playwright E2E テスト
│   ├── tsconfig.app.json              # ビルド用 tsconfig
│   └── tsconfig.test.json             # テスト用 tsconfig (@types/node)
├── architecture.drawio                # AWS アーキテクチャ図 (Draw.io)
├── deploy.sh                          # デプロイスクリプト
├── customHttp.yml                     # Amplify HTTP ヘッダー (CSP/HSTS/キャッシュ)
└── article.md                         # Qiita 向けブログ記事
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

## RAG 管理機能

### ドキュメント登録 (PDF / テキストファイル対応)

`DocumentUpload` コンポーネントは以下の形式に対応:
- `.txt`, `.md`, `.csv`, `.log` — テキストとして直接読み込み
- `.pdf` — `pdfjs-dist` でページごとにテキスト抽出

登録後は SQS 非同期処理でベクトルインデックスを構築 (API Gateway の 29 秒制限を回避)。

### RAG 管理画面

ナビゲーションの「RAG 管理」ボタンから遷移。

| 操作 | API |
|------|-----|
| ドキュメント一覧表示 | `GET /documents` |
| ドキュメント削除 | `DELETE /documents { source }` |
| ドキュメント追加 | `POST /documents` (DocumentUpload コンポーネント) |

S3 Vectors のキーを `${userId}/uuid` 形式で管理することで、ユーザーごとの文書スコープが実現されています。

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
