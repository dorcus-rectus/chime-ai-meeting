# Amazon Chime SDK × Bedrock AgentCore × S3 Vectors で構築する AI ビデオ会議システム

## はじめに

**Claude Code の勉強をしよう**と思い立ち、VS Code + Dev Container 環境を整えてみました。が、環境を整えたついでに「生成 AI とのビデオ会議システムって作れるのかな？」と試してみたところ―― **気づいたらアプリが完成していました。**

Claude Code の勉強はまだちゃんとできていません。でも、それくらい Claude Code は使いやすかったということだと思います。

### 開発環境と開発スタイル

環境は **VS Code + Dev Container** です。Claude Code に「こういうものを作りたい」と伝えながら進めた結果、**3 日間でフロントエンドからインフラ・テスト・CI/CD まで一通り動くものができました**。動作確認は Windows（開発機）・iPad（iOS Safari / Chrome）・Android の 3 環境で実施しています。

とはいえ、AI が全部やってくれるわけではありません。WebRTC の制約・AgentCore の未ドキュメントな落とし穴・GA 直後の S3 Vectors の挙動など、「コードは生成できても、実際に動かして初めてわかる問題」が驚くほど多く発生しました。iOS Safari のマイク制約・Android の Web Speech API の挙動差異・Chime SDK の HTTPS 必須制約など、ドキュメントに書かれていない壁のほとんどは**実機で動かして初めて発覚**しています。

その都度 Claude Code と一緒に原因を探り、解決策を探し、また動かしてみる―― そんな往復作業の積み重ねが本記事の内容です。この過程を Claude Code とともにまとめたので長文になりましたが、同じ壁にぶつかる方の役に立てれば幸いです。

---

### 解決した課題

「会議中に AI に話しかけたい」という要件は一見シンプルに見えますが、実際には複数の難しい問題が絡み合います。

- **リアルタイム性の壁**: WebRTC の音声ストリームと AI の推論レイテンシをどう両立するか
- **文脈の維持**: 複数ターンにわたる会話履歴を Lambda のステートレス環境でどう管理するか
- **マルチモーダルの制約**: 画面共有フレームを AI に渡すとき、`InvokeAgent` の `sessionState.files` は JPEG を受け付けない（ValidationException）―― その回避策をどう設計するか
- **コストと安全性の両立**: 独自ドキュメントを参照する RAG を安価に構築しつつ、ユーザー間のデータ漏洩を防ぐにはどうするか

本記事は、これらの課題を **Amazon Chime SDK・Bedrock AgentCore・S3 Vectors** という 2026 年 3 月時点で最新の AWS サービス群で実際に解決した実装記録です。

> ⚠️ **Amazon Chime について**: 2026 年 2 月に Amazon Chime アプリケーションは廃止されましたが、本記事で使用する **Amazon Chime SDK** は引き続き提供されており影響ありません。

---

### この記事を読むとわかること

:::message
**📌 読者が得られる主な知見（5 点）**

1. **Bedrock AgentCore の実用的な使い方とその限界**
   CDK L1 Construct での定義・Lambda からの `InvokeAgentCommand` 呼び出し・セッション管理の仕組みを解説。あわせて、レスポンスに 5〜10 秒かかる現実と、本番では Converse API + DynamoDB への移行を検討すべき理由を示す。

2. **AgentCore Vision の正しい実装パターン**
   `sessionState.files` で JPEG を送ると ValidationException になる落とし穴と、**Converse API で先に画像分析 → テキストを InvokeAgent に渡す** という回避策。Vision と RAG を `Promise.allSettled` で並列実行するグレースフルフォールバック設計。

3. **S3 Vectors を使った低コスト RAG の全実装**
   SQS 非同期インジェスト → スライディングウィンドウ分割 → Titan Embeddings V2 → S3 Vectors までのパイプラインと、ユーザー間漏洩を防ぐ userId フィルタ設計。GA 直後サービスの制約（サーバーサイドフィルタ非対応）と、本番規模では Bedrock Knowledge Bases や Aurora pgvector を検討すべき判断基準も整理。

4. **フロントエンド × リアルタイム音声の UX 設計**
   Transcribe の書き起こし重複排除・無音検知ダイアログ・マイクボタン 4 状態（ミュート/聴取中/処理中/発話中）など、音声 AI UI 特有の問題と解決策。

5. **CDK × TDD × CI/CD の実践パターン**
   cdk-nag による Well-Architected 自動監査・Jest スナップショットテスト・Vitest + Playwright E2E テスト・CodePipeline による完全自動デプロイまでの品質管理フルスタック。
:::

**📦 ソースコードの完全版:** https://github.com/your-org/chime-ai-meeting (記事末尾にもリンクあり)

本記事はフロントエンドからインフラ・テスト・セキュリティまでを網羅した完全ガイドです。実装の辞書としても使えるよう構成しているため、**「ストック」して目次から必要なセクションへジャンプする**使い方をおすすめします。

---

### システムの主な機能

| 機能 | 使用サービス |
|------|-------------|
| リアルタイム音声会議 | Amazon Chime SDK JS |
| 日本語音声認識 | Amazon Transcribe (ja-JP) / Web Speech API |
| AI 会話 (セッション管理付き) | Bedrock AgentCore + Claude Sonnet 4.6 |
| 画面共有フレームの AI 解析 | Bedrock AgentCore Vision (マルチモーダル) |
| RAG (独自ドキュメント参照) | Amazon S3 Vectors + Titan Embeddings V2 |
| RAG ドキュメント管理 | Lambda manage-documents (一覧・削除) |
| RAG メタデータタグ | S3 Vectors メタデータフィールド + フロントエンド表示 |
| PDF / テキストファイル登録 | pdfjs-dist でブラウザ内テキスト抽出 |
| AI 音声応答 | Amazon Polly Neural TTS (Kazuha) |
| **背景ぼかし** | Chime SDK BackgroundBlurVideoFrameProcessor |
| **ネットワーク品質モニタリング** | Chime SDK AudioVideoObserver コールバック |
| ユーザー認証・管理 | Amazon Cognito |
| インフラのコード管理 | AWS CDK (TypeScript) + Jest (スナップショット・Fine-grained・cdk-nag) |
| CI/CD パイプライン | AWS CodeCommit + CodePipeline + Amplify |
| **RAG ユーザー分離** | `QueryVectorsCommand` を userId でフィルタしてユーザー間のドキュメント漏洩を防止 |
| **音声認識 UI 4状態** | マイクボタン: ミュート赤/聴取中シアン/AI処理中琥珀/AI発話中 + コントロールバー上のステータスラベル |
| **ぼかし preference** | UserProfile で preference 保存 → 次の会議開始時に `localStorage` 参照して自動適用 |
| テスト | Vitest (単体 31件) + Playwright (E2E: helpers + 7 spec) + CDK Jest (53件) + ESLint |
| フロントエンド | React 19 + Vite 7 + Amplify Hosting |

:::details 記事内で扱うトピック一覧（辞書利用向け）
- Chime SDK IAM 権限設定 (よくある落とし穴)
- Bedrock AgentCore CDK 定義 (L1 Construct) と Lambda 呼び出し
- S3 Vectors + AwsCustomResource による CDK プロビジョニング
- RAG パイプライン (Titan Embeddings V2 / SQS 非同期 / チャンク分割)
- RAG 管理 API (ListVectors / DeleteVectors) とユーザー分離
- PDF 対応 (pdfjs-dist ブラウザ内テキスト抽出 / Vitest モック)
- Cognito Admin API (AdminGetUser / AdminDeleteUser)
- AgentCore Vision ― Converse API との組み合わせパターン
- 無音検知ダイアログ / マイクボタン 4 状態 UX
- AI アバターコンポーネント (動画 + CSS AR)
- 音声再生 race condition 対策 (AudioContext + playIdRef)
- 背景ぼかし (BackgroundBlurVideoFrameProcessor)
- ネットワーク品質モニタリング (AudioVideoObserver)
- Chime Transcribe 重複テキスト正規化・排除
- CodePipeline + Amplify による CI/CD 自動化
- Vitest / Playwright E2E / CDK Jest (スナップショット・cdk-nag) / ESLint
- iPad/iOS 対応・レスポンシブ設計
- HTTP セキュリティヘッダー (`customHttp.yml`) によるエンタープライズ対応
:::

---

## アーキテクチャ全体像

```
ブラウザ (React + Vite / Amplify Hosting)
  ├─ Amazon Chime SDK JS
  │    ├─ WebRTC 音声・映像
  │    └─ Amazon Transcribe (書き起こし ja-JP)
  │         └─ [iOS フォールバック] Web Speech API (webkitSpeechRecognition)
  │
  ├─ Amazon Cognito (認証)
  │
  └─ API Gateway (REST, Cognito Authorizer)
       ├─ POST /meetings  → Lambda: create-meeting
       │    └─ Chime SDK Meetings API (会議・参加者作成)
       │
       ├─ POST /ai-chat   → Lambda: ai-chat
       │    ├─ Titan Embeddings V2 でクエリをベクトル化
       │    ├─ S3 Vectors で類似ドキュメントを検索 (RAG)
       │    ├─ Bedrock AgentCore InvokeAgent (Claude Sonnet 4.6)
       │    │    └─ sessionId でセッション内会話履歴を自動管理
       │    └─ Amazon Polly Neural TTS → Base64 MP3
       │
       ├─ POST /documents → Lambda: ingest-document (202 即時返却)
       │    └─ SQS キューに投入 (非同期)
       │         └─ Lambda: ingest-document-worker
       │              ├─ テキストをチャンク分割 (スライディングウィンドウ)
       │              ├─ Titan Embeddings V2 でベクトル化 (並列 5 件)
       │              └─ S3 Vectors に PutVectors (25 件バッチ)
       │
       ├─ GET    /documents → Lambda: manage-documents → S3 Vectors (ListVectors)
       ├─ DELETE /documents → Lambda: manage-documents → S3 Vectors (DeleteVectors)
       │
       ├─ GET  /users     → Lambda: user-management → Cognito AdminGetUser
       └─ DELETE /users   → Lambda: user-management → Cognito AdminDeleteUser
```

---

## 1. Amazon Chime SDK

### Chime SDK とは

Amazon Chime SDK は、ブラウザ・モバイルアプリにリアルタイム音声・映像通話機能を組み込むための SDK です。WebRTC を抽象化しており、数十行のコードでビデオ会議を実装できます。

本システムでは `@aws-sdk/client-chime-sdk-meetings` (サーバーサイド) と `amazon-chime-sdk-js` (クライアントサイド) を使用しています。

### 会議の作成フロー

Lambda 側でまず「会議 (Meeting)」と「参加者 (Attendee)」を作成し、認証情報をブラウザに返します。

```typescript
// cdk/lambda/create-meeting/index.ts
import {
  ChimeSDKMeetingsClient,
  CreateMeetingCommand,
  CreateAttendeeCommand,
  StartMeetingTranscriptionCommand,
} from '@aws-sdk/client-chime-sdk-meetings';

const client = new ChimeSDKMeetingsClient({ region: 'ap-northeast-1' });

// 会議を作成
const meetingResponse = await client.send(
  new CreateMeetingCommand({
    ClientRequestToken: crypto.randomUUID(),
    MediaRegion: 'ap-northeast-1',
    ExternalMeetingId: `meeting-${Date.now()}`,
    MeetingFeatures: {
      Audio: { EchoReduction: 'AVAILABLE' },  // エコーキャンセル
    },
  }),
);

// 参加者を作成
const attendeeResponse = await client.send(
  new CreateAttendeeCommand({
    MeetingId: meetingResponse.Meeting!.MeetingId!,
    ExternalUserId: `user-${crypto.randomUUID()}`,
  }),
);

// 日本語書き起こしを開始
await client.send(
  new StartMeetingTranscriptionCommand({
    MeetingId: meetingId,
    TranscriptionConfiguration: {
      EngineTranscribeSettings: {
        LanguageCode: 'ja-JP',
        EnablePartialResultsStabilization: true,
        PartialResultsStability: 'medium',
      },
    },
  }),
);
```

:::message alert
**💰 Amazon Transcribe のコストに注意**

Amazon Transcribe はストリーミング書き起こしに対して**接続時間ベースで課金**されます（2026 年 3 月時点: $0.024 / 分）。会議中はマイクがミュートでも Transcribe セッションが継続されるため、長時間の会議や多数の同時接続では費用が積み上がりやすくなります。

**本番運用でのコスト削減策として、以下を検討してください：**

| 手段 | 概要 |
|------|------|
| **Web Speech API への全面切り替え** | ブラウザ内処理のため Transcribe コストがゼロ。精度は Transcribe より劣る場合があるが、日常会話レベルでは十分なケースが多い |
| **ミュート時に Transcribe を停止** | `StopMeetingTranscription` を呼び出しミュート解除時に `StartMeetingTranscription` を再開。マイク ON の時間だけ課金される |
| **Amazon Transcribe の代替** | 会議終了後に録音データをバッチで書き起こす設計に変更すれば Streaming ではなく Standard API を使え単価が下がる（ただしリアルタイム性が失われる） |
| **使用量アラート設定** | AWS Budgets で Transcribe の月次支出に上限アラートを設定し、予期しない高額請求を早期検知する |

本記事のシステムは**ミュート時は音声認識イベントを無視する**実装になっていますが、Transcribe セッション自体は継続されている点に注意してください。
:::

ブラウザは返却された `Meeting` と `Attendee` オブジェクトを使って Chime SDK JS でセッションを確立します。

```typescript
// frontend/src/hooks/useMeeting.ts
const logger = new ConsoleLogger('ChimeMeeting', LogLevel.WARN);
const deviceController = new DefaultDeviceController(logger);
const configuration = new MeetingSessionConfiguration(meeting, attendee);
const session = new DefaultMeetingSession(configuration, logger, deviceController);

// マイク入力 (VoiceFocus ノイズキャンセル付き)
const vfSupported = await VoiceFocusDeviceTransformer.isSupported(undefined, { logger });
if (vfSupported) {
  const transformer = await VoiceFocusDeviceTransformer.create(undefined, { logger });
  const vfDevice = await transformer.createTransformDevice(micDeviceId);
  await session.audioVideo.startAudioInput(vfDevice ?? micDeviceId);
}

session.audioVideo.start();
session.audioVideo.startLocalVideoTile();
```

### ⚠️ IAM 権限の落とし穴: chime: vs chime-sdk-meetings:

AWS の IAM ドキュメントには `chime-sdk-meetings:` というサービスプレフィックスが記載されており、こちらが正しそうに見えます。**しかし実際に動かしてみると `chime:CreateMeeting` が要求されます。**

CloudWatch ログのエラー:
```
not authorized to perform: chime:CreateMeeting on resource:
arn:aws:chime:ap-northeast-1:012345678901:meeting/*
```

CDK での正しい定義:

```typescript
new iam.PolicyStatement({
  // @aws-sdk/client-chime-sdk-meetings は IAM 認可で chime: プレフィックスを使用する。
  // chime-sdk-meetings: では AccessDenied になる (実測確認済み)。
  actions: [
    'chime:CreateMeeting',
    'chime:DeleteMeeting',
    'chime:GetMeeting',
    'chime:CreateAttendee',
    'chime:DeleteAttendee',
    'chime:GetAttendee',
    'chime:StartMeetingTranscription',
    'chime:StopMeetingTranscription',
  ],
  resources: ['*'],
}),
```

### iOS / iPad でのカメラ・マイク対応

iOS Chrome / Safari では、カメラ・マイクへのアクセスが失敗しても会議自体は継続できるようにフォールバック処理が必要です。

```typescript
// カメラ取得失敗 → ダミーカメラ (キャンバス描画) にフォールバック
try {
  const devices = await session.audioVideo.listVideoInputDevices();
  if (devices.length > 0) {
    await session.audioVideo.startVideoInput(devices[0].deviceId);
  } else {
    // デバイスなし → ダミーカメラ
    const stream = createDummyStream(1280, 720);
    await session.audioVideo.startVideoInput(stream as unknown as string);
    setIsDummyCamera(true);
  }
} catch {
  // 権限拒否・デバイス取得失敗 → ダミーカメラで継続
  const stream = createDummyStream(1280, 720);
  await session.audioVideo.startVideoInput(stream as unknown as string);
  setIsDummyCamera(true);
}
```

### iOS での音声認識: Web Speech API フォールバック

iOS Chrome では Chime SDK + Amazon Transcribe による音声認識が動作しないケースがあります。そのため **Web Speech API** (`webkitSpeechRecognition`) をフォールバックとして追加しました。

ミュート状態と連動させるため、`isMutedRef`（`useRef`）で同期的にミュート状態を管理し、**マイク ON のときだけ認識を開始**します。

```typescript
// ミュート状態を useRef で同期追跡 (React state は async のためコールバック内で使えない)
const isMutedRef = useRef(true);

// Chime Transcription が機能しない環境 (iOS Chrome 等) 向けフォールバック
const SpeechRecognitionClass =
  (window as any).webkitSpeechRecognition ?? (window as any).SpeechRecognition;

if (SpeechRecognitionClass) {
  const recognition = new SpeechRecognitionClass();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'ja-JP';
  recognition.onresult = (event) => {
    if (isMutedRef.current) return;  // ミュート中は結果を無視
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) final += event.results[i][0].transcript;
    }
    if (final.trim()) onTranscriptRef.current(final.trim());
  };
  // 致命的エラー (マイク権限拒否) で自動再起動を停止 → 無限ループ防止
  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      speechRecognitionRef.current = null;
    }
  };
  // ミュート中は再起動しない (continuous が保証されない iOS への対応)
  recognition.onend = () => {
    if (speechRecognitionRef.current && !isMutedRef.current) recognition.start();
  };
  speechRecognitionRef.current = recognition;
  // デフォルトはミュートのため start() しない。マイク ON 時に toggleMute() で開始する
}
```

:::message
**stale closure に注意**

`recognition.onresult` のコールバックは `startMeeting()` 実行時の関数インスタンスをキャプチャします。その後 React の state 更新（`sessionId` の確定など）で再レンダリングが起きても、クロージャは古い参照を指し続けます。

これを防ぐため `onTranscriptRef` パターンを使います。**毎レンダリングで ref を最新の関数に更新**することで、コールバックが常に最新の `sendTranscript`（正しい `sessionId` を持つ）を呼び出せます。

```typescript
// useMeeting.ts
const onTranscriptRef = useRef(onTranscript);
onTranscriptRef.current = onTranscript;  // 毎レンダリングで更新

const flushTranscript = useCallback(() => {
  const text = transcriptBufferRef.current.trim();
  if (text) {
    transcriptBufferRef.current = '';
    onTranscriptRef.current(text);  // 常に最新の関数を呼ぶ
  }
}, []);  // onTranscript は依存配列から外す
```

この問題が修正される前は、音声認識は動作していても `sessionId=null` の古い `sendTranscript` が呼ばれ、`if (!sessionId) return` で全て握りつぶされていました。
:::

`toggleMute` ではミュート解除と同時に音声認識を開始し、ミュートと同時に停止します。

```typescript
const toggleMute = useCallback(() => {
  const session = sessionRef.current;
  if (!session) return;
  if (isMuted) {
    session.audioVideo.realtimeUnmuteLocalAudio();
    isMutedRef.current = false;
    setIsMuted(false);
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.start(); } catch { /* 既に開始中 */ }
    }
  } else {
    session.audioVideo.realtimeMuteLocalAudio();
    isMutedRef.current = true;
    setIsMuted(true);
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch { /* 既に停止中 */ }
    }
  }
}, [isMuted]);
```

### 画面共有の対応状況

`getDisplayMedia` は iOS Chrome では非対応のため、事前チェックが必要です。

```typescript
if (!navigator.mediaDevices?.getDisplayMedia) {
  setError('画面共有はこのブラウザでサポートされていません (iOS Safari 以外では利用できません)');
  return null;
}
const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
```

### 背景ぼかし (BackgroundBlurVideoFrameProcessor)

Chime SDK JS には **BackgroundBlurVideoFrameProcessor** が内蔵されており、追加インフラなしでカメラ映像の背景をリアルタイムにぼかせます。`DefaultVideoTransformDevice` でプロセッサをラップし、通常の `startVideoInput()` に渡すだけで有効になります。

```typescript
// frontend/src/hooks/useMeeting.ts
import {
  BackgroundBlurVideoFrameProcessor,
  DefaultVideoTransformDevice,
} from 'amazon-chime-sdk-js';

// ぼかし対応チェック (WASM を必要とするため、ブラウザによっては非対応)
const blurSupported = await BackgroundBlurVideoFrameProcessor.isSupported();
setIsBlurSupported(blurSupported);
```

ぼかし ON/OFF の切り替えは以下のように実装します:

```typescript
const toggleBackgroundBlur = useCallback(async () => {
  if (!isBlurSupportedRef.current) return;
  const session = sessionRef.current;
  if (!session) return;

  if (isBlurEnabledRef.current) {
    // ---- ぼかし OFF ----
    if (blurTransformDeviceRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (blurTransformDeviceRef.current as any).stop?.();
      blurTransformDeviceRef.current = null;
    }
    if (blurProcessorRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (blurProcessorRef.current as any).destroy?.();
      blurProcessorRef.current = null;
    }
    await session.audioVideo.startVideoInput(currentDeviceIdRef.current);
    setIsBlurEnabled(false);
    isBlurEnabledRef.current = false;
  } else {
    // ---- ぼかし ON ----
    // create() は BackgroundBlurProcessor | undefined を返す — null チェック必須
    const processor = await BackgroundBlurVideoFrameProcessor.create();
    if (!processor) {
      console.warn('背景ぼかしプロセッサーの作成に失敗しました');
      return;
    }
    blurProcessorRef.current = processor;

    // DefaultVideoTransformDevice でプロセッサをラップ
    const transformDevice = new DefaultVideoTransformDevice(
      loggerRef.current!,
      currentDeviceIdRef.current,
      [processor as unknown as VideoFrameProcessor], // 型変換が必要
    );
    blurTransformDeviceRef.current = transformDevice;

    // 通常のデバイス ID の代わりに transform device を渡す
    await session.audioVideo.startVideoInput(
      transformDevice as unknown as string,
    );
    setIsBlurEnabled(true);
    isBlurEnabledRef.current = true;
  }
}, []);
```

:::message alert
**`BackgroundBlurVideoFrameProcessor.create()` の戻り値は `BackgroundBlurProcessor | undefined`**

型定義の都合で `create()` は `undefined` を返す可能性があります。`[processor]` として `VideoFrameProcessor[]` に渡す前に `if (!processor) return;` の null チェックが必須です。チェックを省くと TypeScript エラー:

```
Type 'BackgroundBlurProcessor | undefined' is not assignable to type 'VideoFrameProcessor'
```

が発生します。ブラウザのサポート確認 (`isSupported()`) とプロセッサの null チェックをセットで実装してください。
:::

カメラ切り替え時はぼかしトランスフォームデバイスを再作成する必要があります:

```typescript
// changeCamera 内: ぼかし有効時は transform device ごと再作成
if (isBlurEnabledRef.current) {
  const processor = await BackgroundBlurVideoFrameProcessor.create();
  if (processor) {
    const transformDevice = new DefaultVideoTransformDevice(
      loggerRef.current!, newDeviceId, [processor],
    );
    blurTransformDeviceRef.current = transformDevice;
    await session.audioVideo.startVideoInput(transformDevice as unknown as string);
  }
} else {
  await session.audioVideo.startVideoInput(newDeviceId);
}
```

ダミーカメラ (キャンバス描画) にはぼかしを適用できないため、ダミーカメラ検出時は自動的にぼかしを解除します。

### ネットワーク品質モニタリング (AudioVideoObserver)

Chime SDK の `AudioVideoObserver` は接続品質の変化を通知するコールバックを提供します。`connectionDidBecomePoor` / `connectionDidBecomeGood` を実装することで、ネットワーク不安定時にユーザーへ警告バナーを表示できます。

```typescript
// 型定義
export type NetworkQuality = 'unknown' | 'good' | 'poor';

// useMeeting.ts の startMeeting 内で observer を拡張
const [networkQuality, setNetworkQuality] = useState<NetworkQuality>('unknown');

const observer = {
  videoTileDidUpdate: (tileState: VideoTileState) => { /* ... */ },

  // ネットワーク品質コールバック
  connectionDidBecomePoor: () => {
    console.warn('ネットワーク品質が低下しました');
    setNetworkQuality('poor');
  },
  connectionDidBecomeGood: () => {
    setNetworkQuality('good');
  },
  connectionDidSuggestStopVideo: () => {
    // 帯域不足でビデオ停止を推奨 — poor 扱いにする
    setNetworkQuality('poor');
  },
};
session.audioVideo.addObserver(observer);
```

`MeetingRoom.tsx` では `networkQuality` を使ってバナーを条件表示します:

```tsx
{networkQuality === 'poor' && (
  <div style={{
    background: 'rgba(245,158,11,0.15)',
    borderBottom: '1px solid rgba(245,158,11,0.4)',
    padding: '6px 16px',
    color: '#fbbf24',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  }}>
    ⚠️ ネットワーク接続が不安定です。映像をオフにすると改善することがあります。
  </div>
)}
```

また、ヘッダーにもネットワーク品質のステータスバッジを表示します。会議終了時は `'unknown'` にリセットします。

```typescript
// endMeeting 内でリセット
setNetworkQuality('unknown');
```

---

## 2. Amazon Bedrock AgentCore

### AgentCore とは

Amazon Bedrock AgentCore は、会話 AI のセッション管理・ツール連携・オーケストレーションを担う AWS のマネージドサービスです。従来の Bedrock Converse API と比較した場合の最大の違いは「**セッション単位の会話履歴を自動管理する**」点です。

#### Converse API との比較

| 項目 | Converse API | Bedrock AgentCore |
|------|-------------|-------------------|
| 会話履歴 | Lambda が DynamoDB で自前管理 | AgentCore が sessionId で自動管理 |
| マルチターン | messages 配列を毎回送信 | sessionId を指定するだけ |
| レスポンス形式 | JSON (同期) | AsyncIterable (ストリーミング) |
| Vision (画像入力) | ConverseCommand に直接渡す | ConverseCommand で解析後テキストを InvokeAgent に渡す ※1 |
| コード量 | 多い (DynamoDB の読み書きが必要) | 少ない |

※1 `InvokeAgent` の `sessionState.files` は `useCase: 'CHAT'` でテキスト系ファイルのみ対応。JPEG を渡すと `ValidationException` になる。画像は Converse API で解析してテキストに変換し、その結果を `inputText` に含めて `InvokeAgent` へ渡す設計。

### CDK での AgentCore 定義

2026 年 3 月時点で、Bedrock Agents 用の L2 Construct として `@aws-cdk/aws-bedrock-alpha` が alpha 提供されているが、本プロジェクトは安定性のため **CloudFormation リソース直接操作の L1 Construct** を使います。

```typescript
import { aws_bedrock as bedrock } from 'aws-cdk-lib';

// AgentCore 専用 IAM ロール
// Lambda ロールとは別に、Bedrock サービスが引き受けるロールが必要
const agentRole = new iam.Role(this, 'BedrockAgentRole', {
  assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
    conditions: {
      StringEquals: { 'aws:SourceAccount': this.account },
      ArnLike: {
        'aws:SourceArn': `arn:aws:bedrock:ap-northeast-1:${this.account}:agent/*`,
      },
    },
  }),
  inlinePolicies: {
    BedrockModelPolicy: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          // jp. クロスリージョン推論プロファイル使用時は bedrock:* + resources: ['*'] が必要。
          // 特定リソース ARN だと "Access denied when calling Bedrock" が
          // httpStatusCode=200 のストリーム内で返るため注意。
          actions: ['bedrock:*'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          // jp.* 推論プロファイル利用時、Bedrock サービスがロールレベルで
          // AWS Marketplace の購読確認を行うため必要。
          // これがないとストリーム内で "Access denied when calling Bedrock" が返る。
          actions: [
            'aws-marketplace:ViewSubscriptions',
            'aws-marketplace:Subscribe',
            'aws-marketplace:Unsubscribe',
          ],
          resources: ['*'],
        }),
      ],
    }),
  },
});

// AgentCore エージェント本体
const agent = new bedrock.CfnAgent(this, 'AiMeetingAgent', {
  agentName: 'chime-ai-meeting-agent',
  agentResourceRoleArn: agentRole.roleArn,
  foundationModel: 'jp.anthropic.claude-sonnet-4-6',  // 東京リージョン推論プロファイル
  instruction:
    'あなたはビデオ会議に参加しているフレンドリーなAIアシスタントです。' +
    'ユーザーと日本語で自然な会話をしてください。' +
    '返答は簡潔に2〜3文程度にまとめ、話し言葉で答えてください。',
  idleSessionTtlInSeconds: 1800,  // 30分間アイドルでセッション終了
  autoPrepare: true,              // デプロイ時に自動的に PREPARED 状態へ遷移 (必須!)
});

// エイリアス (本番用)
const agentAlias = new bedrock.CfnAgentAlias(this, 'AiMeetingAgentAlias', {
  agentId: agent.attrAgentId,
  agentAliasName: 'prod',
});
agentAlias.addDependency(agent);  // エージェントが準備完了後にエイリアス作成
```

:::message alert
**`autoPrepare: true` は必須**
`autoPrepare` を省略または `false` にすると、エイリアス作成時に「エージェントが PREPARED 状態でない」エラーになります。
:::

### Lambda からの AgentCore 呼び出し

```typescript
// cdk/lambda/ai-chat/index.ts
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, InvokeModelCommand, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const agentClient = new BedrockAgentRuntimeClient({ region: 'ap-northeast-1' });
const bedrockClient = new BedrockRuntimeClient({ region: 'ap-northeast-1' });

// Vision 専用エラークラス (AgentCore エラーと区別するため)
class VisionError extends Error {
  constructor(message: string) { super(message); this.name = 'VisionError'; }
}

// Step 1: Converse API で画像を解析してテキストに変換
// ※ InvokeAgent の sessionState.files は useCase: 'CHAT' で JPEG 非対応 (ValidationException)
// ※ jp.* 推論プロファイルで Converse を使う場合 bedrock:Converse + bedrock:InvokeModel の両権限が必要
async function analyzeScreenFrame(frameBase64: string, userQuestion: string): Promise<string> {
  const question = userQuestion.trim() || 'この画面について説明してください';
  try {
    const response = await bedrockClient.send(
      new ConverseCommand({
        modelId: 'jp.anthropic.claude-sonnet-4-6',
        messages: [{
          role: 'user',
          content: [
            { image: { format: 'jpeg', source: { bytes: Buffer.from(frameBase64, 'base64') } } },
            { text: `次の質問に、画面の内容を踏まえて日本語で回答してください: ${question}` },
          ],
        }],
        inferenceConfig: { maxTokens: 1000 },
      }),
    );
    const content = response.output?.message?.content ?? [];
    return content
      .filter((b): b is { text: string } => typeof (b as Record<string, unknown>).text === 'string')
      .map((b) => b.text).join('').trim() || 'すみません、画面を分析できませんでした。';
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('Vision 解析エラー (Converse API):', msg);
    throw new VisionError(msg);
  }
}

// Step 2: AgentCore で AI 応答生成 (テキストのみ受け取る)
async function invokeAgent(sessionId: string, inputText: string): Promise<string> {
  const command = new InvokeAgentCommand({
    agentId: AGENT_ID,
    agentAliasId: AGENT_ALIAS_ID,
    sessionId,      // Chime MeetingId をそのまま使用 (UUID 形式)
    inputText,
    enableTrace: false,
  });

  const response = await agentClient.send(command);

  // レスポンスはストリーミング形式 (AsyncIterable)
  // chunk イベントを for await で逐次受信して結合する
  let aiText = '';
  for await (const event of response.completion!) {
    if (event.chunk?.bytes) {
      aiText += new TextDecoder().decode(event.chunk.bytes);
    }
  }
  return aiText.trim();
}
```

**ポイント:**
- `sessionId` は英数字・ハイフン・アンダースコアのみ、最大 100 文字。Chime MeetingId (UUID) はこの条件を満たします
- レスポンスは `completion` という AsyncIterable — `for await` でチャンクを結合する必要があります
- 画像解析は **Converse API** で行い、テキスト結果のみを `InvokeAgent` の `inputText` に含めます (`sessionState.files` への JPEG 添付は ValidationException になります)
- `jp.*` クロスリージョン推論プロファイルで Converse API を使う場合、Lambda IAM ロールに `bedrock:Converse` と `bedrock:InvokeModel` の両方が必要です

### クロスリージョン推論プロファイル (jp.anthropic.claude-sonnet-4-6)

東京リージョン向けのシステム推論プロファイル `jp.anthropic.claude-sonnet-4-6` は、ap-northeast-1 (東京) と ap-northeast-3 (大阪) にリクエストを自動分散してスループットを向上させます。

CDK の `foundationModel` にはこのプロファイル名をそのまま指定できます。

```typescript
foundationModel: 'jp.anthropic.claude-sonnet-4-6',
```

事前に Bedrock コンソールの「モデルアクセス」で以下のモデルを有効化してください:
- `Claude Sonnet 4.6` (cross-region inference 用)
- `Amazon Titan Embeddings V2` (RAG 用)

### ⚠️ AgentCore のレスポンス遅延と本番運用での代替手段

AgentCore (`InvokeAgent`) はエージェントオーケストレーション層を経由するため、**Converse API の直接呼び出しと比較して 2〜4 秒程度の追加レイテンシが発生**します。本システムでは Vision (Converse API, ~1〜3s) + RAG (~0.3s) + AgentCore (~3〜5s) + Polly (~0.5s) が直列に並ぶため、エンドツーエンドで **5〜10 秒** 程度になるのが現実です。

会議 AI のような「即レスが期待されるリアルタイム UX」では、この遅延がユーザー体験の障壁になる場合があります。

#### 本番運用での代替アーキテクチャ比較

| アーキテクチャ | E2E レイテンシ目安 | 会話履歴管理 | 主なトレードオフ |
|-------------|----------------|------------|--------------|
| **AgentCore (現構成)** | 5〜10 s | ✅ 自動 (sessionId) | セットアップが容易・遅い |
| **Bedrock Converse API + DynamoDB** | 2〜4 s | 手動 (DynamoDB) | 高速・Lambda で履歴管理が必要 |
| **Bedrock Inline Agents** | 3〜6 s | ✅ 自動 | エージェント機能+比較的新しい API |
| **Dify (セルフホスト)** | 2〜5 s | ✅ ビルトイン | 高速・別サービス運用が必要 |
| **LangChain/LangGraph on Lambda** | 2〜4 s | 実装次第 | 柔軟・コード量が増える |

#### Dify は代替手段になるか？

[Dify](https://dify.ai/) は OSS の LLM アプリケーションプラットフォームで、AgentCore + 手動 RAG を**丸ごと置き換えられる有力な選択肢**です。

**メリット:**
- ビジュアルワークフローエディタで LLM フロー・RAG・ツール連携を設定できる
- Claude を含む複数 LLM に対応し、Bedrock 経由でも呼び出し可能
- REST API が提供されるため、Lambda の `invokeAgent()` を `fetch('https://dify-host/v1/chat-messages')` に差し替えるだけで統合できる
- 組み込み RAG で Weaviate・Qdrant・pgvector・OpenSearch・Pinecone を選択可能
- ストリーミングレスポンスに対応しており、AgentCore と同様に `for await` で受け取れる
- 会話履歴・セッション管理をビルトインで持つ

**デメリット・注意点:**
- ECS/Fargate や EC2 でのセルフホストが必要（フルサーバーレスではなくなる）
- Cognito JWT による認証はカスタム実装が必要
- AWS WAF・VPC・IAM などの AWS ネイティブセキュリティとの統合に追加工数がかかる
- Dify Cloud (SaaS 版) を使えばホスト不要だが、社内データを外部 SaaS に送ることになる

**判断基準:**
- 会話フローの複雑さが増す・LLM を頻繁に切り替える → **Dify が優位**
- AWS 内で完結させたい・サーバーレスを維持したい → **Converse API + DynamoDB が現実的**
- レイテンシより機能・保守性を優先 → **AgentCore 継続も十分**

:::message
**最速構成**: Bedrock Converse API + DynamoDB (fulfillment history) + Streaming レスポンス。AgentCore の 2〜4 秒オーバーヘッドがなくなり、体感速度が大きく改善します。ただし「直前 N ターン分の履歴を毎回 API に送る」実装が必要で、Lambda のコード量は増えます。
:::

---

## 3. Amazon S3 Vectors

### S3 Vectors とは

Amazon S3 Vectors は 2025 年 12 月に一般提供が始まったベクトルデータ専用のストレージサービスです（プレビュー期間中から 40 倍のスケール向上）。従来は Pinecone や OpenSearch などのサードパーティ・サービスをベクトルDBとして利用するケースが多かった RAG 構成を、**S3 と同じ従量課金モデルで AWS のマネージドサービスとして実現**できます。

主な特徴:
- **ベクトルバケット (Vector Bucket)**: ベクトルデータを格納するコンテナ。S3 バケットに相当
- **インデックス (Index)**: 検索インデックス。次元数・距離メトリクスをあらかじめ指定
- **近似最近傍探索 (ANN)**: `QueryVectors` で意味的に近いベクトルを高速に検索

### CDK でのプロビジョニング

2026 年 3 月時点でネイティブ CloudFormation サポートはないが、`@cdklabs/generative-ai-cdk-constructs` での公式対応とコミュニティ構成が存在する。本プロジェクトは `AwsCustomResource` (SDK v3 直接呼び出し) を継続使用します。

```typescript
// S3 Vectors バケットを作成
new cr.AwsCustomResource(this, 'S3VectorBucket', {
  onCreate: {
    service: 'S3Vectors',
    action: 'CreateVectorBucket',
    // ⚠️ parameters は SDK v3 の camelCase で指定する
    parameters: { vectorBucketName: vectorBucketName },
    physicalResourceId: cr.PhysicalResourceId.of(vectorBucketName),
    ignoreErrorCodesMatching: 'BucketAlreadyExists',
  },
  onDelete: {
    service: 'S3Vectors',
    action: 'DeleteVectorBucket',
    parameters: { vectorBucketName: vectorBucketName },
  },
  policy: cr.AwsCustomResourcePolicy.fromStatements([
    new iam.PolicyStatement({
      actions: ['s3vectors:CreateVectorBucket', 's3vectors:DeleteVectorBucket'],
      resources: ['*'],
    }),
  ]),
});

// インデックスを作成
new cr.AwsCustomResource(this, 'S3VectorIndex', {
  onCreate: {
    service: 'S3Vectors',
    action: 'CreateIndex',
    parameters: {
      vectorBucketName: vectorBucketName,
      indexName: 'documents',
      dataType: 'float32',
      dimension: 1024,          // Titan Embeddings V2 の出力次元数
      distanceMetric: 'cosine', // コサイン類似度
    },
    physicalResourceId: cr.PhysicalResourceId.of(`${vectorBucketName}/documents`),
    ignoreErrorCodesMatching: 'IndexAlreadyExists',
  },
  ...
});
```

:::message alert
**AwsCustomResource の parameters は SDK v3 の camelCase**

CDK の AwsCustomResource は内部的に AWS SDK v3 を使っています。S3 Vectors の場合、パラメータ名はすべて **camelCase** です。

| ❌ 誤り (PascalCase) | ✅ 正しい (camelCase) |
|---|---|
| `VectorBucketName` | `vectorBucketName` |
| `IndexName` | `indexName` |
| `DistanceMetric` | `distanceMetric` |
| `DataType` | `dataType` |

PascalCase にするとデプロイは通るが実行時エラーになります。
:::

### RAG パイプライン: ドキュメント登録 (SQS 非同期)

API Gateway には **29 秒のハードタイムアウト**があります。大きなドキュメントを登録する場合、Titan Embeddings を逐次呼び出すと容易にこの制限を超えます。本システムでは **SQS を使った非同期アーキテクチャ**を採用し、POST リクエストを即座に 202 で返しつつ、実際の埋め込み処理をワーカー Lambda で非同期実行します。

```
POST /documents
  → ingest-document Lambda (入力検証 + SQS 送信 → 202 即時返却)
          ↓ 非同期
     SQS キュー (可視性タイムアウト 1800 秒、DLQ 付き)
          ↓
     ingest-document-worker Lambda (チャンク分割 → 埋め込み → S3 Vectors)
```

**フロントエンド側の受付 Lambda** (`ingest-document/index.ts`):

```typescript
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// タグを検証・サニタイズ (最大 10 個、各 50 文字まで)
const rawTags = body.tags;
const tags: string[] = Array.isArray(rawTags)
  ? rawTags
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 50))
      .slice(0, 10)
  : [];

// SQS メッセージサイズ上限は 256KB — 超過時は早期エラー
const messageBody = JSON.stringify({ content: content.trim(), source, userId, tags });
if (Buffer.byteLength(messageBody, 'utf8') > 250_000) {
  return { statusCode: 413, body: JSON.stringify({
    error: 'ドキュメントが大きすぎます (上限 250KB)。分割して登録してください',
  })};
}

await sqsClient.send(new SendMessageCommand({
  QueueUrl: INGEST_QUEUE_URL,
  MessageBody: messageBody,
}));

// 202 Accepted — 処理は非同期で継続
return { statusCode: 202, body: JSON.stringify({
  message: '登録リクエストを受け付けました — 数秒後に AI が参照できるようになります',
  source,
})};
```

**ワーカー Lambda** (`ingest-document-worker/index.ts`):

```typescript
import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { S3VectorsClient, PutVectorsCommand } from '@aws-sdk/client-s3vectors';

// SQS バッチ処理: 部分失敗に対応 (失敗メッセージのみ DLQ へ)
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const { content, source, userId, tags = [] } = JSON.parse(record.body);

      // 1. チャンク分割 (スライディングウィンドウ: 500字, 50字オーバーラップ)
      const chunks = splitIntoChunks(content, 500, 50);

      // 2. 並列でベクトル化 (同時 5 件でスロットリング回避)
      const vectors: VectorEntry[] = [];
      for (let i = 0; i < chunks.length; i += 5) {
        const batch = chunks.slice(i, i + 5);
        const embeddings = await Promise.all(batch.map(embedText));
        embeddings.forEach((embedding, j) => {
          vectors.push({
            key: `${userId}/${crypto.randomUUID()}`,
            data: { float32: embedding },
            // tags を各チャンクのメタデータに付与 — manage-documents で集約して返す
            metadata: { text: chunks[i + j], source, userId, chunkIndex: i + j, tags },
          });
        });
      }

      // 3. S3 Vectors に 25 件ずつバッチ書き込み
      for (let i = 0; i < vectors.length; i += 25) {
        await s3VectorsClient.send(new PutVectorsCommand({
          vectorBucketName: VECTOR_BUCKET_NAME,
          indexName: VECTOR_INDEX_NAME,
          vectors: vectors.slice(i, i + 25),
        }));
      }
    } catch (err) {
      console.error('インジェスト失敗:', record.messageId, err);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  // 失敗したメッセージのみ DLQ へ送られる (成功分は自動削除)
  return { batchItemFailures: failures };
};
```

CDK でのキューとワーカーの定義:

```typescript
// DLQ (14 日間保持)
const dlq = new sqs.Queue(this, 'IngestDocumentDlq', {
  queueName: 'chime-ai-ingest-dlq',
  retentionPeriod: cdk.Duration.days(14),
});

// メインキュー (可視性タイムアウト 30 分、最大 3 回リトライ後 DLQ へ)
const ingestQueue = new sqs.Queue(this, 'IngestDocumentQueue', {
  queueName: 'chime-ai-ingest-queue',
  visibilityTimeout: cdk.Duration.seconds(1800),
  deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
});

// ワーカー Lambda (タイムアウト 5 分)
const workerFn = new lambdaNodejs.NodejsFunction(this, 'IngestDocumentWorkerFunction', {
  entry: 'lambda/ingest-document-worker/index.ts',
  timeout: cdk.Duration.seconds(300),
  memorySize: 512,
  environment: commonEnv,
});

// SQS トリガー (バッチサイズ 1、部分失敗レポート有効)
workerFn.addEventSource(new lambdaEventSources.SqsEventSource(ingestQueue, {
  batchSize: 1,
  reportBatchItemFailures: true,
}));
```

### RAG パイプライン: クエリ時の検索

```typescript
// cdk/lambda/ai-chat/index.ts
import { S3VectorsClient, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';

async function retrieveContext(queryText: string, topK = 3): Promise<string> {
  // 1. クエリテキストをベクトル化
  const queryVector = await embedText(queryText);

  // 2. S3 Vectors で近似最近傍探索
  const result = await s3VectorsClient.send(
    new QueryVectorsCommand({
      vectorBucketName: VECTOR_BUCKET_NAME,
      indexName: VECTOR_INDEX_NAME,
      queryVector: { float32: queryVector },  // camelCase
      topK: topK,
      returnMetadata: true,
    }),
  );

  if (!result.vectors || result.vectors.length === 0) return '';

  // 3. 上位 K 件のチャンクを出典付きで結合
  return result.vectors.map((v, i) => {
    const meta = v.metadata as { text?: string; source?: string };
    return `[${i + 1}] (出典: ${meta?.source ?? '不明'})\n${meta?.text ?? ''}`;
  }).join('\n\n');
}
```

:::message
**なぜ Bedrock Knowledge Bases を使わないのか**

Bedrock AgentCore に Knowledge Base をアタッチする構成が AWS のベストプラクティスですが、本システムでは Lambda で手動 RAG を実装しています。理由は**マルチモーダル入力との共存**です。

Lambda で自前 Retrieve を行うことで、RAG の結果を XML タグ (`<context>`, `<user_input>`) で明示的に構造化し、プロンプトインジェクション対策とプロンプトの柔軟な制御が可能になります。

画面共有がある場合は **Vision (Converse API) と RAG を `Promise.allSettled` で並列実行**し、両コンテキストを AgentCore に渡します。Vision が失敗した場合 (`VisionError`) は RAG のみで応答を継続するグレースフォールバック設計です。
:::

### Titan Embeddings V2 でのベクトル化

```typescript
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

async function embedText(text: string): Promise<number[]> {
  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: 'amazon.titan-embed-text-v2:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify({
        inputText: text.slice(0, 8000),  // 最大入力文字数制限
        dimensions: 1024,                 // S3 Vectors インデックスと揃える
        normalize: true,                  // コサイン距離用に正規化
      })),
    }),
  );
  const body = JSON.parse(new TextDecoder().decode(response.body));
  return body.embedding;
}
```

:::message
**Titan Embeddings V2 の次元削減でコスト最適化**

今回は標準の `dimensions: 1024` を使用していますが、Titan Embeddings V2 は**次元数を削減しても精度がほとんど落ちない**のが特徴です。

| dimensions | 精度 (MTEB 相対) | ストレージ / レイテンシ |
|------------|----------------|----------------------|
| 1024 (標準) | 100% | 標準 |
| 512 | 約 99% | 1/2 |
| 256 | 約 97% | 1/4 |

`dimensions: 256` に設定する場合は S3 Vectors インデックスの `dimension` 値も合わせて変更してください。コンテンツの量が増えてくる本番環境では 256 次元を検討する価値があります。
:::

### ⚠️ S3 Vectors のコスト優位性と本番 RAG 性能の限界

本システムが S3 Vectors を採用した理由は**コストと AWS ネイティブ統合**です。しかし本番環境でドキュメント数やクエリ数が増えると、S3 Vectors の制約が顕在化します。

#### S3 Vectors の現時点での制約

- **サーバーサイドフィルタリングがない**: `userId` によるユーザー分離は `topK * 5` を取得してクライアント側でフィルタする方式（本実装）。ドキュメント数が増えると無駄なデータ転送・計算が増える
- **ページネーション必須**: `ListVectors` は全件スキャンのため、一覧取得は件数に比例して遅くなる
- **ANN 精度の透明性**: S3 Vectors の近似最近傍探索のアルゴリズム詳細は非公開。チューニング余地が限られる
- **サービス成熟度**: 2025 年 12 月 GA のため、エコシステム・SDK・コミュニティ事例がまだ少ない

#### ベクトル DB の本番性能比較

| サービス | クエリ遅延 | メタデータフィルタ | スケール | コスト感 | 推奨シナリオ |
|---------|----------|-----------------|--------|---------|-----------|
| **S3 Vectors** | ~100 ms | クライアント側のみ | 2B vec/index | 非常に安い | PoC・小〜中規模・コスト最優先 |
| **Bedrock Knowledge Bases** | ~50〜100 ms | ✅ 豊富 | 大規模対応 | 中 | AWS マネージド RAG・AgentCore との統合 |
| **OpenSearch Serverless (k-NN)** | ~20〜50 ms | ✅ 豊富 | 大規模対応 | 中〜高 | AWS 内完結・高スループット |
| **Aurora PostgreSQL + pgvector** | ~10〜50 ms | ✅ SQL で柔軟 | 中規模 | 中 | 既存 RDB との共存・複合クエリ |
| **Pinecone** | ~5〜20 ms | ✅ 豊富 | 数十億 vec | 従量課金 | 検索精度・速度最優先 |
| **Qdrant** | ~5〜10 ms | ✅ 豊富 | 数十億 vec | セルフホスト or クラウド | 高性能 OSS・Dify との相性◎ |
| **Weaviate** | ~10〜30 ms | ✅ 豊富 | 大規模対応 | セルフホスト or クラウド | OSS・マルチモーダル対応 |

#### 本番移行時の推奨構成

**AWS 内で完結させたい場合 → Bedrock Knowledge Bases が最有力**

```
S3 (PDF/テキスト保存)
  ↓ 自動同期
Bedrock Knowledge Bases
  └─ OpenSearch Serverless (managed)
       ↓ Retrieve API
Bedrock AgentCore (Knowledge Base をアタッチ)
```

AgentCore に Knowledge Base を直接アタッチする公式構成を取ることで、手動 RAG (`retrieveContext()`) と S3 Vectors が不要になります。ただし Vision (Converse API) との組み合わせには引き続き自前実装が必要です。

**コストと性能のバランスを取るなら → Aurora pgvector**

既に Aurora を使っているシステムであれば `pgvector` 拡張を有効化するだけでベクトル検索が追加でき、SQL の `WHERE user_id = $1` でサーバーサイドフィルタリングが実現します。S3 Vectors のクライアントフィルタ問題を根本解決できます。

**Dify と組み合わせるなら → Qdrant または Weaviate**

Dify はこれらのベクトル DB とネイティブ統合しており、管理 UI 上でドキュメントのアップロード・チャンク設定・RAG クエリのデバッグができます。

:::message
**移行戦略のポイント**

S3 Vectors → 別ベクトル DB への移行は、`ingest-document-worker/index.ts` と `ai-chat/index.ts` の `PutVectorsCommand` / `QueryVectorsCommand` 呼び出しを新しい SDK に差し替えるだけです。フロントエンドと他の Lambda は変更不要です。本番スケールに達した時点で移行を検討してください。
:::

---

## 4. AI 会話フロー全体

ユーザーが発話してから AI が音声で応答するまでの処理フローです。

```
1. ブラウザで音声を録音 (Chime SDK / Web Speech API)
     ↓
2. Amazon Transcribe で書き起こし (ja-JP)
     ↓
3. POST /ai-chat { text, sessionId, frame? }
     ↓
4. Lambda: frame あり → Vision + RAG を Promise.allSettled で並列実行
          frame なし → RAG のみ実行

   [Vision パス (frame あり)]           [RAG パス (常時)]
   Bedrock Converse API (JPEG 解析)      Titan Embeddings V2 でクエリをベクトル化
   ↓ frameAnalysis (テキスト)            ↓
   Vision 失敗時は VisionError → 空文字  S3 Vectors で類似チャンクを上位 3 件検索
     ↓
5. inputText を XML タグで組み立て (プロンプトインジェクション対策):
   - Vision + RAG あり: [画面解析結果] + <context>RAG</context> + <user_input>発話</user_input>
   - Vision のみ:       [画面解析結果] + <user_input>発話</user_input>
   - RAG のみ:          <context>RAG</context> + <user_input>発話</user_input>
   - それ以外:           <user_input>発話</user_input>
     ↓
6. Bedrock AgentCore InvokeAgent (sessionId で会話履歴を継続)
     ↓ (AsyncIterable でストリーミング受信)
7. Amazon Polly Neural TTS で音声合成 (Kazuha, ja-JP, mp3)
     ↓
8. { text, audio: Base64MP3, ragUsed, visionError? } をブラウザに返却
     ↓
9. ブラウザ: Audio API で再生 + AI アバターをアニメーション
   ※ visionError がある場合はコンソールに警告を出力 (Vision が失敗しRAGで応答した旨)
```

### Lambda ハンドラ全体像

RAG → AgentCore → Polly → DynamoDB 保存を繋ぐエントリーポイントです。

<details><summary>ai-chat Lambda ハンドラの完全なコードを見る</summary>

```typescript
// cdk/lambda/ai-chat/index.ts (handler 関数)
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  const userId = event.requestContext.authorizer?.claims?.sub as string | undefined;
  if (!userId) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: '認証が必要です' }) };

  try {
    const { text, sessionId, frame } = JSON.parse(event.body ?? '{}');
    if (!text?.trim()) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'text フィールドが必要です' }) };
    if (!sessionId)    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'sessionId フィールドが必要です' }) };

    // 1. Vision と RAG を並列実行 (Promise.allSettled で Vision 失敗時も継続)
    let frameAnalysis = '';
    let ragContext = '';
    let visionError = '';
    if (frame) {
      const [visionResult, ragResult] = await Promise.allSettled([
        analyzeScreenFrame(frame, text),
        retrieveContext(text),
      ]);
      if (visionResult.status === 'fulfilled') {
        frameAnalysis = visionResult.value;
      } else {
        // Vision 失敗: エラー詳細を保持し、RAG のみで応答を継続
        visionError = visionResult.reason instanceof Error
          ? `${visionResult.reason.name}: ${visionResult.reason.message}`
          : String(visionResult.reason);
        console.error('Vision 失敗のため RAG のみで継続:', visionError);
      }
      ragContext = ragResult.status === 'fulfilled' ? ragResult.value : '';
    } else {
      ragContext = await retrieveContext(text);
    }

    // 2. XML タグでユーザー入力を分離 → プロンプトインジェクション対策
    const inputText = frameAnalysis && ragContext
      ? `[画面共有の解析結果]\n${frameAnalysis}\n\n[参考情報]\n<context>\n${ragContext}\n</context>\n\nユーザーの発言:\n<user_input>\n${text || '（この画面について教えてください）'}\n</user_input>`
      : frameAnalysis
        ? `[画面共有の解析結果]\n${frameAnalysis}\n\nユーザーの発言:\n<user_input>\n${text || '（この画面について教えてください）'}\n</user_input>`
        : ragContext
          ? `[参考情報]\n<context>\n${ragContext}\n</context>\n\nユーザーの発言を元に回答してください。\n<user_input>\n${text}\n</user_input>`
          : `<user_input>\n${text}\n</user_input>`;

    // 3. Bedrock AgentCore で AI 応答を生成
    //    sessionId = Chime MeetingId → AgentCore がセッション単位で会話履歴を自動管理
    const aiText = await invokeAgent(sessionId, inputText);

    // 4. Polly で音声合成
    const pollyResponse = await pollyClient.send(
      new SynthesizeSpeechCommand({
        Engine: 'neural', OutputFormat: 'mp3',
        VoiceId: 'Kazuha', LanguageCode: 'ja-JP',
        Text: aiText.slice(0, 2800),
      }),
    );
    const audioBase64 = Buffer.from(
      await pollyResponse.AudioStream!.transformToByteArray()
    ).toString('base64');

    // 5. 利用記録を DynamoDB に非同期保存 (失敗しても本体処理を継続)
    // ※ recordUsage は DynamoDBDocumentClient.send(new PutCommand({...})) を行うヘルパー関数
    //   userId / sk(YYYYMMDD#uuid) / sessionId / userMessage / aiResponse / ragUsed / frameAnalyzed を保存
    recordUsage({ userId, sessionId, userMessage: text, aiResponse: aiText,
      ragUsed: ragContext.length > 0, frameAnalyzed: !!frame }).catch(console.error);

    return {
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({
        text: aiText, audio: audioBase64, ragUsed: ragContext.length > 0,
        ...(visionError ? { visionError } : {}),  // Vision 失敗時はデバッグ用エラー詳細を返す
      }),
    };
  } catch (error) {
    console.error('AI チャットエラー:', error);
    return {
      statusCode: 500, headers: corsHeaders,
      body: JSON.stringify({ error: 'AI の応答生成に失敗しました',
        message: error instanceof Error ? error.message : String(error) }),
    };
  }
};
```

</details>

---

## 5. Amazon Polly Neural TTS

AI の返答テキストを音声で出力するために Amazon Polly を使います。

```typescript
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

const pollyResponse = await pollyClient.send(
  new SynthesizeSpeechCommand({
    Engine: 'neural',           // Neural エンジン (自然な音声)
    OutputFormat: 'mp3',
    VoiceId: 'Kazuha',          // 日本語女性音声。男性は 'Takumi'
    LanguageCode: 'ja-JP',
    Text: aiText.slice(0, 2800), // Polly の文字数制限
  }),
);

const audioBytes = await pollyResponse.AudioStream!.transformToByteArray();
const audioBase64 = Buffer.from(audioBytes).toString('base64');
```

ブラウザ側では `AudioContext` を使ってメモリ上で完全に MP3 を再生します (`useAIConversation.ts`)。

```typescript
// Base64 → ArrayBuffer → AudioBufferSourceNode で再生
const binary = atob(base64Audio);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
const arrayBuffer = bytes.buffer.slice(0);  // slice(0) でコピー: decodeAudioData が所有権を取得するため

const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
const source = ctx.createBufferSource();
source.buffer = audioBuffer;
source.connect(ctx.destination);
source.start(0);
```

:::message
**`new Audio()` でなく `AudioContext` を使う理由**

`new Audio().play()` は iOS では **ユーザージェスチャー外** で呼ぶと失敗します (`NotAllowedError`)。`AudioContext` はユーザージェスチャー (マイクボタン押下など) で一度 `resume()` を呼べば、以降はジェスチャーなしで再生できます。

```typescript
// マイクボタン等のクリック時に呼ぶ (iOS 対応のためのアンロック)
const unlockAudio = () => {
  if (!audioContextRef.current) {
    const AudioCtx = window.AudioContext ?? (window as any).webkitAudioContext;
    audioContextRef.current = new AudioCtx();
  }
  if (audioContextRef.current.state === 'suspended') {
    void audioContextRef.current.resume();
  }
};
```
:::

### 音声レスポンスの体感速度を改善する

**問題:** ユーザーから「AI の音声レスポンスが遅い」との報告がありました。調査すると、`useAIConversation.ts` の `sendTranscript` 関数が以下の構造になっていました:

```typescript
// ❌ 問題のあるコード: 音声再生完了まで "処理中" が続く
try {
  const data = await fetch(...).json();
  setMessages([...prev, { role: 'assistant', content: data.text }]);
  if (data.audio) await playAudio(data.audio);  // ← ここまで isProcessing = true
} catch { ... } finally {
  setIsProcessing(false);  // ← 音声が終わるまでずっと処理中
}
```

**原因:** `setIsProcessing(false)` が `finally` ブロックにあったため、音声の再生が完了するまで UI が "処理中" のままでした。テキスト表示は即座なのに、次のメッセージを送れない状態が続いていました。

**解決策:** `setIsProcessing(false)` を `await playAudio()` の**前**に移動します:

```typescript
// ✅ 修正後: テキスト表示後すぐに処理完了扱いにする
const data = await fetch(...).json();
setMessages([...prev, { role: 'assistant', content: data.text }]);
setAiText(data.text);

// ← ここで処理完了: 音声再生中でも次の質問を送れる
setIsProcessing(false);

// 音声再生は await するが、isProcessing はすでに false
if (data.audio) await playAudio(data.audio);
```

これにより、AI テキストが画面に表示された瞬間にチャット入力が有効になり、体感レスポンスが大幅に向上します。

---

## 6. Amazon Cognito によるユーザー認証

### ユーザープールの CDK 定義

```typescript
const userPool = new cognito.UserPool(this, 'UserPool', {
  selfSignUpEnabled: true,
  signInAliases: { email: true },
  autoVerify: { email: true },
  passwordPolicy: {
    minLength: 8,
    requireLowercase: true,
    requireUppercase: true,
    requireDigits: true,
    requireSymbols: false,
  },
  removalPolicy: cdk.RemovalPolicy.DESTROY,  // 詳細は後述
});
```

### API Gateway に Cognito Authorizer を設定

```typescript
const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
  cognitoUserPools: [userPool],
  identitySource: 'method.request.header.Authorization',
  resultsCacheTtl: cdk.Duration.minutes(5),
});

// 全エンドポイントに認証を必須化
const authMethodOptions: apigateway.MethodOptions = {
  authorizer: cognitoAuthorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
};
```

Lambda では `event.requestContext.authorizer.claims.sub` でユーザー ID を取得できます。

```typescript
const userId = event.requestContext.authorizer?.claims?.sub as string;
```

### フロントエンドの認証 (AWS Amplify v6)

```typescript
// main.tsx — アプリ起動時に Amplify を設定
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: COGNITO_USER_POOL_ID,     // 環境変数 VITE_COGNITO_USER_POOL_ID
      userPoolClientId: COGNITO_CLIENT_ID,  // 環境変数 VITE_COGNITO_CLIENT_ID
      signUpVerificationMethod: 'code',
      loginWith: { email: true },
    },
  },
});
```

:::message alert
**手動デプロイ (zip アップロード) 時の注意点**

Amplify の「環境変数」設定はソースコードから Amplify がビルドする場合にのみ有効です。本システムのように手動で `dist/` を zip アップロードする場合、環境変数はビルド時に Vite の `import.meta.env` として静的に埋め込む必要があります。

```bash
VITE_API_URL="$API_URL" \
VITE_COGNITO_USER_POOL_ID="$COGNITO_USER_POOL_ID" \
VITE_COGNITO_CLIENT_ID="$COGNITO_CLIENT_ID" \
npm run build
```
:::

---

## 7. RAG 管理: ドキュメント一覧・削除

### manage-documents Lambda

S3 Vectors に登録済みのドキュメントを一覧表示・削除するための Lambda です。`GET /documents` と `DELETE /documents` の 2 つのメソッドを 1 つの Lambda で処理します。

```typescript
// cdk/lambda/manage-documents/index.ts
import {
  S3VectorsClient,
  ListVectorsCommand,
  DeleteVectorsCommand,
} from '@aws-sdk/client-s3vectors';

// GET /documents — S3 Vectors を全ページ取得し userId フィルタ後に source でグループ化
if (event.httpMethod === 'GET') {
  const allVectors: VectorItem[] = [];
  let nextToken: string | undefined;

  // ListVectors はページネーション対応 — nextToken がなくなるまで繰り返す
  do {
    const result = await s3VectorsClient.send(
      new ListVectorsCommand({
        vectorBucketName: VECTOR_BUCKET_NAME,
        indexName: VECTOR_INDEX_NAME,
        returnMetadata: true,
        maxResults: 100,
        nextToken,
      }),
    );
    const items = (result.vectors ?? []).filter(
      (v) => (v.metadata as Record<string, string>)?.userId === userId,
    );
    allVectors.push(...items);
    nextToken = result.nextToken;
  } while (nextToken);

  // source でグループ化してドキュメント単位に集約 (タグはチャンク横断でユニーク集約)
  const grouped = allVectors.reduce<Record<string, DocumentGroup>>((acc, v) => {
    const meta = v.metadata as Record<string, unknown>;
    const source = (meta?.source as string) ?? '不明';
    if (!acc[source]) {
      acc[source] = { source, count: 0, keys: [], createdAt: meta?.createdAt as string, tags: [] };
    }
    acc[source].count++;
    acc[source].keys.push(v.key!);
    // タグはチャンクごとに同じ値が入っているが、ユニークにマージ
    const chunkTags = Array.isArray(meta?.tags) ? (meta.tags as string[]) : [];
    for (const tag of chunkTags) {
      if (!acc[source].tags.includes(tag)) acc[source].tags.push(tag);
    }
    return acc;
  }, {});

  return { statusCode: 200, body: JSON.stringify({ documents: Object.values(grouped) }) };
}

// DELETE /documents — source 指定またはキー配列で削除
if (event.httpMethod === 'DELETE') {
  const { source, keys: directKeys } = JSON.parse(event.body ?? '{}');

  // source 指定の場合は対応キーを収集
  let keysToDelete: string[] = directKeys ?? [];
  if (source && keysToDelete.length === 0) {
    const listed = await listAllVectors(userId);
    keysToDelete = listed
      .filter((v) => (v.metadata as Record<string, string>)?.source === source)
      .map((v) => v.key!);
  }

  // 25 件ずつバッチ削除
  for (let i = 0; i < keysToDelete.length; i += 25) {
    await s3VectorsClient.send(
      new DeleteVectorsCommand({
        vectorBucketName: VECTOR_BUCKET_NAME,
        indexName: VECTOR_INDEX_NAME,
        keys: keysToDelete.slice(i, i + 25),
      }),
    );
  }
  return { statusCode: 200, body: JSON.stringify({ deleted: keysToDelete.length }) };
}
```

**ポイント:**
- ベクトルキーを `${userId}/${uuid}` 形式にすることで、ユーザーごとのスコープを実現
- `source` メタデータで元のドキュメントを識別し、チャンク単位 → ドキュメント単位に集約
- `ListVectorsCommand` はページネーション必須 — `nextToken` がなくなるまでループ

### CDK: manage-documents の追加

```typescript
// S3VectorsPolicy に ListVectors と DeleteVectors を追加
const s3VectorsPolicy = new iam.PolicyStatement({
  actions: [
    's3vectors:PutVectors',
    's3vectors:QueryVectors',
    's3vectors:ListVectors',   // manage-documents で追加
    's3vectors:DeleteVectors', // manage-documents で追加
  ],
  resources: ['*'],
});

const manageDocumentsFn = new lambdaNodejs.NodejsFunction(this, 'ManageDocumentsFunction', {
  functionName: 'chime-ai-manage-documents',
  entry: 'lambda/manage-documents/index.ts',
  timeout: cdk.Duration.seconds(60),
  memorySize: 256,
  environment: commonEnv,
});
manageDocumentsFn.addToRolePolicy(s3VectorsPolicy);

// documentsResource に GET / DELETE メソッドを追加
documentsResource.addMethod('GET',    new apigateway.LambdaIntegration(manageDocumentsFn), authMethodOptions);
documentsResource.addMethod('DELETE', new apigateway.LambdaIntegration(manageDocumentsFn), authMethodOptions);
```

### RAGManagement コンポーネント

```typescript
// frontend/src/components/RAGManagement.tsx (抜粋)
interface RAGDocument {
  source: string;
  chunks: number;
  createdAt: string;
  keys: string[];
  tags?: string[];  // ← メタデータタグ (省略可能)
}

export function RAGManagement({ getIdToken, onBack }: Props) {
  const [documents, setDocuments] = useState<RAGDocument[]>([]);

  // ... fetchDocuments / handleDelete は省略 ...

  return (
    <div>
      {documents.map((doc) => (
        <div key={doc.source}>
          <div>{doc.source}</div>
          <div>{doc.chunks} チャンク</div>

          {/* タグバッジ: 登録時にタグを付けた場合のみ表示 */}
          {doc.tags && doc.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {doc.tags.map((tag) => (
                <span key={tag} style={{
                  fontSize: 10, padding: '1px 7px', borderRadius: 10,
                  background: 'rgba(102,126,234,0.15)', color: '#a78bfa',
                  border: '1px solid rgba(102,126,234,0.3)', fontWeight: 600,
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          <button onClick={() => setConfirmDelete(doc)}>削除</button>
        </div>
      ))}
    </div>
  );
}
```

---

## 8. PDF・テキストファイルの登録対応

### ブラウザ内 PDF テキスト抽出 (pdfjs-dist)

`DocumentUpload` コンポーネントはテキスト直接入力に加え、ファイルアップロードに対応しています。

```typescript
// frontend/src/components/DocumentUpload.tsx
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Vite の ?url サフィックスで Worker ファイルの URL を取得
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const texts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return texts.join('\n');
}

// フォームの状態 (タグ入力フィールドを追加)
const [source, setSource] = useState('');
const [tagsInput, setTagsInput] = useState('');  // カンマ区切りのタグ入力
const [content, setContent] = useState('');

// 送信時にタグをパース
const handleSubmit = async (e: FormEvent) => {
  const tags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  await fetch(`${API_URL}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      content: content.trim(),
      source: source.trim() || '未設定',
      ...(tags.length > 0 ? { tags } : {}),  // タグがある場合のみ送信
    }),
  });
};

// JSX: 出典名 → タグ → ファイル読み込み → テキストエリア の順
<input value={source} placeholder="出典名 (例: 社内FAQ、製品仕様書)" onChange={...} />
<input
  value={tagsInput}
  placeholder="タグ (カンマ区切り、例: 技術,FAQ,2024)"
  onChange={(e) => setTagsInput(e.target.value)}
/>

// ファイル読み込みボタン: .txt .md .csv .log .pdf に対応
<input
  type="file"
  accept=".txt,.md,.csv,.log,.pdf"
  onChange={async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.pdf')) {
      setIsExtracting(true);
      const text = await extractPdfText(file);
      setContent(text);
      setIsExtracting(false);
    } else {
      const text = await file.text();
      setContent(text);
    }
  }}
/>
```

### Vitest でのモック方法

`pdfjs-dist` は内部で `DOMMatrix` を参照しますが、Vitest の jsdom 環境には `DOMMatrix` が存在しないためインポートだけでクラッシュします。テストファイルの先頭で `vi.mock` を使います。

```typescript
// src/__tests__/components/DocumentUpload.test.tsx
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
```

:::message alert
**`vi.mock` はファイルの先頭 (import より前) に書く**

Vitest (Vite) はビルド時に `vi.mock` 呼び出しをホイスト (巻き上げ) します。import より後に書いても機能しますが、他のモックと一貫性を保つため先頭に置くのが慣例です。
:::

---

## 9. ユーザー管理

### Lambda: user-management

Cognito ユーザー情報の取得とアカウント削除を担う Lambda です。Cognito Admin API を使用するため `cognito-idp:AdminGetUser` / `cognito-idp:AdminDeleteUser` 権限が必要です。

```typescript
// cdk/lambda/user-management/index.ts
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

// GET /users — Cognito からユーザー情報を取得
if (event.httpMethod === 'GET') {
  const result = await cognitoClient.send(
    new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId,  // Cognito sub (UUID)
    }),
  );
  const email = result.UserAttributes?.find((a) => a.Name === 'email')?.Value ?? '';
  return {
    statusCode: 200,
    body: JSON.stringify({
      userId, email,
      status: result.UserStatus,
      createdAt: result.UserCreateDate?.toISOString(),
    }),
  };
}

// DELETE /users — アカウント削除 + DynamoDB データ削除
if (event.httpMethod === 'DELETE') {
  // 1. Cognito ユーザーを削除 (サーバー側のセッションを無効化)
  await cognitoClient.send(
    new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }),
  );

  // 2. DynamoDB の利用記録を一括削除 (BatchWriteCommand で 25 件ずつ)
  const records = await docClient.send(
    new QueryCommand({ TableName: USAGE_TABLE, KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId } }),
  );
  const items = records.Items ?? [];
  for (let i = 0; i < items.length; i += 25) {
    await docClient.send(new BatchWriteCommand({
      RequestItems: {
        [USAGE_TABLE]: items.slice(i, i + 25).map((item) => ({
          DeleteRequest: { Key: { userId: item.userId, sk: item.sk } },
        })),
      },
    }));
  }
  return { statusCode: 200, body: JSON.stringify({ message: 'アカウントを削除しました' }) };
}
```

### useAuth: deleteAccount

フロントエンドの `useAuth` フックは `DELETE /users` を呼び出し、成功後に Amplify の `signOut()` でクライアント側セッションをクリアします。

```typescript
// frontend/src/hooks/useAuth.ts
const deleteAccount = useCallback(async () => {
  const token = await getIdToken();
  const response = await fetch(`${API_URL}/users`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? 'アカウント削除に失敗しました');
  }
  await signOut();   // ⚠️ AdminDeleteUser はサーバー側のみ削除
  setUser(null);     //    フロントエンドで明示的に signOut() を呼ぶ必要がある
  setStatus('unauthenticated');
}, [getIdToken]);
```

:::message alert
**`AdminDeleteUser` 後は必ず `signOut()` を呼ぶ**

`AdminDeleteUser` はサーバー側の Cognito ユーザーを削除しますが、ブラウザの Amplify セッション (ID トークン・リフレッシュトークン) はそのまま残ります。削除後に `signOut()` を呼ばないと、トークンが有効な間はログイン状態が続いてしまいます。
:::

### UserProfile コンポーネント: 誤操作防止の確認フロー

アカウント削除は取り消しができないため、`"DELETE"` という文字列を手入力させる確認フローを実装しています。

```typescript
// frontend/src/components/UserProfile.tsx
const [showConfirm, setShowConfirm] = useState(false);
const [confirmText, setConfirmText] = useState('');

// 第 1 段階: "アカウントを削除する" ボタン → 確認ボックスを表示
// 第 2 段階: "DELETE" と手入力 → "完全に削除する" ボタンが有効化
<button
  onClick={handleDeleteAccount}
  disabled={confirmText !== 'DELETE' || deleting}
>
  {deleting ? '削除中...' : '完全に削除する'}
</button>
```

削除完了後、`useAuth.deleteAccount()` → `signOut()` の順で処理されるため、ユーザーは自動的にログイン画面へ遷移します。

---

## 10. AWS CDK でのインフラ管理

### RemovalPolicy.DESTROY を選ぶ理由

CDK のデフォルトである `RemovalPolicy.RETAIN` は本番データ保護に有効ですが、**開発・再デプロイ時に大きな問題**になります。

```
1. CDK デプロイが何らかの理由で失敗
2. スタックが ROLLBACK_COMPLETE 状態になる
3. CDK で再デプロイしようとすると「ROLLBACK_COMPLETE 状態には deploy できない」エラー
4. `aws cloudformation delete-stack` でスタックを削除
5. DynamoDB テーブルは RETAIN のため削除されずに残存
6. 再デプロイ時に「Resource already exists」エラー
7. 手動で DynamoDB テーブルを削除してから再試行 → (2 に戻る)
```

テンプレート・開発用途では `RemovalPolicy.DESTROY` を採用し、`deploy.sh` でスタック状態を自動チェックする方法が実用的です。

```typescript
// DynamoDB テーブル
const usageTable = new dynamodb.Table(this, 'UsageTable', {
  ...
  removalPolicy: cdk.RemovalPolicy.DESTROY,  // スタック削除時に一緒に削除
});
```

### deploy.sh: スタック状態の自動チェック

```bash
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DOES_NOT_EXIST")

if [ "$STACK_STATUS" = "ROLLBACK_COMPLETE" ]; then
  echo "ROLLBACK_COMPLETE のためスタックを削除して再作成します..."
  aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"
fi
```

### Amplify デプロイ: 進行中ジョブのキャンセル

Amplify の手動デプロイでは、前のジョブが PENDING/RUNNING のまま残ると次のデプロイが `BadRequestException` になります。

```bash
# 進行中のジョブを自動キャンセル
RUNNING_JOB=$(aws amplify list-jobs \
  --app-id "$AMPLIFY_APP_ID" --branch-name main --region "$REGION" \
  --max-results 1 \
  --query 'jobSummaries[?status==`RUNNING` || status==`PENDING`].jobId' \
  --output text)

if [ -n "$RUNNING_JOB" ] && [ "$RUNNING_JOB" != "None" ]; then
  aws amplify stop-job \
    --app-id "$AMPLIFY_APP_ID" --branch-name main \
    --job-id "$RUNNING_JOB" --region "$REGION" > /dev/null
  sleep 3
fi
```

また、デプロイ完了を確認してからスクリプトを終了するよう SUCCEED/FAILED まで polling します。

```bash
for i in $(seq 1 30); do
  sleep 10
  JOB_STATUS=$(aws amplify get-job \
    --app-id "$AMPLIFY_APP_ID" --branch-name main \
    --job-id "$JOB_ID" --region "$REGION" \
    --query 'job.summary.status' --output text)
  [ "$JOB_STATUS" = "SUCCEED" ] || [ "$JOB_STATUS" = "FAILED" ] && break
done
```

### CI/CD パイプライン: CodeCommit + CodePipeline + Amplify

`deploy.sh` による手動デプロイは手軽ですが、本番運用では**コードの変更が自動でデプロイされる CI/CD パイプライン**が必要です。本システムでは以下の構成を採用しています。

#### リポジトリ構成 (モノレポ)

```
chime-ai-meeting/  (CodeCommit リポジトリ)
├── amplify.yml          # Amplify フロントエンドビルド設定
├── buildspec-cdk.yml    # CodeBuild CDK デプロイ設定
├── frontend/            # React アプリ
└── cdk/                 # CDK インフラ定義
```

フロントエンドとインフラを単一の CodeCommit リポジトリで管理するモノレポ構成です。

#### 自動トリガーの仕組み

```
git push → CodeCommit (main ブランチ)
              │
              ├─→ Amplify (自動ビルド)
              │    amplify.yml に従い npm run build → デプロイ
              │
              └─→ EventBridge (CodeCommit 更新を検知)
                   └─→ CodePipeline
                        ├─ Source: CodeCommit からソース取得
                        └─ Deploy: CodeBuild で npx cdk deploy
```

#### buildspec-cdk.yml (CDK パイプライン)

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 24
  pre_build:
    commands:
      - cd cdk
      - npm ci
  build:
    commands:
      # ── CDK Jest テスト (スナップショット・Fine-grained・cdk-nag) ──
      - npm test -- --passWithNoTests
      # ── インフラデプロイ ───────────────────────────────────────────
      - npx cdk deploy --all --require-approval never --ci
```

#### amplify.yml (フロントエンド + テスト)

フロントエンドのビルドに加え、**ESLint → Vitest 単体テスト → ビルド → Playwright E2E テスト** の順でステージを実行します。

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - cd frontend
        - npm ci
        - npx playwright install chromium --with-deps
    build:
      commands:
        # ── 静的解析 ──────────────────────────────────────
        - npm run lint
        # ── 単体テスト (Vitest) ───────────────────────────
        - npm run test -- --run --reporter=verbose
        # ── ビルド ────────────────────────────────────────
        - npm run build
        # ── E2E テスト (Playwright) ───────────────────────
        # TEST_EMAIL / TEST_PASSWORD 設定時は認証テストも実行
        - |
          if [ -n "$TEST_EMAIL" ] && [ -n "$TEST_PASSWORD" ]; then
            npx playwright test --reporter=line
          else
            npx playwright test e2e/login.spec.ts --reporter=line
          fi
  artifacts:
    baseDirectory: frontend/dist
    files:
      - '**/*'
  cache:
    paths:
      - frontend/node_modules/**/*
      - frontend/.cache/ms-playwright/**/*
```

`TEST_EMAIL` / `TEST_PASSWORD` は Amplify コンソールの「環境変数」で設定します。未設定の場合は認証不要の `login.spec.ts` のみ実行され、ビルドをブロックしません。

#### CDK での CodePipeline 定義

CodePipeline は CDK でコード化できます。EventBridge ルールと組み合わせることで、CodeCommit への push を検知して自動実行します。

<details><summary>CodePipeline CDK 定義の完全なコードを見る</summary>

```typescript
// CodeBuild プロジェクト (CDK デプロイ用)
const cdkBuildProject = new codebuild.Project(this, 'CdkBuildProject', {
  projectName: 'chime-ai-cdk-deploy',
  source: codebuild.Source.codePipeline(),
  buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec-cdk.yml'),
  environment: {
    buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
    computeType: codebuild.ComputeType.SMALL,
    environmentVariables: {
      CDK_DEFAULT_ACCOUNT: { value: this.account },
      CDK_DEFAULT_REGION: { value: this.region },
    },
  },
  role: cdkDeployRole,  // AdministratorAccess が必要
});

// CodePipeline (Source → Deploy)
const pipeline = new codepipeline.Pipeline(this, 'CdkPipeline', {
  pipelineName: 'chime-ai-cdk-pipeline',
  artifactBucket: artifactBucket,
  stages: [
    {
      stageName: 'Source',
      actions: [new codepipeline_actions.CodeCommitSourceAction({
        actionName: 'Source',
        repository: codeCommitRepo,
        branch: 'main',
        output: sourceArtifact,
        trigger: codepipeline_actions.CodeCommitTrigger.EVENTS,  // EventBridge 経由
      })],
    },
    {
      stageName: 'Deploy',
      actions: [new codepipeline_actions.CodeBuildAction({
        actionName: 'CDKDeploy',
        project: cdkBuildProject,
        input: sourceArtifact,
      })],
    },
  ],
});
```

</details>

:::message
**Amplify + CodeCommit 接続時の注意**

Amplify アプリに手動デプロイ（zip アップロード）したブランチが残っている状態で `aws amplify update-app --repository ...` を実行すると、

```
BadRequestException: Cannot connect your app to repository
while manually deployed branch still exists.
```

というエラーになります。先に `aws amplify delete-branch` で手動デプロイのブランチを削除してからリポジトリ接続を行ってください。
:::

---

## 11. フロントエンド (React 19 + Vite 7)

### iOS 対応: dvh で Viewport 高さを正しく扱う

iOS Safari / Chrome では `100vh` がアドレスバーの高さを含み、画面が溢れる問題があります。CSS の `dvh` (dynamic viewport height) を使うことで実際の表示領域に合わせられます。

```css
/* app.css */
.screen-full {
  height: 100vh;
  height: 100dvh;  /* iOS Safari 対応: 動的ビューポート高さ */
}
```

### レスポンシブヘッダー

iPad などの中間サイズでヘッダーが見切れないよう、CSS メディアクエリで要素を折り畳みます。

```css
.meeting-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;      /* 溢れたら折り返す */
  gap: 8px;
  padding: 8px 16px;
}

/* 900px 以下ではメール・ステータスバッジを非表示 */
@media (max-width: 900px) {
  .hide-tablet { display: none !important; }
}

/* portrait iPad では縦方向レイアウトに切り替え */
@media (max-width: 900px) and (orientation: portrait) {
  .meeting-body { flex-direction: column; }
  .meeting-sidebar { width: 100%; max-height: 220px; }
}
```

### デバイステスト (設定画面)

設定画面でカメラプレビュー・マイクレベルメーターをテストできます。

```typescript
// カメラプレビュー + マイクレベルメーター
const stream = await navigator.mediaDevices.getUserMedia({
  video: camId ? { deviceId: { exact: camId } } : true,
  audio: micId ? { deviceId: { exact: micId } } : true,
});

// カメラプレビュー
videoRef.current.srcObject = stream;

// マイクレベルを AudioContext で可視化
const ctx = new AudioContext();
const analyser = ctx.createAnalyser();
analyser.fftSize = 256;
ctx.createMediaStreamSource(stream).connect(analyser);

const data = new Uint8Array(analyser.frequencyBinCount);
const tick = () => {
  analyser.getByteFrequencyData(data);
  const level = Math.min(100, (data.reduce((a, b) => a + b, 0) / data.length) * 2.5);
  setMicLevel(level);
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
```

### 画面共有フレームのキャプチャ (useScreenShare)

`useScreenShare` フックは `getDisplayMedia` でスクリーン共有ストリームを取得し、`captureFrame()` で現在フレームを JPEG Base64 に変換します。この Base64 文字列が `/ai-chat` API の `frame` フィールドに渡され、Lambda 経由で AgentCore の Vision 入力になります。

```typescript
// frontend/src/hooks/useScreenShare.ts
const captureFrame = useCallback((maxWidth = 1280, quality = 0.65): string | null => {
  const video = screenVideoRef.current;
  if (!video || !streamRef.current || video.videoWidth === 0) return null;

  // アスペクト比を保ちながら最大幅 1280px に縮小 (API ペイロード削減)
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);

  // "data:image/jpeg;base64," プレフィックスを除いた Base64 文字列を返す
  return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? null;
}, []);
```

**ポイント:**
- `quality: 0.65` は画質とペイロードサイズのバランス点。スクリーンショットは写真より圧縮率が高いため 65% でも十分な解像度が保たれます
- Canvas に `drawImage` することでメモリ上の中間バッファが不要になります
- `videoWidth === 0` チェックはストリーム開始直後に呼ばれた場合のガードです

:::message alert
**`setIsSharing(true)` のタイミング: `loadeddata` を待ってから**

`getDisplayMedia` でストリームを取得しても、最初のフレームが届くまで `video.videoWidth === 0` のままです。`setIsSharing(true)` を即座に呼ぶと、次の Transcribe イベントで `captureFrame()` が null を返し、AI に画面フレームが届きません。

```typescript
// NG: ストリーム設定直後に isSharing を true にすると videoWidth === 0 で null が返る
streamRef.current = stream;
screenVideoRef.current.srcObject = stream;
setIsSharing(true);  // ← ここではまだ videoWidth === 0

// OK: loadeddata イベントを待ってから isSharing を true にする
screenVideoRef.current.srcObject = stream;
await new Promise<void>((resolve) => {
  const video = screenVideoRef.current!;
  if (video.videoWidth > 0) { resolve(); return; }
  const onReady = () => { video.removeEventListener('loadeddata', onReady); resolve(); };
  video.addEventListener('loadeddata', onReady);
  setTimeout(resolve, 2000);  // フォールバック: 2 秒後に強制続行
});
screenVideoRef.current.play().catch(console.error);
setIsSharing(true);  // ← この時点では videoWidth > 0 が保証される
```
:::

:::message alert
**`<video>` は常に DOM に存在させること**

`startScreenShare()` が呼ばれた時点で `screenVideoRef.current` が `null` だと、ストリームを `srcObject` に接続できません。`<video>` を条件付きレンダリングで非表示/表示切り替えすると ref が null になるケースがあります。`display: none` で常に DOM に存在させておくのが安全です。
:::

### 無音検知 / ミュート → 送信確認ダイアログ

音声認識後、ユーザーが 3 秒間無音だと「送信確認ダイアログ」が表示されます。また、**ミュートボタンを押した時点で発話テキストが溜まっている場合も即座にダイアログを表示**します。ユーザーは認識テキストを **編集してから送信** / **続けて話す** / **破棄** の 3 択を選べます。

```
[Transcribe / Web Speech API が発話を検知]
         ↓
  transcriptBuffer に積む
         ↓ (3 秒無音で debounce 発火 OR ミュートボタン押下)
  showSilenceConfirm = true → ダイアログ表示
         ↓
  ユーザーが選択:
  ├─ [AIに送る]     → confirmSend(editedText) → sendTranscript() を呼ぶ
  ├─ [続けて話す]   → confirmContinue() → buffer を保持して認識継続
  └─ [破棄]         → cancelSend() → buffer をクリア
```

ミュート時の即時ダイアログは `useMeeting.ts` の `toggleMute` 内で実装しています:

```typescript
// ミュートにする場合 (else ブランチ)
if (debounceTimerRef.current) {
  clearTimeout(debounceTimerRef.current);
  debounceTimerRef.current = null;
}
if (pendingTextRef.current.trim()) {
  showSilenceConfirmRef.current = true;
  setShowSilenceConfirm(true);  // 即時ダイアログ表示
}
```

これにより、話し終わってすぐミュートにした場合も 3 秒待たずに確認ダイアログが出るため UX がスムーズになります。

```typescript
// frontend/src/components/MeetingRoom.tsx (ダイアログ部分)
{showSilenceConfirm && (
  <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ background: '#1a1a2e', borderRadius: 16, padding: '24px 20px', maxWidth: 400 }}>
      <div>🎤 3秒間の無音を検知しました</div>
      {/* 認識テキストをそのまま編集可能にする */}
      <textarea value={editedText} onChange={(e) => setEditedText(e.target.value)} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => confirmSend(editedText)} disabled={!editedText.trim()}>
          AIに送る
        </button>
        <button onClick={confirmContinue}>続けて話す</button>
        <button onClick={cancelSend}>破棄</button>
      </div>
    </div>
  </div>
)}
```

認識精度は完璧ではないため「認識されたテキストを修正してから送信できる」UX は特に専門用語や固有名詞が多い業務会議で有効です。

### カメラ映像のキーワード自動検知

画面共有中でなく、かつユーザーの発話にカメラ関連キーワードが含まれた場合のみ、ローカルカメラのフレームを AI に送信します。以前は手動 📸 ボタンで切り替えていましたが、自然な会話の流れで「私の顔はどう見えますか」などと聞けるように改善しました。

```typescript
// frontend/src/components/MeetingRoom.tsx
function shouldCaptureCamera(text: string): boolean {
  const patterns = [/カメラ/, /映像/, /顔.*見/, /どう見え/, /私.*映/, /映.*見て/];
  return patterns.some((p) => p.test(text));
}

// AI 送信時のフレーム選択ロジック:
const frame = isSharing
  ? captureFrame()                                            // 画面共有優先
  : shouldCaptureCamera(transcript) ? captureLocalFrame()    // キーワード検知時のみ
  : null;                                                     // それ以外は送らない
```

`captureLocalFrame()` は `useMeeting` フックが提供する関数で、カメラがオフまたはダミーカメラの場合は `null` を返します。

### RAG 登録エリアの折りたたみ UI

RAG 登録フォームを常時展開しているとサイドバーの縦スペースを圧迫し、チャット履歴が見切れます。`showRagUpload` state でデフォルト折りたたみにし、トグルボタンで開閉できるようにしました。

```tsx
// frontend/src/components/MeetingRoom.tsx
const [showRagUpload, setShowRagUpload] = useState(false); // デフォルト閉じた状態

// サイドバー下部
<div style={{ borderTop: '1px solid #2a2a4a', flexShrink: 0 }}>
  <button
    onClick={() => setShowRagUpload((p) => !p)}
    style={{ width: '100%', display: 'flex', justifyContent: 'space-between',
      padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#a78bfa' }}
  >
    <span>📄 RAG 登録</span>
    <span>{showRagUpload ? '▲ 閉じる' : '▼ 開く'}</span>
  </button>
  {showRagUpload && (
    <div style={{ padding: '0 10px 10px' }}>
      <DocumentUpload getIdToken={auth.getIdToken} />
    </div>
  )}
</div>
```

### チャットバブルの文字折り返し

長い URL や英数字の連続でチャットバブルが溢れる問題は、`overflowWrap: 'anywhere'` と `maxWidth` の調整で解決します:

```tsx
// チャットバブルのスタイル
const bubbleStyle: CSSProperties = {
  maxWidth: '96%',           // 92% → 96% に拡大
  overflowWrap: 'anywhere',  // 長い単語/URLを強制折り返し
  wordBreak: 'break-word',
};
```

### AI アバター (AIParticipant コンポーネント)

会議画面の AI 参加者枠には `aibot.mp4` の動画をループ再生する `AIParticipant` コンポーネントを配置しています。状態に応じて AR 風のエフェクトが変化します。

```typescript
// frontend/src/components/AIParticipant.tsx
export function AIParticipant({ isSpeaking, isProcessing, aiText }: AIParticipantProps) {
  // 状態に応じてカラーテーマを切り替え
  const statusColor = isProcessing ? '#f59e0b'   // 解析中: 琥珀色
                    : isSpeaking   ? '#10b981'   // 応答中: エメラルド
                    :                '#00bfff';  // 待機中: シアン

  return (
    <div style={{ animation: isSpeaking ? 'speaking-pulse 1.2s ease-out infinite' : undefined }}>
      {/* AI アバター動画 — 背景映像として全面表示 */}
      <video src="/aibot.mp4" autoPlay loop muted playsInline preload="auto"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />

      {/* AR コーナーブラケット (4 隅) */}
      <div style={{ borderTop: `2px solid ${statusColor}cc`, borderLeft: `2px solid ${statusColor}cc` }} />

      {/* スキャンライン (解析中のみ表示) */}
      {isProcessing && (
        <div style={{ animation: 'scan 2s linear infinite', background: `linear-gradient(90deg, transparent, ${statusColor}cc, transparent)` }} />
      )}

      {/* ステータスバッジ: 待機中 / 解析中... / 応答中 */}
      <div>{isProcessing ? '解析中...' : isSpeaking ? '応答中' : '待機中'}</div>

      {/* 最新 AI 発言テキスト (3 行まで表示) */}
      {aiText && <div>{aiText}</div>}
    </div>
  );
}
```

| 状態 | `isSpeaking` | `isProcessing` | 表示 |
|------|-------------|---------------|------|
| 待機中 | false | false | シアンのブラケット |
| 解析中 | false | true | 琥珀色 + スキャンライン |
| 応答中 | true | false | エメラルド + パルスアニメーション |

:::message alert
**aibot.mp4 は Fast Start (moov front) 形式が必須**

`<video autoPlay>` だけでは MP4 ファイルの `moov` ボックスが末尾にある場合、ブラウザはファイル全体をダウンロードするまで再生を開始できません。この場合 `networkState: 3 (NETWORK_NO_SOURCE)` になりブラウザが `<video>` を完全に無視します。

解決策は `qt-faststart` ツール (または同等の Python スクリプト) で `moov` をファイル先頭に移動することです。さらに `useEffect` で `video.play()` を明示呼び出しし、`canplay` イベントでもリトライすることで、すべてのブラウザで確実に再生できます:

```typescript
useEffect(() => {
  const video = videoRef.current;
  if (!video) return;
  const tryPlay = () => { video.play().catch(() => {}); };
  tryPlay();
  video.addEventListener('canplay', tryPlay);
  return () => video.removeEventListener('canplay', tryPlay);
}, []);
```

また `display: 'block'` と `preload="auto"` の設定も忘れずに。
:::

:::message
**jsdom での autoPlay 属性テスト**

`<video autoPlay>` は React が JS プロパティを設定するため、jsdom 環境では `hasAttribute('autoplay')` が `false` になるケースがあります。テストでは HTML 属性ではなく **JS プロパティ** を確認するのが正確です。

```typescript
// ❌ 失敗することがある
expect(video?.hasAttribute('autoplay')).toBe(true);

// ✅ 確実
expect((video as HTMLVideoElement)?.loop).toBe(true);
expect((video as HTMLVideoElement)?.muted).toBe(true);
```
:::

---

## 12. テスト戦略: CDK Jest + Vitest + Playwright

CI/CD パイプラインの品質ゲートとして、CDK インフラテスト・フロントエンド単体テスト・E2E テスト・静的解析を整備しました。

### 単体テスト (Vitest + Testing Library)

React コンポーネントとカスタムフックを jsdom 環境でテストします。

```typescript
// frontend/vitest.config.ts
export default mergeConfig(viteConfig, defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      thresholds: { statements: 50, branches: 50, functions: 50, lines: 50 },
    },
  },
}));
```

ブラウザ API (`AudioContext`・`HTMLMediaElement`・`webkitSpeechRecognition` など) は jsdom に存在しないため、セットアップファイルでモックします。

```typescript
// src/__tests__/setup.ts
import '@testing-library/jest-dom/vitest';

// Chime SDK / Polly が内部使用する AudioContext
window.AudioContext = class {
  createAnalyser() { return { connect: vi.fn(), getByteFrequencyData: vi.fn(), frequencyBinCount: 128 }; }
  createMediaStreamSource() { return { connect: vi.fn() }; }
} as unknown as typeof AudioContext;

// HTMLMediaElement の play/pause はブラウザ実装が必要なためスタブ化
Object.defineProperty(HTMLMediaElement.prototype, 'play', { value: vi.fn().mockResolvedValue(undefined) });
Object.defineProperty(HTMLMediaElement.prototype, 'muted', { set: vi.fn(), get: () => false });

// Web Speech API フォールバック
(window as any).webkitSpeechRecognition = class {
  continuous = false; interimResults = false; lang = '';
  onresult: ((e: any) => void) | null = null;
  onerror:  ((e: any) => void) | null = null;
  onend:    (() => void) | null = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
};
```

テスト対象のコンポーネントとフック:

| ファイル | テスト数 | 主な検証内容 |
|--------|---------|------------|
| `AIParticipant.test.tsx` | 8 | アイドル・解析中・応答中の状態表示、動画要素の存在 |
| `DocumentUpload.test.tsx` | 8 | フォームの有効化条件、202 非同期レスポンス、フォームクリア |
| `LoginScreen.test.tsx` | 7 | ログイン呼び出し、モード切り替え、パスワードバリデーション |
| `useAIConversation.test.ts` | 8 | 初期状態、ガード条件、成功/エラーフロー、クリア処理 |

### E2E テスト (Playwright)

実際のブラウザを使ったエンドツーエンドテストを Playwright で実装しています。

```typescript
// frontend/playwright.config.ts
export default defineConfig({
  use: {
    baseURL: 'http://localhost:3000',
    // マイク・カメラのダミーデバイスで実機なしにテスト可能
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    permissions: ['camera', 'microphone'],
  },
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
```

#### テストファイル構成

```
frontend/e2e/
├── helpers/
│   ├── auth.ts                 # login / signup / deleteAccount ユーティリティ
│   └── meeting.ts              # enterMeetingRoom / waitForAIResponse / uploadRAGText
├── login.spec.ts               # ログイン画面 (認証不要・常時実行)
├── meeting.spec.ts             # ロビー + 会議室 UI
├── meeting-components.spec.ts  # マイク4状態・無音ダイアログ・コンポーネント網羅
├── document-upload.spec.ts     # RAG 登録フォーム
├── rag-security.spec.ts        # ユーザー間 RAG 分離 (2ユーザー必要)
├── rag-filetypes.spec.ts       # txt/md/csv 登録・250KB 超エラー
└── performance.spec.ts         # 読み込み・会議開始・AI 応答・RAG 登録の応答時間
```

共通ロジックは `helpers/` に切り出すことで各 spec が DRY になります。

```typescript
// e2e/helpers/auth.ts
export async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('button', { name: '会議を開始する' }))
    .toBeVisible({ timeout: 20_000 });
}

// e2e/helpers/meeting.ts
export async function enterMeetingRoom(page: Page, email: string, password: string) {
  await login(page, email, password);
  await page.getByRole('button', { name: '会議を開始する' }).click();
  await expect(page.locator('text=会議中')).toBeVisible({ timeout: 25_000 });
}
```

E2E テストは認証情報の有無で実行範囲を切り替えます。

```typescript
// e2e/login.spec.ts — 認証不要 (常に実行)
test('ログインフォームの要素が揃っている', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('メールアドレス')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
});

// e2e/meeting-components.spec.ts — マイクボタン4状態の確認
test('マイクボタン — ミュート解除で聴取中(シアン)に変わる', async ({ page }) => {
  await enterMeetingRoom(page, TEST_EMAIL, TEST_PASSWORD);
  const muteBtn = page.locator('button[title*="ミュート解除"]');
  await muteBtn.click();
  const bg = await page.locator('button[title*="ミュート"]').first()
    .evaluate((el) => (el as HTMLElement).style.background);
  expect(bg).toContain('06b6d4');  // シアン: 聴取中
});

// e2e/rag-security.spec.ts — ユーザー間 RAG 分離
test('User A の RAG ドキュメントが User B に見えない', async ({ browser }) => {
  // User A でログイン → RAG 登録
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await enterMeetingRoom(pageA, TEST_EMAIL, TEST_PASSWORD);
  // ... RAG 登録 ...

  // User B でログイン → 一覧に表示されないことを確認
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await login(pageB, TEST_EMAIL_2, TEST_PASSWORD_2);
  await expect(pageB.locator(`text=${SECRET_SOURCE}`)).toBeHidden();
});
```

#### テスト実行コマンド

```bash
cd frontend

# 認証不要テストのみ (ログイン画面 7件)
npx playwright test e2e/login.spec.ts --reporter=list

# 全テスト (認証必須テストは TEST_EMAIL/TEST_PASSWORD が必要)
TEST_EMAIL=your@email.com TEST_PASSWORD=yourpass \
npx playwright test --reporter=list

# RAG 分離テスト (2ユーザー必要)
TEST_EMAIL=user_a@example.com TEST_PASSWORD=passA \
TEST_EMAIL_2=user_b@example.com TEST_PASSWORD_2=passB \
npx playwright test e2e/rag-security.spec.ts --reporter=verbose
```

### Playwright MCP 連携

`.mcp.json` に `@playwright/mcp` を設定することで、Claude Code が開発中にブラウザを直接操作できます。

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--browser", "chromium"],
      "env": {
        "PLAYWRIGHT_BROWSERS_PATH": "./frontend/node_modules/.cache/ms-playwright"
      }
    }
  }
}
```

これにより「ログイン画面を確認して」「RAG フォームに文字を入力してボタンをクリックして」などの指示で Claude Code が実際のブラウザを操作し、スクリーンショット取得・UI 確認・不具合の早期発見ができます。コードレビューと並行して視覚的な動作確認が可能になります。

### Vitest Fake Timers: デバウンス処理のテスト

`useMeeting` 内の「2 秒間発話が途切れたら AI に送信する」デバウンス処理は、実時間を待たずに Vitest の Fake Timers で高速にテストできます。

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

describe('書き起こしデバウンス', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('2 秒経過するまで AI への送信関数が呼ばれないこと', () => {
    const mockSend = vi.fn();
    // accumulateTranscript で buffer に積む
    act(() => { accumulateTranscript('こんにちは'); });

    // 1 秒後: まだ送信されない
    act(() => { vi.advanceTimersByTime(1000); });
    expect(mockSend).not.toHaveBeenCalled();

    // 合計 2 秒後: 送信される
    act(() => { vi.advanceTimersByTime(1000); });
    expect(mockSend).toHaveBeenCalledWith('こんにちは');
  });
});
```

### CDK インフラテスト (Jest + cdk-nag)

フロントエンドと同様に、CDK スタックも **TDD** で開発しています。`cdk/test/chime-ai-meeting-stack.test.ts` に Jest ベースのテストを配置し、以下の 3 種類を組み合わせています。

#### ① スナップショットテスト

CloudFormation テンプレート全体を JSON としてスナップショットに保存し、インフラの意図しない変更を検出します。

```typescript
// cdk/test/chime-ai-meeting-stack.test.ts
const app = new cdk.App();
const stack = new ChimeAiMeetingStack(app, 'TestStack', {
  env: { account: '123456789012', region: 'ap-northeast-1' },
});
const template = Template.fromStack(stack);

describe('スナップショット', () => {
  test('CloudFormation テンプレートがスナップショットと一致する', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
```

インフラを意図的に変更した場合は `npm run test:update` でベースラインを更新します:

```bash
cd cdk
npm test              # 全テスト実行 (52件)
npm run test:update   # スナップショット更新
```

スナップショットファイル (`cdk/test/__snapshots__/`) はリポジトリにコミットしておくことで、PR レビュー時に CloudFormation の差分を JSON で確認できます。

#### ② Fine-grained Assertions

`template.hasResourceProperties()` や `template.resourceCountIs()` で個別リソースのプロパティを検証します。Lambda のタイムアウト・メモリ、Cognito のパスワードポリシー、DynamoDB の GSI など、設計上重要な値を明示的にテストします。

```typescript
// Cognito: セルフサインアップ有効・メールアドレス認証
describe('Cognito User Pool', () => {
  test('セルフサインアップが有効になっている', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
    });
  });

  test('パスワードポリシーが設定されている (8文字以上・大小英数記号必須)', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
    });
  });
});

// Lambda: タイムアウト・メモリ
describe('Lambda 関数', () => {
  test('ai-chat Lambda のタイムアウトが 90 秒・メモリ 512MB', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'chime-ai-chat',
      Timeout: 90,
      MemorySize: 512,
      Runtime: 'nodejs24.x',
    });
  });
});

// DynamoDB: GSI
describe('DynamoDB テーブル', () => {
  test('UsageRecords テーブルに sessionId-index GSI が定義されている', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'ChimeAiUsageRecords',
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'sessionId-index',
          Projection: { ProjectionType: 'ALL' },
        }),
      ]),
    });
  });
});
```

`Match.arrayWith()` / `Match.objectLike()` を使うと、配列の部分一致・オブジェクトの部分一致が検証できるため、CDK が自動追加するメタデータに左右されない堅牢なテストが書けます。

#### ③ cdk-nag セキュリティ監査

`cdk-nag` は AWS Well-Architected Framework のベストプラクティスを CDK レベルで検証するライブラリです。`AwsSolutionsChecks` を `Aspects` として適用すると、IAM の最小権限・Cognito の MFA・SQS の DLQ 設定などを自動チェックします。

```typescript
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: false }));

// 既知の違反は理由を明記して抑制
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-IAM5', reason: 'Bedrock/Polly/Chime はリソース ARN 指定不可のため * が必要' },
  { id: 'AwsSolutions-COG3', reason: 'AdvancedSecurityMode は追加料金のため要件外' },
  { id: 'AwsSolutions-COG7', reason: 'MFA は要件外' },
  // ...
]);

describe('cdk-nag セキュリティ監査', () => {
  test('抑制されていない ERROR レベルの nag 違反がないこと', () => {
    const errors = Annotations.fromStack(stack).findError(
      '*',
      Match.stringLikeRegexp('AwsSolutions-.*'),
    );
    expect(errors).toHaveLength(0);
  });
});
```

抑制する際は `reason` を必ず記述します。これがコードレビュー時の「なぜこのルールを例外扱いにしたか」の根拠になります。

:::message
**スタックの合成はモジュール先頭で 1 回だけ**

`new ChimeAiMeetingStack(...)` は各テストで毎回呼ぶと esbuild バンドルが複数回走り CI が遅くなります。モジュールのトップレベルで合成して `template` を共有するのがベストプラクティスです。
:::

### Lambda の AWS SDK モックテスト (aws-sdk-client-mock)

Lambda ユニットテストで実際に AWS へリクエストを送ると課金が発生し、CI の速度も落ちます。`aws-sdk-client-mock` を使えば Bedrock・S3 Vectors の応答をモック化し、プロンプト構築ロジック（XML タグ挿入・RAG コンテキスト付加など）を高速に検証できます。

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const agentMock = mockClient(BedrockAgentRuntimeClient);
const bedrockMock = mockClient(BedrockRuntimeClient);

beforeEach(() => {
  agentMock.reset();
  bedrockMock.reset();

  // Titan Embeddings のモック (1024 次元のゼロベクトルを返す)
  bedrockMock.on(InvokeModelCommand).resolves({
    body: new TextEncoder().encode(JSON.stringify({ embedding: new Array(1024).fill(0) })),
  });

  // AgentCore のモック (ストリーミング応答をシミュレート)
  agentMock.on(InvokeAgentCommand).resolves({
    completion: (async function* () {
      yield { chunk: { bytes: new TextEncoder().encode('テスト応答です') } };
    })(),
  });
});

it('RAG コンテキストが XML タグで正しく包まれる', async () => {
  const result = await invokeAgentWithContext('sessionId-123', 'S3 Vectors とは？');
  // AgentCore に渡された inputText に XML タグが含まれることを検証
  const call = agentMock.calls()[0].args[0].input;
  expect(call.inputText).toContain('<context>');
  expect(call.inputText).toContain('<user_input>');
  expect(result).toBe('テスト応答です');
});
```

### 静的解析 (ESLint + Prettier)

```bash
npm run lint        # ESLint (TypeScript + React Hooks ルール)
npm run format      # Prettier 自動整形
npm run lint:fix    # ESLint 自動修正
```

ESLint v9 のフラット設定ファイルを使用しています。`react-hooks/exhaustive-deps` を **`"error"`** にすることで、ステイルクロージャの原因となる依存配列の指定漏れをデプロイ前に検出できます（第1章の「stale closure に注意」で触れた問題がこのルールで未然に防げます）。

```javascript
// frontend/eslint.config.js
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 依存配列の指定漏れを warning ではなく error にしてデプロイをブロック
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  prettier,  // Prettier との競合ルールを無効化
);
```

---

## 13. ハマったポイントまとめ

実装中に遭遇したつまずきポイントを整理します。同じシステムを構築する方の参考になれば幸いです。

| # | 問題 | 原因 | 解決策 |
|---|------|------|--------|
| 1 | Chime SDK が AccessDenied | IAM を `chime-sdk-meetings:*` にした | CloudWatch ログを確認 → `chime:*` に変更 |
| 2 | Bedrock Agent が AccessDenied (内部) | 特定リソース ARN での `bedrock:*` でも内部エラー | `resources: ['*']` に変更 |
| 3 | S3 Vectors が InvalidParameter | AwsCustomResource の parameters が PascalCase | SDK v3 の camelCase (`vectorBucketName`) に修正 |
| 4 | Cognito Auth 未設定エラー | Amplify 手動デプロイで `VITE_COGNITO_*` が未設定 | ビルド時に環境変数を明示的に渡す |
| 5 | スタック再デプロイで Resource already exists | DynamoDB が RemovalPolicy.RETAIN で残存 | DESTROY に変更 + deploy.sh でスタック自動削除 |
| 6 | Amplify `BadRequestException` | 前のジョブが PENDING のまま | デプロイ前に `stop-job` で自動キャンセル |
| 7 | iOS で画面が見切れる | `100vh` がアドレスバーを含む | `100dvh` に変更 |
| 8 | iPad Chrome で音声認識なし | Chime Transcription が iOS 未対応 | Web Speech API をフォールバックとして追加 |
| 9 | `autoPrepare` 忘れでエイリアス作成失敗 | AgentCore が PREPARED 状態になっていない | `autoPrepare: true` を必ず指定 |
| 10 | Amplify zip が壊れる | `mktemp` + 相対パスの組み合わせ | 固定絶対パス + `cd "$FRONTEND_DIR/dist"` で確実に移動 |
| 11 | `jp.*` 推論プロファイルで "Access denied" (stream 内) | Bedrock Agent ロールに `aws-marketplace:*` がない | Agent ロールに `ViewSubscriptions` / `Subscribe` を追加 |
| 12 | 音声認識が全く動かない (認識はするが AI に届かない) | stale closure: `recognition.onresult` が古い `sendTranscript` (sessionId=null) をキャプチャ | `onTranscriptRef = useRef` パターンで常に最新の関数を参照 |
| 13 | Amplify にリポジトリ接続できない | 手動デプロイブランチが残存している | `delete-branch` で手動ブランチを先に削除してから接続 |
| 14 | RAG 登録で 504 Gateway Timeout | Titan Embeddings を API Gateway 内で同期実行 → 29 秒超過 | SQS キューで非同期化: 受付 Lambda は 202 即時返却、Worker Lambda で埋め込み処理 |
| 15 | 書き起こしが AI に 2 回届く | Chime Transcribe と Web Speech API が同じ発話に対して両方 fire | `lastAccumulatedRef` で 2 秒以内の同一テキストを重複排除 |
| 16 | 画面共有 `<video>` が表示されない | `startScreenShare()` 呼び出し時点で `screenVideoRef.current` が null (条件付きレンダリングで未マウント) | `<video>` を常に描画して非共有時は `display: none` で隠す |
| 17 | コンパイル済み `.js` が TypeScript を上書き | Vite のモジュール解決は `.js` を `.tsx` より優先するため、過去にコンパイルした `.js` が残るとそちらが読まれる | `git rm -f` で `src/` 内の `.js` を全削除し `.gitignore` に追加 |
| 18 | Playwright テストで `getByLabelText` が失敗 | `<label>` に `htmlFor` / `<input>` に `id` が未設定 | `htmlFor`/`id` を全フォーム要素に追加して label-input を関連付け |
| 19 | AI アバターが黒画面のまま (`networkState: 3`) | MP4 の `moov` ボックスがファイル末尾にある (非 Fast Start 形式) — ブラウザがファイル全体をダウンロードするまで再生できない | `qt-faststart` で `moov` をファイル先頭に移動 + `useEffect` + `canplay` で `video.play()` を明示呼び出し + `preload="auto"` + `display: 'block'` を設定 |
| 20 | 何度かやり取り後に音声認識が止まる | `AudioBufferSourceNode.stop()` 後に `onended` が非同期 fire → 新しい再生の `isSpeaking` を false にする race condition | `stopSpeaking()` 内で先に `onended = null` をセット + `playIdRef` でキャンセルを検知 |
| 21 | ダミーカメラの文字が左右反転 | Chime SDK が `bindVideoElement` で video 要素自体に `rotateY(180deg)` を設定する。wrapper div の `isDummyCamera ? 'none' : 'scaleX(-1)'` では逆で、ダミー時に Chime の鏡像が残っていた | wrapper div を `isDummyCamera ? 'scaleX(-1)' : 'none'` に修正: ダミー時は wrapper で二重鏡像 = 正像、通常カメラ時は Chime の一重鏡像 = セルフィービュー |
| 22 | カメラを一度オフ→オンにしないと映らない | `videoTileDidUpdate` が `startLocalVideoTile()` の呼び出しと同期で fire、React が DOM をコミットする前に `localVideoRef.current` が null | `bind()` を即時実行後、null だった場合は `setTimeout(bind, 0)` でリトライ |
| 23 | 無音ダイアログ中に同じ文字列が繰り返される | ダイアログ表示中も Chime Transcribe イベントが発火し続け `pendingText` に追記される | `showSilenceConfirmRef` フラグで `handleTranscriptEvent` を早期リターン |
| 24 | 「続けて話す」後に AI が「考え中」のまま止まる | `confirmSend` で debounce タイマーをクリアせずに古いタイマーが発火 → 2 重送信になり `isProcessing=true` がクリアされない | `confirmSend`/`cancelSend` の先頭で `clearTimeout(debounceTimerRef.current)` を実行 |
| 25 | Vitest で `DOMMatrix is not defined` | `pdfjs-dist` が jsdom 環境にない `DOMMatrix` を import 時に参照 | テストファイル先頭で `vi.mock('pdfjs-dist', ...)` と Worker URL をモック |
| 26 | ミュート後に発話が AI に届かない | ミュート時に debounce タイマーをキャンセルするだけで、溜まっていた発話テキストを破棄していた | `toggleMute` の else ブランチで `pendingTextRef.current.trim()` を確認し、あれば即時 `showSilenceConfirm = true` でダイアログ表示 |
| 27 | 画面共有なしで常にカメラ映像を AI に送っていた | 旧実装は手動📸ボタン (`isCameraAI` state) で切り替えていたが、ボタンを押し忘れると毎回カメラ映像が送られ API コストが増大 | `shouldCaptureCamera(text)` でキーワード検知: カメラ関連ワード (カメラ/映像/顔/どう見え) が含まれる場合のみ `captureLocalFrame()` を呼ぶ |
| 28 | Chime SDK が CSP でブロックされ音声送信が失敗 | `connect-src` に `wss://*.chime.aws` しか設定しておらず、HTTPS の worker JS (`https://static.sdkassets.chime.aws`) と ingest API (`https://data.svc.an1.ingest.chime.aws`) がブロックされていた。また `worker-src` 未設定で Blob URL から Web Worker を作れなかった | `connect-src` に `https://*.chime.aws` を追加、`worker-src blob:` ディレクティブを追加 |
| 29 | `customHttp.yml` を更新しても CSP が変わらない | `enableAutoBuild: false` + zip マニュアルデプロイを使用しているため `customHttp.yml` は Amplify に読まれない | CDK の `CfnApp.customHeaders` プロパティに直接記述する。`cdk deploy` のタイミングで CloudFront に確実に反映される |
| 30 | CDK デプロイで LogGroup `Resource already exists` | `logGroupName: '/aws/lambda/...'` を指定すると Lambda が自動作成するロググループと名前が衝突 | `LogGroup` 定義から `logGroupName` を削除。名前は CDK が自動生成する |
| 31 | CDK デプロイで `installLatestAwsSdk` 警告 | `AwsCustomResource` のデフォルト `true` が曖昧と判断される | IAM 等の安定 API は `false`、S3Vectors 等の新 API は `true` を明示指定 |
| 32 | `jest@29` → `glob@7`/`inflight` deprecated 警告 | jest@29 の推移的依存であり解消不可 | 警告を無視して運用。`jest@30` は CodeBuild パーサーエラーが発生するため v29 を固定 |
| 33 | Amplify の `/aibot.mp4` が 404 でなく `/index.html` にリダイレクト | SPA リライトルールの拡張子除外リストに `mp4` が含まれていない | Amplify `customRules` の拡張子パターンに `mp4` を追加: `css\|gif\|ico\|jpg\|js\|mp4\|png\|...` |
| 34 | 画面共有後すぐの発話で AI にフレームが届かない | `isSharing` が `true` になった時点で `video.videoWidth === 0` → `captureFrame()` が null を返す | `startScreenShare` 内で `loadeddata` イベントを待ってから `setIsSharing(true)` を呼ぶ (2 秒タイムアウト付き) |
| 35 | 画面共有 or カメラ付き AI 送信で "AI の応答生成に失敗しました" | Lambda に `bedrock:Converse` 権限がないか、`jp.*` 推論プロファイルの Converse API が `bedrock:InvokeModel` を要求 | Lambda IAM に `bedrock:Converse` + `bedrock:InvokeModel` を付与して `cdk deploy` を再実行。ブラウザの F12 コンソールで `visionError` の内容を確認 |
| 36 | Vision 失敗時にリクエスト全体が 500 エラー | `Promise.all` で Vision と RAG を並列実行すると Vision 失敗でリクエスト全体が reject される | `Promise.allSettled` に変更し、Vision 失敗時は RAG のみで応答を継続 (グレースフルフォールバック) |
| 37 | 背景ぼかしの TypeScript コンパイルエラー | `BackgroundBlurVideoFrameProcessor.create()` の戻り値が `BackgroundBlurProcessor \| undefined` — `undefined` は `VideoFrameProcessor[]` に代入できない | `if (!processor) return;` の null チェックを先に入れてから `as unknown as VideoFrameProcessor` でキャスト。`blurProcessorRef` は `any` 型で宣言して複雑な型競合を回避 |
| 38 | カメラ切り替え後にぼかしが解除される | `changeCamera()` が元の deviceId で `startVideoInput()` を呼び、transform device を上書き | `isBlurEnabledRef.current` が true のときはカメラ切り替え時に processor と transform device を再作成してから `startVideoInput()` |
| 39 | ダミーカメラ + ぼかし ON で映像が止まる | キャンバス描画ストリームへのぼかし適用が不安定 | ダミーカメラ検出時はぼかしを強制解除。ぼかしボタン自体を `isDummyCamera` 時は非表示にする |
| 40 | 音声レスポンスが遅く感じる | `setIsProcessing(false)` が `finally` ブロックにあり、音声再生 (`await playAudio()`) が完了するまで UI が "処理中" のまま | `setIsProcessing(false)` を `await playAudio()` の前に移動。テキスト表示後すぐに次の入力が可能になる |
| 41 | AI メッセージが見切れて読めない | チャットバブルの `maxWidth: '92%'` が狭く、`word-break` が設定されていないため長い URL/英単語が溢れる | `maxWidth: '96%'` に拡大 + `overflowWrap: 'anywhere'` を追加。RAG 登録エリアを折りたたみ式にして縦スペースを確保 |
| 42 | RAG 登録エリアが常時表示で縦幅を圧迫 | サイドバーに DocumentUpload がデフォルト展開されており、チャット履歴が狭くなる | `showRagUpload` state (デフォルト `false`) + 「▼ 開く / ▲ 閉じる」トグルボタンで折りたたみ式に変更 |

---

## 14. フロントエンドセキュリティ: Amplify のエンタープライズ対応

エンタープライズ用途で導入する際、バックエンド（API Gateway + Cognito）の保護に加え、フロントエンドをホストするインフラのセキュリティ要件も問われます。Amplify Hosting は直近のアップデートにより、これらの要件に対応できるようになっています。

### HTTP セキュリティヘッダーの実装

クリックジャッキング・XSS・MIME スニッフィングなどをブラウザ側で防ぐ HTTP セキュリティヘッダーは、リポジトリに `customHttp.yml` を配置するだけで Amplify に適用できます。

:::message alert
**`customHttp.yml` が反映されない場合**

`customHttp.yml` は Amplify の **git ベースのビルド**でのみ読み込まれます。CDK で `enableAutoBuild: false` を設定している場合や zip ファイルを直接アップロードするマニュアルデプロイを採用している場合は `customHttp.yml` は**一切読まれません**。

この場合は CDK の `CfnApp` に `customHeaders` プロパティを直接記述することで確実に反映できます:

```typescript
const amplifyApp = new amplify.CfnApp(this, 'AmplifyApp', {
  name: 'my-app',
  // ...
  customHeaders: [
    'customHeaders:',
    '  - pattern: "**/*"',
    '    headers:',
    "      - key: Content-Security-Policy",
    "        value: \"default-src 'self'; connect-src 'self' https://*.chime.aws ...\"",
  ].join('\n'),
});
```

`CfnApp.customHeaders` に設定した内容は `cdk deploy` のタイミングで CloudFront に反映されるため、デプロイ方式に依存しません。
:::


```yaml
# customHttp.yml (リポジトリルートに配置)
customHeaders:
  - pattern: '**/*'
    headers:
      # HTTPS 通信を 1 年間強制 (preload リスト登録も想定)
      - key: 'Strict-Transport-Security'
        value: 'max-age=31536000; includeSubDomains; preload'
      # クリックジャッキング対策: iframe 埋め込みを全面禁止
      - key: 'X-Frame-Options'
        value: 'DENY'
      # MIME スニッフィング対策
      - key: 'X-Content-Type-Options'
        value: 'nosniff'
      # リファラー情報: オリジンのみ (クロスオリジン時はパスを非公開)
      - key: 'Referrer-Policy'
        value: 'strict-origin-when-cross-origin'
      # Content Security Policy — ビデオ会議システムの要件を考慮
      - key: 'Content-Security-Policy'
        value: >-
          default-src 'self';
          connect-src 'self'
            https://*.amazonaws.com
            https://*.amazoncognito.com
            wss://*.amazonaws.com;
          media-src 'self' blob:;
          style-src 'self' 'unsafe-inline';
          script-src 'self' 'unsafe-inline';
```

:::message alert
**CSP と Chime SDK の注意点**

ビデオ会議システム特有の通信要件があります。CSP を厳格にしすぎると Chime SDK が動作しません。

| 要件 | CSP ディレクティブ |
|------|-----------------|
| Chime SDK WebSocket (音声・映像) | `connect-src wss://*.chime.aws wss://*.amazonaws.com` |
| Chime SDK worker JS / ingest API | `connect-src https://*.chime.aws` (**HTTPS も必要**) |
| Chime SDK Web Worker (Blob URL) | `worker-src blob:` |
| Cognito 認証 | `connect-src https://*.amazoncognito.com` |
| Polly 音声 (Base64 → Blob URL) | `media-src blob:` |
| VoiceFocus WASM | `script-src 'wasm-unsafe-eval'` (必要な場合) |

本番デプロイ前に [Mozilla Observatory](https://observatory.mozilla.org/) でスキャンし、A 以上を目標にチューニングしてください。
:::

### Amplify への WAF 統合

以前の Amplify Hosting は WAF を直接アタッチできず、前段に自前 CloudFront を置くワークアラウンドが必要でした。現在は **Amplify ネイティブで WAF Web ACL をアタッチ**できます。

```typescript
// CDK: Amplify アプリに WAF をアタッチ
import { aws_wafv2 as wafv2 } from 'aws-cdk-lib';

const webAcl = new wafv2.CfnWebACL(this, 'AmplifyWebAcl', {
  scope: 'CLOUDFRONT',  // Amplify は CloudFront ベース
  defaultAction: { allow: {} },
  rules: [
    {
      name: 'AWSManagedRulesCommonRuleSet',
      priority: 1,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
        },
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'CommonRuleSet',
        sampledRequestsEnabled: true,
      },
    },
  ],
  visibilityConfig: {
    cloudWatchMetricsEnabled: true,
    metricName: 'AmplifyWaf',
    sampledRequestsEnabled: true,
  },
});

// Amplify アプリに Web ACL を関連付け
const cfnApp = amplifyApp.node.defaultChild as amplify.CfnApp;
cfnApp.addPropertyOverride('CustomRules', [...]);
// WAF の関連付けは aws amplify update-app --waf-configuration で行う (2026年3月時点)
```

:::message
**WAF は us-east-1 で作成する**

Amplify の CloudFront ディストリビューションはグローバルなため、WAF Web ACL は必ず **us-east-1 (バージニア) リージョン**で作成する必要があります。東京リージョンで作成した Web ACL は Amplify に関連付けられません。
:::

---

## おわりに

Amazon Chime SDK・Bedrock AgentCore・S3 Vectors という 2026 年 3 月時点の AWS サービス群を組み合わせることで、会話履歴管理や RAG をほぼマネージドサービスに任せつつ、シンプルなコードで本格的な AI ビデオ会議システムを実現できました。

本システムで扱った技術領域を整理すると、以下のすべてが一つのモノレポに収まっています。

| 領域 | 技術スタック |
|------|------------|
| **インフラ (IaC)** | AWS CDK (TypeScript)、CodeCommit + CodePipeline |
| **バックエンド** | Lambda、Bedrock AgentCore、S3 Vectors + SQS、Cognito (Admin API) |
| **フロントエンド** | React 19 + Vite 7、Chime SDK JS、画面共有 Canvas キャプチャ、Amplify Hosting |
| **映像処理** | BackgroundBlurVideoFrameProcessor (背景ぼかし・preference 永続化)、ネットワーク品質モニタリング |
| **RAG 拡張** | userId フィルタによるユーザー間分離、メタデータタグ、折りたたみ式登録 UI |
| **音声認識 UX** | マイクボタン4状態 (ミュート/聴取中/AI処理中/AI発話中)、AI処理中の無音ダイアログ抑制 |
| **セキュリティ** | Cognito JWT 認証、CSP / HSTS、Amplify WAF 統合 |
| **CI/CD & 品質保証** | Vitest (31件)、Playwright (helpers + 7 spec)、CDK Jest (53件)、ESLint |

特に Bedrock AgentCore は、従来の Converse API + DynamoDB による自前セッション管理と比べて Lambda の実装がシンプルになります。S3 Vectors も、ベクトル DB のインフラ管理が不要になる点で開発体験の改善に寄与します。SQS による非同期 RAG 登録は API Gateway の 29 秒タイムアウト制約を根本解決しています。

**本番運用に向けたコスト最適化の余地**として、特に **Amazon Transcribe のストリーミング課金**が挙げられます。会議中は常時接続されるため長時間・多接続のシナリオでは支出が増大します。ミュート時に `StopMeetingTranscription` を呼び出してセッションを切断する、あるいは Web Speech API へ全面移行することでコストをゼロに近づけることができます。詳細は「[iOS での音声認識: Web Speech API フォールバック](#ios-での音声認識-web-speech-api-フォールバック)」の手前にあるコスト注意書きを参照してください。

追加機能として `BackgroundBlurVideoFrameProcessor` による **背景ぼかし** (UserProfile での preference 永続化と会議開始時の自動適用) と、`AudioVideoObserver` コールバックによる **ネットワーク品質モニタリング** も実装しました。これらは Chime SDK JS が提供する高水準 API を活用しており、追加インフラなしで実現できます。RAG ドキュメントへの **メタデータタグ付与** はベクトル登録→ワーカー→管理 UI の全パイプラインを通じて一貫して扱われ、ドキュメントの整理・検索性を向上させます。**RAG の userId フィルタ** により、S3 Vectors クエリ結果をユーザーごとに分離してドキュメントの漏洩を防止しています。マイクボタンの **4状態 UI** (ミュート/聴取中/AI処理中/AI発話中) と AI 処理中の **無音ダイアログ抑制** により、カメラ映像送信後に音声認識がブロックされる UX 問題も解消しています。

インフラ面では **CodeCommit + CodePipeline + Amplify によるモノレポ CI/CD** を整備し、`git push` 一発でフロントエンドとインフラが同時に自動デプロイされる体制を実現しています。セキュリティ面でも `customHttp.yml` による HTTP セキュリティヘッダーと Amplify ネイティブの WAF 統合により、PoC 品質からエンタープライズ本番品質へのギャップを埋めています。

ソースコードは以下のリポジトリで公開しています。ぜひお試しください。

https://github.com/your-org/chime-ai-meeting

---

## 参考

- [Amazon Chime SDK for JavaScript](https://github.com/aws/amazon-chime-sdk-js)
- [Amazon Bedrock AgentCore ドキュメント](https://docs.aws.amazon.com/bedrock/latest/userguide/agents.html)
- [Amazon S3 Vectors ドキュメント](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors.html)
- [Amazon Polly Neural TTS](https://docs.aws.amazon.com/polly/latest/dg/neural-voices.html)
- [AWS CDK AwsCustomResource](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.custom_resources.AwsCustomResource.html)
- [AWS CodePipeline + CodeCommit](https://docs.aws.amazon.com/codepipeline/latest/userguide/connections-codecommit.html)
- [Amplify Hosting カスタム HTTP ヘッダー](https://docs.aws.amazon.com/amplify/latest/userguide/custom-headers.html)
- [Mozilla Observatory (セキュリティスキャン)](https://observatory.mozilla.org/)
