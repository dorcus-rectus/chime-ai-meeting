# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Amazon Chime SDK + **Amazon Bedrock AgentCore** を使った AI ビデオ会議システム。ユーザー認証 (Cognito)、ユーザー管理 (登録・削除)、RAG (S3 Vectors + Titan Embeddings)、RAG 管理 (一覧・削除)、PDF/テキストファイル登録、画面共有フレーム解析 (AgentCore Vision)、SQS 非同期インジェスト、利用記録 (DynamoDB) を備える。

- `cdk/` — AWS CDK インフラ (TypeScript)、ap-northeast-1
- `frontend/` — React 19 + Vite 7 フロントエンド、Amplify Hosting

---

## 開発方針: TDD (テスト駆動開発)

本プロジェクトでは **フロントエンド・CDK ともに TDD** を基本とする。

### TDD サイクル (Red → Green → Refactor)

1. **Red**: 失敗するテストを先に書く
2. **Green**: テストが通る最小限の実装をする
3. **Refactor**: テストを維持しながらコードを整理する

### CDK テスト

```bash
cd cdk
npm test              # 全テスト実行 (53件)
npm run test:watch    # ウォッチモード
npm run test:update   # スナップショット更新
```

- **スナップショットテスト**: `Template.fromStack(stack).toJSON()` で全体を検証。インフラ変更時は `npm run test:update` でベースラインを更新する
- **Fine-grained Assertions**: `template.hasResourceProperties()` で重要なリソースのプロパティを個別検証
- **cdk-nag**: `AwsSolutionsChecks` で AWS Well-Architected Framework 準拠を自動監査。既知の違反は `NagSuppressions` で理由を明記して抑制

**CDK 変更時のルール:**
- 新リソースを追加したら対応する単体テストを追加する
- スタック変更後は `npm run test:update` でスナップショットを更新してコミットする
- cdk-nag 違反が出たら修正するか、理由を明記した上で `NagSuppressions` に追加する

### フロントエンド テスト

```bash
cd frontend
npm test              # Vitest 全テスト実行
npm run test -- --run # CI モード (ウォッチなし)
```

- **Vitest + React Testing Library**: コンポーネント・フックの単体テスト
- **Playwright E2E**: ログイン画面・スクリーンショット回帰テスト (`frontend/e2e/`)
- 新コンポーネント追加時は `frontend/src/__tests__/` に対応テストを先に書く

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

**RAG (SQS 非同期)**
- S3 Vectors バケット: `chime-ai-vectors-${account}` — AwsCustomResource で作成
- S3 Vectors インデックス: `documents`、1024次元 (Titan Embeddings V2)、コサイン距離
- S3VectorsPolicy 権限: `s3vectors:PutVectors`, `s3vectors:QueryVectors`, `s3vectors:ListVectors`, `s3vectors:DeleteVectors`
- SQS キュー (`chime-ai-ingest-queue`): 可視性タイムアウト 1800秒、DLQ 付き
- Lambda `ingest-document`: 受付のみ (SQS 送信 → 202)
- Lambda `ingest-document-worker`: 埋め込み + S3 Vectors 書き込み (SQS トリガー)
- Lambda `manage-documents`: S3 Vectors 一覧・削除 (GET/DELETE /documents)

**API エンドポイント (全て Cognito 認証必須)**
- `POST /meetings` → `chime-ai-create-meeting` Lambda
- `POST /ai-chat` → `chime-ai-chat` Lambda
- `POST /documents` → `chime-ai-ingest-document` Lambda (202 即時返却)
- `GET /documents` → `chime-ai-manage-documents` Lambda (RAG 一覧)
- `DELETE /documents` → `chime-ai-manage-documents` Lambda (RAG 削除)
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
| `INGEST_QUEUE_URL` | SQS キュー URL (ingest-document worker 用) |

Lambda TypeScript (`cdk/lambda/`) は CDK `tsconfig.json` から除外されており esbuild が個別にバンドル。`externalModules: []` で AWS SDK を含む全依存をバンドル。Lambda ランタイム: Node.js 24 (`NODEJS_24_X`)。

---

## Lambda 関数

### `ai-chat/index.ts` — Bedrock AgentCore を使った AI 会話処理

1. Cognito claims から `userId` を取得
2. フレームあり: **Converse API** (Vision) と **S3 Vectors RAG** を `Promise.allSettled` で**並列実行** → 両コンテキストを組み合わせる (Vision 失敗時は RAG のみで継続)
   フレームなし: S3 Vectors RAG のみ実行
   - **Vision**: `ConverseCommand` (bedrock:Converse) に JPEG を渡してテキスト分析結果を取得
   - **RAG**: Titan Embeddings V2 でベクトル化 → S3 Vectors で上位3件検索
   - ※ `InvokeAgent` の `sessionState.files` は JPEG 非対応のため Converse API を使用
3. Vision 解析テキスト + RAG コンテキストを XML タグ (`<context>`, `<user_input>`) で組み立て (両方ある場合は両方提供)
4. **AgentCore InvokeAgent** を呼び出し (sessionId = Chime MeetingId)
   - レスポンスは AsyncIterable — `for await` でチャンクを結合
5. Polly Kazuha (Neural) で音声合成 → Base64 MP3
6. 利用記録を DynamoDB に非同期保存 (`ragUsed`, `frameAnalyzed` フラグ付き)

### `ingest-document/index.ts` — SQS への受付 (202 返却)

1. `POST /documents { content, source }` を受け取る
2. SQS メッセージサイズ (250KB) チェック → 超過時 413
3. SQS キューに送信 → 202 即時返却

### `ingest-document-worker/index.ts` — RAG インデックス構築

1. SQS イベントからコンテンツを取得
2. スライディングウィンドウでチャンク分割 (500字、50字オーバーラップ)
3. 並列 5 件で Titan Embeddings V2 ベクトル化
4. S3 Vectors に 25件ずつバッチ書き込み
5. 失敗メッセージのみ `batchItemFailures` に返す (部分失敗対応)

### `manage-documents/index.ts` — RAG ドキュメント管理

- `GET /documents`: `ListVectorsCommand` でページネーションしながら全件取得、`userId/` プレフィックスでフィルタ、`source` メタデータでグループ化して返却
- `DELETE /documents`: `{ source }` または `{ keys[] }` で指定、`DeleteVectorsCommand` で 25件ずつバッチ削除
- ベクトルキー形式: `${userId}/${uuid}` — ユーザーごとのスコープを実現

### `user-management/index.ts` — ユーザー管理

- `GET /users`: Cognito AdminGetUser でユーザー情報取得
- `DELETE /users`: Cognito AdminDeleteUser でアカウント削除 + DynamoDB BatchWriteCommand で全データ削除
  - JWT の `sub` クレームで本人確認 (他人のアカウントは削除不可)
  - 削除後はフロントエンドで `signOut()` を呼び出してセッションをクリア

---

## フロントエンド (`frontend/`)

### コマンド

```bash
cd frontend
npm install
npm run dev        # localhost:3000
npm run build      # dist/ に出力 (tsc -p tsconfig.app.json && vite build)
npm run test       # Vitest 31テスト
npm run lint       # ESLint (react-hooks/exhaustive-deps: error)
```

### tsconfig 構成

- `tsconfig.json` — エディタ用 (全ファイル)
- `tsconfig.app.json` — ビルド用 (`__tests__` 除外)
- `tsconfig.test.json` — Vitest 用 (`@types/node` 追加)

### 画面構成

```
App (認証ゲート + 画面遷移 view state)
├── LoginScreen (ログイン・新規登録・メール確認コード入力)
├── UserProfile (アカウント設定・デバイステスト・削除)
├── RAGManagement (RAG ドキュメント一覧・削除・追加登録)
└── MeetingRoom (useMeeting + useAIConversation + useScreenShare を結合)
    ├── AIParticipant (AI アバター: aibot.mp4 + AR エフェクト)
    └── DocumentUpload (RAG テキスト・PDF・テキストファイル登録)
```

### 主要フック

- `useAuth`: signIn/signOut/signUp/confirmSignUp/deleteAccount/getIdToken
- `useMeeting`: Chime SDK セッション + 無音検知ダイアログ (3秒 debounce) + ミュート時に pendingText があれば即時ダイアログ表示 + `captureLocalFrame` (ローカルカメラフレームキャプチャ)
- `useAIConversation`: AI 会話送受信 + Polly 音声再生 (AudioContext + playIdRef race condition 対策)
- `useScreenShare`: getDisplayMedia + captureFrame (Canvas JPEG Base64)

### 画面遷移

`App.tsx` の `view` state で制御 (`'meeting' | 'profile' | 'rag'`):
- `unauthenticated` → LoginScreen
- `authenticated + view='profile'` → UserProfile
- `authenticated + view='rag'` → RAGManagement
- `authenticated + view='meeting'` → MeetingRoom

### MeetingRoom — カメラ映像送信のキーワード検知

`MeetingRoom.tsx` にはカメラ映像をいつ AI に送るかを判定する `shouldCaptureCamera(text)` ヘルパー関数があります。以前の手動 📸 ボタン (`isCameraAI` state) は廃止し、ユーザー発話にカメラ関連キーワードが含まれた場合のみ自動的にローカルカメラのフレームを送信します。

```typescript
function shouldCaptureCamera(text: string): boolean {
  const patterns = [/カメラ/, /映像/, /顔.*見/, /どう見え/, /私.*映/, /映.*見て/];
  return patterns.some((p) => p.test(text));
}

// onTranscript コールバック内:
const frame = isSharing
  ? captureFrame()                                         // 画面共有優先
  : shouldCaptureCamera(transcript) ? captureLocalFrame() // キーワード検知時のみカメラ
  : null;
```

`captureLocalFrame()` は `useMeeting` が返す関数で、ダミーカメラ (`isDummyCamera`) または映像オフ時は `null` を返します。

### DocumentUpload — PDF / テキストファイル対応

- 対応形式: `.txt`, `.md`, `.csv`, `.log`, `.pdf`
- PDF テキスト抽出: `pdfjs-dist` (`GlobalWorkerOptions.workerSrc` を Vite `?url` import で設定)
- テスト: `vi.mock('pdfjs-dist', ...)` と `vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', ...)` でモック (jsdom に DOMMatrix がないため)
- `isExtracting` state で PDF 処理中ローディングを表示

---

## デプロイ

本プロジェクトには **2 つのデプロイ手段**があります。どちらかを変更した場合は**もう一方も必ず同期**してください。

| 手段 | 用途 | コマンド |
|------|------|---------|
| `deploy.sh` | 手動デプロイ (ローカルから即時適用) | `bash deploy.sh` |
| CI/CD パイプライン | 自動デプロイ (CodeCommit push トリガー) | `git push codecommit ...` |

> **メンテナンス原則**: デプロイロジック (インストール手順・環境変数・Amplify デプロイ方法など) を変更したら、`deploy.sh` と `cdk/lib/cicd-stack.ts` の **両方を同じ変更**に更新すること。片方だけ直すと手動/自動で挙動が乖離する。

```bash
bash deploy.sh  # CDK デプロイ + フロントエンドビルド + Amplify 手動デプロイ + CloudFront 無効化
```

**デプロイ前提条件:**
1. AWS CLI 設定済み (Node.js 24+)
2. Bedrock コンソールで以下のモデルアクセスを有効化:
   - `jp.anthropic.claude-sonnet-4-6` (Claude Sonnet 4.6)
   - `amazon.titan-embed-text-v2:0` (Titan Embeddings V2)
3. S3 Vectors が ap-northeast-1 で利用可能なことを確認

---

## CodeCommit へのコミット & プッシュ

### 初回セットアップ (git-remote-codecommit のインストール)

```bash
pip3 install git-remote-codecommit --break-system-packages
```

### リモート設定

```bash
# codecommit リモートを GRC 形式で登録 (初回のみ)
git remote add codecommit codecommit::ap-northeast-1://chime-ai-meeting

# すでに登録済みの場合は URL を更新
git remote set-url codecommit codecommit::ap-northeast-1://chime-ai-meeting
```

### AWS SSO ログイン & プッシュ

```bash
# SSO ログイン (セッション切れ時)
aws sso login --profile YOUR_SSO_PROFILE

# プッシュ (プロファイルを URL に埋め込む)
git push codecommit::ap-northeast-1://YOUR_SSO_PROFILE@chime-ai-meeting main
```

> **注意**: `git push codecommit main` は SSO プロファイルを認識できないため、URL にプロファイル名を埋め込む形式を使うこと。認証情報ストアへの書き込み警告 (`fatal: Failed to write item to store`) は無視して問題ない (プッシュ自体は成功する)。

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
- **画面共有 `<video>` DOM**: `screenVideoRef` が null にならないよう `display: none` で常に DOM に存在させる
- **ダミーカメラの transform**: Chime SDK は `bindVideoElement` で `rotateY(180deg)` を video 要素自体に設定する。wrapper div で `isDummyCamera ? 'scaleX(-1)' : 'none'` とすることでダミー時は鏡像をキャンセル、通常カメラ時はセルフィービューを維持する
- **aibot.mp4 は Fast Start (moov front) 形式必須**: `moov` ボックスがファイル末尾にある通常 MP4 は `networkState: 3 (NETWORK_NO_SOURCE)` になりブラウザが再生できない。`qt-faststart` 等のツールで `moov` をファイル先頭に移動すること
- **AI アバター autoPlay**: `<video autoPlay>` だけでは一部ブラウザで再生されない。`useEffect` で `video.play()` を呼び出し + `canplay` イベントでリトライすること。`display: 'block'` と `preload="auto"` も設定すること
- **ミュート時の即時ダイアログ**: `toggleMute` でミュートにする際、`pendingTextRef.current.trim()` が空でなければ debounce を待たずに `showSilenceConfirm = true` を即時セットしてダイアログ表示する
- **jsdom v28**: inline style の色が `rgb()` に正規化される。テストで `style*="ef4444"` ではなく `style*="rgba(239, 68, 68"` を使う
- **React 19 muted prop**: React 19 では `<video muted>` が HTML 属性として正しく出力されるため ref コールバックは不要
- **AudioContext race condition**: `AudioBufferSourceNode.stop()` は `onended` を非同期で fire する。`stopSpeaking()` 前に `onended = null` をセットし、`playIdRef` でキャンセル検知すること
- **Chime Transcribe 重複テキスト**: `lastAccumulatedRef` で 3 秒以内の同一テキストを重複排除。句読点 (`。、！？`) を正規化してから比較すること
- **videoTileDidUpdate のタイミング**: `startLocalVideoTile()` は同期的に observer を fire するため、React がまだ DOM をコミットしていない。`setTimeout(bind, 0)` でリトライすること
- **pdfjs-dist と jsdom**: `DOMMatrix` が jsdom に存在しないため、テストでは `vi.mock('pdfjs-dist', ...)` でモックすること
- **`NodejsFunction.logRetention` は deprecated**: `logGroup` プロパティに `new logs.LogGroup(...)` を渡すこと。`logGroupName` は指定しない — Lambda がすでに自動作成したロググループと名前が衝突して CloudFormation が `Resource already exists` エラーになる
- **`AwsCustomResource.installLatestAwsSdk` は必ず明示**: デフォルト `true` のまま放置すると cdk-nag/CDK 警告が出る。IAM 等の安定した API は `false`、S3Vectors 等の新 API は `true` を明示すること
- **Bedrock AgentCore Vision (`sessionState.files` の制約)**: `InvokeAgent` の `sessionState.files` で `useCase: 'CHAT'` に指定できるのはテキスト系ファイル (`text/plain`, `application/pdf` 等) のみ。JPEG 等の画像ファイルを渡すと ValidationException になる。画像解析には **Converse API** (`ConverseCommand`, IAM アクション `bedrock:Converse`) を使うこと
- **Converse API の IAM 権限**: `bedrock:Converse` は `bedrock:InvokeModel` とは別の IAM アクション。Lambda ロールに個別に付与が必要
- **Amplify SPA リライトルールと静的ファイル**: カスタムルールの拡張子除外リストに含まれない拡張子へのリクエストは `/index.html` にリダイレクトされる。`mp4` 等の動画ファイルをデプロイする場合は拡張子をリストに追加すること (`css|gif|ico|jpg|js|mp4|png|txt|svg|woff|woff2|ttf|map|json|webp`)
- **Amplify git 接続済みアプリのデプロイ**: `aws amplify create-deployment` は git 非接続アプリ専用。git 接続済みアプリは `aws amplify start-job --job-type RELEASE` でビルドをトリガーすること
- **jest バージョンは v29 固定**: v30 へのアップグレードで CodeBuild パーサーエラーが発生した経緯があり v29 系 (`jest@29`, `ts-jest@29`, `@types/jest@29`) に固定。`glob@7`/`inflight` の deprecated 警告は jest@29 の推移的依存であり解消不可
- **cdk-nag 未抑制ルール**: `AwsSolutions-COG2` (MFA)、`AwsSolutions-DDB3` (PITR)、`AwsSolutions-APIG3` (WAF) は開発環境向けの判断として抑制済み。`app.ts` と `cdk/test/chime-ai-meeting-stack.test.ts` 両方の `NagSuppressions` に追記が必要
- **画面共有フレームと `videoWidth === 0`**: `getDisplayMedia` でストリームを開始しても `loadeddata` が発火する前は `video.videoWidth === 0` のため `captureFrame()` が null を返す。`startScreenShare` 内で `loadeddata` イベントを待ってから `setIsSharing(true)` を呼ぶこと (2 秒タイムアウト付き)
- **Vision と S3 RAG の併用**: `ai-chat/index.ts` では Vision (Converse) と RAG (S3 Vectors) を `Promise.allSettled` で並列実行する。フレームがある場合も RAG をスキップせず、両コンテキストを AgentCore に渡す。Vision 失敗時はエラーを `VisionError` クラスで識別し、RAG のみで応答を継続する (完全失敗を防ぐグレースフルフォールバック)
- **Vision エラーのデバッグ**: Lambda は Vision 失敗時にレスポンスの `visionError` フィールドにエラー詳細を返す。フロントエンドは `console.warn` でブラウザ開発者ツールに出力するため、F12 コンソールタブで `Vision 解析失敗 (RAG フォールバックで応答):` のログを確認できる
- **Converse API の IAM 権限 (更新)**: `bedrock:Converse` に加えて `bedrock:InvokeModel` も `BedrockVisionPolicy` に付与すること。`jp.*` クロスリージョン推論プロファイルの Converse API は内部的に `bedrock:InvokeModel` を要求する場合がある
- **RAG userId フィルタ**: `ai-chat/index.ts` の `retrieveContext(queryText, userId, topK)` は `QueryVectorsCommand` の `topK` を `topK * 5` に増やしてからメタデータの `userId` フィールドでフィルタする。フィルタ後に `slice(0, topK)` で件数を絞る。ユーザー間のドキュメント漏洩を防ぐために必須
- **`useMeeting` の `isProcessing` 引数**: `useMeeting(onTranscript, isProcessing)` の第2引数で AI 処理中フラグを受け取る。`MeetingRoom.tsx` は `useAIConversation` より先に `useMeeting` を呼ぶため `isProcessingBridge` state で橋渡しし、`useEffect` で同期する
- **AI 処理中の無音ダイアログ抑制**: debounce タイマーコールバック内で `isProcessingRef.current === true` の場合は `pendingShowDialogRef.current = true` を記録してダイアログ表示をスキップ。`isProcessing` が `false` になった時点で `useEffect` がダイアログを自動表示する
- **マイクボタン4状態**: `isMuted` → 赤 `#ef4444` / `isProcessing` → 琥珀 `#f59e0b` / `isSpeaking` → 暗灰色 `#2a2a4a` / 聴取中 → シアン `#06b6d4`。`isProcessing || isSpeaking` 時は `opacity: 0.6` + `cursor: not-allowed`
- **ぼかし preference の localStorage 保存**: `UserProfile.tsx` の「映像設定」セクションで `localStorage.setItem('blurPreference', 'on'/'off')` を保存。`useMeeting` の `startMeeting` 内 `BackgroundBlurVideoFrameProcessor.isSupported().then()` で `localStorage.getItem('blurPreference') === 'on'` を確認して自動適用。`selectedDeviceIdRef` で非同期コールバック内のデバイス ID を参照する
- **Playwright E2E テストの helpers**: `frontend/e2e/helpers/auth.ts` に `login/signup/deleteAccount`、`frontend/e2e/helpers/meeting.ts` に `enterMeetingRoom/waitForAIResponse/uploadRAGText` を定義。新しい spec ファイル (`meeting-components.spec.ts`, `rag-security.spec.ts`, `rag-filetypes.spec.ts`, `performance.spec.ts`) はこれらを import して使う
