# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Amazon Chime SDK + **Amazon Bedrock AgentCore** を使った AI ビデオ会議システム。ユーザー認証 (Cognito)、ユーザー管理 (登録・削除)、RAG (S3 Vectors + Titan Embeddings)、利用記録 (DynamoDB) を備える。

- `cdk/` — AWS CDK インフラ (TypeScript)、ap-northeast-1
- `frontend/` — React + Vite フロントエンド、Amplify Hosting

---

## CDK (`cdk/`)

### コマンド

```bash
cd cdk
npm install
npx cdk bootstrap  # 初回のみ
npx cdk deploy     # デプロイ
npx cdk diff       # 差分確認
npx cdk synth      # CloudFormation テンプレート確認
```

### スタック構成 (`ChimeAiMeetingStack`)

**認証・ユーザー管理**
- Cognito User Pool: メールアドレス + パスワード認証、セルフサインアップ有効
- Cognito User Pool Client: SPA 用 (クライアントシークレットなし)
- API Gateway Cognito Authorizer: 全エンドポイントに適用
- Lambda `user-management`: GET/DELETE /users (ユーザー情報取得・アカウント削除)

**Bedrock AgentCore**
- Bedrock Agent (`CfnAgent`): Claude Sonnet 4.6 を基盤モデルとして使用、`autoPrepare: true`
- Bedrock AgentAlias (`CfnAgentAlias`): `prod` エイリアスで Lambda から呼び出し
- AgentCore 専用 IAM ロール: `bedrock.amazonaws.com` がアシュームする (Lambda ロールとは別)
- AgentCore がセッション ID で会話履歴を自動管理 → DynamoDB への会話履歴読み書きが不要

**データストア**
- DynamoDB `ChimeAiConversations`: 後方互換用に保持 (AgentCore が会話管理を担当)
- DynamoDB `ChimeAiUsageRecords`: PK=`userId` / SK=`YYYYMMDD#uuid`、GSI=`sessionId-index`

**RAG**
- S3 Vectors バケット: `chime-ai-vectors-${account}` — AwsCustomResource で作成
- S3 Vectors インデックス: `documents`、1024次元 (Titan Embeddings V2)、コサイン距離

**API エンドポイント (全て Cognito 認証必須)**
- `POST /meetings` → `chime-ai-create-meeting` Lambda
- `POST /ai-chat` → `chime-ai-chat` Lambda
- `POST /documents` → `chime-ai-ingest-document` Lambda
- `GET /users` → `chime-ai-user-management` Lambda
- `DELETE /users` → `chime-ai-user-management` Lambda

**Lambda 共通環境変数**
| 変数名 | 内容 |
|--------|------|
| `BEDROCK_AGENT_ID` | Bedrock AgentCore エージェント ID |
| `BEDROCK_AGENT_ALIAS_ID` | Bedrock AgentCore エイリアス ID |
| `EMBEDDING_MODEL_ID` | `amazon.titan-embed-text-v2:0` |
| `CONVERSATION_TABLE` | DynamoDB テーブル名 (後方互換用) |
| `USAGE_TABLE` | DynamoDB テーブル名 |
| `VECTOR_BUCKET_NAME` | S3 Vectors バケット名 |
| `VECTOR_INDEX_NAME` | `documents` |
| `USER_POOL_ID` | Cognito User Pool ID |

Lambda TypeScript (`cdk/lambda/`) は CDK `tsconfig.json` から除外されており esbuild が個別にバンドル。`externalModules: []` で AWS SDK を含む全依存をバンドル。

---

## Lambda 関数

### `ai-chat/index.ts` — Bedrock AgentCore を使った AI 会話処理

1. Cognito claims から `userId` を取得
2. ユーザー発話を Titan Embeddings V2 でベクトル化
3. S3 Vectors で上位3件の類似チャンクを検索 (RAG)
4. RAG コンテキストを inputText に付加して **AgentCore InvokeAgent** を呼び出し
   - `sessionId` = Chime MeetingId (UUID) → AgentCore がセッション単位で会話履歴を自動管理
   - レスポンスは AsyncIterable — `for await` でチャンクを結合
5. Polly Kazuha (Neural) で音声合成 → Base64 MP3
6. 利用記録を DynamoDB に非同期保存

**Converse API との主な違い:**
- `BedrockRuntimeClient + ConverseCommand` → `BedrockAgentRuntimeClient + InvokeAgentCommand`
- DynamoDB への会話履歴の読み書きが不要 (AgentCore が管理)
- レスポンスがストリーミング形式 (AsyncIterable)

### `ingest-document/index.ts` — RAG インデックス構築

1. `POST /documents { content, source }` を受け取る
2. テキストをスライディングウィンドウでチャンク分割 (500字、50字オーバーラップ)
3. 各チャンクを Titan Embeddings V2 でベクトル化
4. S3 Vectors に 25件ずつバッチ書き込み

### `user-management/index.ts` — ユーザー管理 (新規)

- `GET /users`: Cognito AdminGetUser でユーザー情報取得
- `DELETE /users`: Cognito AdminDeleteUser でアカウント削除 + DynamoDB データ削除
  - JWT の `sub` クレームで本人確認 (他人のアカウントは削除不可)
  - 削除後はフロントエンドで `signOut()` を呼び出してセッションをクリア

---

## フロントエンド (`frontend/`)

### コマンド

```bash
cd frontend
npm install
npm run dev        # localhost:3000
npm run build      # dist/ に出力
```

### 画面構成

```
App (認証ゲート + 画面遷移 useState)
├── LoginScreen (ログイン・新規登録・メール確認コード入力)
├── UserProfile (アカウント設定・削除) ← 新規
└── MeetingRoom (useMeeting + useAIConversation を結合)
    ├── AIParticipant (AI アバター)
    └── DocumentUpload (RAG テキスト登録)
```

### 認証フロー (`useAuth`)

- `signIn` / `signOut` / `signUp` / `confirmSignUp`: 既存機能
- `deleteAccount` (新規): DELETE /users を呼び出して Cognito ユーザー削除後 `signOut()`
- `getIdToken()`: `fetchAuthSession()` → `tokens.idToken` → API ヘッダーに付与

### 画面遷移

`App.tsx` の `showProfile` state で制御:
- `unauthenticated` → LoginScreen
- `authenticated + showProfile=true` → UserProfile
- `authenticated + showProfile=false` → MeetingRoom

---

## デプロイ

```bash
bash deploy.sh  # CDK デプロイ + フロントエンドビルド + Amplify 手動デプロイ
```

**デプロイ前提条件:**
1. AWS CLI 設定済み
2. Bedrock コンソールで以下のモデルアクセスを有効化:
   - `jp.anthropic.claude-sonnet-4-6` (Claude Sonnet 4.6)
   - `amazon.titan-embed-text-v2:0` (Titan Embeddings V2)
3. S3 Vectors が ap-northeast-1 で利用可能なことを確認

---

## 重要な制約

- **AgentCore sessionId**: 英数字・ハイフン・アンダースコアのみ、最大 100 文字。Chime MeetingId (UUID) は条件を満たす
- **AgentCore レスポンス**: `InvokeAgent` は AsyncIterable を返す。`for await` でチャンクを結合すること
- **AgentCore autoPrepare**: `true` に設定しないとエイリアス作成時にエラーになる
- **Chime SDK は HTTPS または localhost でのみマイクが動作**
- **Cognito Authorizer**: Lambda の `event.requestContext.authorizer.claims.sub` が userId
- **S3 Vectors の API 名**: `@aws-sdk/client-s3-vectors` の操作名は公式ドキュメントで要確認
- **Polly Kazuha**: 日本語 Neural 音声。男性音声に変えたい場合は `VoiceId` を `Takumi` に変更
- **アカウント削除後のセッション**: `AdminDeleteUser` はサーバー側のみ削除。フロントエンドで明示的に `signOut()` を呼ぶこと
