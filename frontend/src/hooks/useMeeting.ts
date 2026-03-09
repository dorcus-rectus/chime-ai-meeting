import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  DefaultVideoTransformDevice,
  BackgroundBlurVideoFrameProcessor,
  LogLevel,
  MeetingSessionConfiguration,
  VoiceFocusDeviceTransformer,
  type TranscriptEvent,
  Transcript,
} from 'amazon-chime-sdk-js';
import { API_URL } from '../config';
import type { MeetingResponse } from '../types';

export type MeetingStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'ended';
export type NetworkQuality = 'unknown' | 'good' | 'poor';

export const DUMMY_DEVICE_ID = 'dummy';

export interface UseMeetingReturn {
  status: MeetingStatus;
  meetingId: string | null;
  isMuted: boolean;
  isVideoOn: boolean;
  isDummyCamera: boolean;
  isBlurEnabled: boolean;
  isBlurSupported: boolean;
  networkQuality: NetworkQuality;
  videoDevices: MediaDeviceInfo[];
  selectedDeviceId: string;
  resolution: { width: number; height: number };
  isContentSharing: boolean;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  errorMessage: string;
  /** 確定済みの未送信テキスト (3秒無音まで蓄積) */
  pendingText: string;
  /** 3秒無音を検知したとき true: 「送信 or 続ける」確認UIを表示 */
  showSilenceConfirm: boolean;
  startMeeting: (idToken: string) => Promise<void>;
  endMeeting: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleBackgroundBlur: () => Promise<void>;
  changeCamera: (deviceId: string) => Promise<void>;
  changeResolution: (width: number, height: number) => Promise<void>;
  startContentShare: (stream: MediaStream) => Promise<void>;
  stopContentShare: () => void;
  /** 「AIに送る」: pendingText を onTranscript に渡し、バッファをクリア (テキストを上書き可能) */
  confirmSend: (overrideText?: string) => void;
  /** 「キャンセル」: バッファを破棄してダイアログを閉じ、音声認識を再開 */
  cancelSend: () => void;
  /** 「続ける」: ダイアログを閉じて音声認識を再開 */
  confirmContinue: () => void;
  /** AI が話している間など、音声認識を一時停止 */
  pauseTranscription: () => void;
  /** pauseTranscription 後に認識を再開 */
  resumeTranscription: () => void;
  /** ローカルカメラのフレームを JPEG Base64 でキャプチャ (カメラ OFF / ダミーカメラ時は null) */
  captureLocalFrame: (maxWidth?: number, quality?: number) => string | null;
}

/** グリッド柄のダミーカメラ MediaStream をキャンバスから生成 */
function createDummyStream(width: number, height: number): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(167,139,250,0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }

  const fs = Math.max(14, Math.round(width / 30));
  ctx.fillStyle = 'rgba(167,139,250,0.75)';
  ctx.font = `${fs}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ダミーカメラ', width / 2, height / 2 - fs * 0.8);
  ctx.font = `${Math.round(fs * 0.7)}px sans-serif`;
  ctx.fillStyle = 'rgba(167,139,250,0.4)';
  ctx.fillText('(カメラ無効)', width / 2, height / 2 + fs * 0.8);

  return canvas.captureStream(1);
}

export function useMeeting(onTranscript: (text: string) => void, isProcessing = false): UseMeetingReturn {
  const [status, setStatus] = useState<MeetingStatus>('idle');
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isDummyCamera, setIsDummyCamera] = useState(false);
  const [isContentSharing, setIsContentSharing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [resolution, setResolution] = useState({ width: 1280, height: 720 });
  /** 3秒無音まで蓄積する確定済みテキスト */
  const [pendingText, setPendingText] = useState('');
  /** true: 「AIに送る / 続ける」確認ダイアログ表示中 */
  const [showSilenceConfirm, setShowSilenceConfirm] = useState(false);
  const [isBlurEnabled, setIsBlurEnabled] = useState(false);
  const [isBlurSupported, setIsBlurSupported] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>('unknown');

  const sessionRef = useRef<DefaultMeetingSession | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dummyStreamRef = useRef<MediaStream | null>(null);
  const loggerRef = useRef<ConsoleLogger | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blurProcessorRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blurTransformDeviceRef = useRef<any>(null);
  const isBlurEnabledRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speechRecognitionRef = useRef<any>(null);
  // Chime SDK Transcribe が実際に結果を返した場合は Web Speech API を停止する
  // (両方が同時に動くと同じ発話が2回 accumulateTranscript に渡されてしまう)
  const chimeTranscriptActiveRef = useRef(false);

  // --- 同期アクセス用 ref ---
  // stale closure 対策: onTranscript を常に最新に保つ
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  // ミュート状態 (コールバック内での同期参照)
  const isMutedRef = useRef(true);
  // pendingText の同期参照
  const pendingTextRef = useRef('');
  // showSilenceConfirm の同期参照
  const showSilenceConfirmRef = useRef(false);
  // AI 発話中など外部から一時停止指示
  const transcriptionPausedRef = useRef(false);
  // 重複防止: 最後にaccumulateしたテキストとタイムスタンプ
  const lastAccumulatedRef = useRef<{ text: string; ts: number } | null>(null);
  // AI 処理中にダイアログ表示が抑制されたことを記録
  const pendingShowDialogRef = useRef(false);
  // isProcessing の同期参照 (debounce タイマーコールバック内で参照)
  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;
  // selectedDeviceId の同期参照 (非同期コールバック内での参照用)
  const selectedDeviceIdRef = useRef('');

  // -------------------------------------------------------
  // テキスト蓄積: 発話の確定結果を受け取り、3秒無音でダイアログ表示
  // -------------------------------------------------------
  const accumulateTranscript = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // 重複防止: 句読点を除いて比較、かつ pendingText に既に含まれている場合もスキップ
    const norm = (s: string) => s.replace(/[。、！？.?!,\s]/g, '');
    const now = Date.now();
    if (lastAccumulatedRef.current) {
      const { text: last, ts } = lastAccumulatedRef.current;
      const normLast = norm(last);
      const normNew = norm(trimmed);
      if (now - ts < 3000 && (normLast === normNew || normLast.includes(normNew) || normNew.includes(normLast))) {
        return;
      }
    }
    // pendingText に既に含まれていればスキップ (Chime の重複配信対策)
    if (pendingTextRef.current) {
      const normPending = norm(pendingTextRef.current);
      const normNew = norm(trimmed);
      if (normPending.includes(normNew)) return;
    }
    lastAccumulatedRef.current = { text: trimmed, ts: now };

    const next = pendingTextRef.current ? `${pendingTextRef.current} ${trimmed}` : trimmed;
    pendingTextRef.current = next;
    setPendingText(next);

    // 3秒無音タイマーをリセット
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      if (!pendingTextRef.current.trim()) return;
      // AI 処理中はダイアログ表示を抑制 (処理完了後に自動表示する)
      if (isProcessingRef.current) {
        pendingShowDialogRef.current = true;
        return;
      }
      // 3秒無音 → 確認ダイアログを表示し、音声認識を一時停止
      showSilenceConfirmRef.current = true;
      setShowSilenceConfirm(true);
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch { /* 既に停止中 */ }
      }
    }, 3000);
  }, []);

  // -------------------------------------------------------
  // Chime SDK Transcribe からの書き起こしイベント
  // -------------------------------------------------------
  const handleTranscriptEvent = useCallback(
    (event: TranscriptEvent) => {
      if (isMutedRef.current || transcriptionPausedRef.current || showSilenceConfirmRef.current) return;
      if (!(event instanceof Transcript)) return;
      for (const result of event.results) {
        if (!result.isPartial) {
          const text = result.alternatives[0]?.transcript ?? '';
          if (!text.trim()) continue;
          // Chime Transcribe が機能しているので Web Speech API を停止する (重複防止)
          if (!chimeTranscriptActiveRef.current) {
            chimeTranscriptActiveRef.current = true;
            if (speechRecognitionRef.current) {
              try { speechRecognitionRef.current.stop(); } catch { /* 既に停止中 */ }
            }
          }
          accumulateTranscript(text);
        } else {
          // 部分認識中はタイマーをリセット (まだ喋っている)
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        }
      }
    },
    [accumulateTranscript],
  );

  // -------------------------------------------------------
  // 「AIに送る」ボタン
  // -------------------------------------------------------
  const confirmSend = useCallback((overrideText?: string) => {
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
    const text = (overrideText ?? pendingTextRef.current).trim();
    pendingTextRef.current = '';
    setPendingText('');
    showSilenceConfirmRef.current = false;
    setShowSilenceConfirm(false);
    if (text) onTranscriptRef.current(text);
    // 音声認識を再開
    if (!isMutedRef.current && !transcriptionPausedRef.current && speechRecognitionRef.current) {
      try { speechRecognitionRef.current.start(); } catch { /* 既に開始中 */ }
    }
  }, []);

  // -------------------------------------------------------
  // 「キャンセル」ボタン: バッファを破棄してダイアログを閉じる
  // -------------------------------------------------------
  const cancelSend = useCallback(() => {
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
    pendingTextRef.current = '';
    setPendingText('');
    showSilenceConfirmRef.current = false;
    setShowSilenceConfirm(false);
    // 音声認識を再開
    if (!isMutedRef.current && !transcriptionPausedRef.current && speechRecognitionRef.current) {
      try { speechRecognitionRef.current.start(); } catch { /* 既に開始中 */ }
    }
  }, []);

  // -------------------------------------------------------
  // 「続ける」ボタン
  // -------------------------------------------------------
  const confirmContinue = useCallback(() => {
    showSilenceConfirmRef.current = false;
    setShowSilenceConfirm(false);
    // 音声認識を再開
    if (!isMutedRef.current && !transcriptionPausedRef.current && speechRecognitionRef.current) {
      try { speechRecognitionRef.current.start(); } catch { /* 既に開始中 */ }
    }
  }, []);

  // -------------------------------------------------------
  // AI 発話中に呼ぶ: 音声認識を一時停止
  // -------------------------------------------------------
  const pauseTranscription = useCallback(() => {
    transcriptionPausedRef.current = true;
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch { /* 既に停止中 */ }
    }
  }, []);

  // -------------------------------------------------------
  // AI 発話終了後に呼ぶ: 音声認識を再開
  // -------------------------------------------------------
  const resumeTranscription = useCallback(() => {
    transcriptionPausedRef.current = false;
    // ダイアログ表示中は再開しない
    if (!isMutedRef.current && !showSilenceConfirmRef.current && speechRecognitionRef.current) {
      try { speechRecognitionRef.current.start(); } catch { /* 既に開始中 */ }
    }
  }, []);

  // -------------------------------------------------------
  // isProcessing が false になったときに抑制済みダイアログを表示
  // -------------------------------------------------------
  useEffect(() => {
    if (!isProcessing && pendingShowDialogRef.current && pendingTextRef.current.trim() && !showSilenceConfirmRef.current) {
      pendingShowDialogRef.current = false;
      showSilenceConfirmRef.current = true;
      setShowSilenceConfirm(true);
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch { /* 既に停止中 */ }
      }
    }
  }, [isProcessing]);

  // -------------------------------------------------------
  // 会議開始
  // -------------------------------------------------------
  const startMeeting = useCallback(
    async (idToken: string) => {
      setStatus('connecting');
      setErrorMessage('');

      try {
        const res = await fetch(`${API_URL}/meetings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
        });
        if (!res.ok) throw new Error(`会議作成失敗: HTTP ${res.status}`);
        const { meeting, attendee } = (await res.json()) as MeetingResponse;

        setMeetingId(meeting.MeetingId);

        const logger = new ConsoleLogger('ChimeMeeting', LogLevel.WARN);
        loggerRef.current = logger;
        const deviceController = new DefaultDeviceController(logger);
        const configuration = new MeetingSessionConfiguration(meeting, attendee);
        const session = new DefaultMeetingSession(configuration, logger, deviceController);
        sessionRef.current = session;

        if (audioRef.current) await session.audioVideo.bindAudioElement(audioRef.current);

        // マイク設定 (VoiceFocus ノイズキャンセル、失敗時は通常マイク → スキップ)
        try {
          const audioInputDevices = await session.audioVideo.listAudioInputDevices();
          if (audioInputDevices.length > 0) {
            try {
              const isSupported = await VoiceFocusDeviceTransformer.isSupported(undefined, { logger });
              if (isSupported) {
                const transformer = await VoiceFocusDeviceTransformer.create(undefined, { logger });
                const vfDevice = await transformer.createTransformDevice(audioInputDevices[0].deviceId);
                await session.audioVideo.startAudioInput(vfDevice ?? audioInputDevices[0].deviceId);
              } else {
                await session.audioVideo.startAudioInput(audioInputDevices[0].deviceId);
              }
            } catch {
              await session.audioVideo.startAudioInput(audioInputDevices[0].deviceId);
            }
          }
        } catch {
          console.warn('マイクデバイスの取得に失敗しました。マイクなしで続行します。');
        }

        // カメラ設定 — デバイスが取得できない場合はダミーカメラにフォールバック
        try {
          const videoInputDevices = await session.audioVideo.listVideoInputDevices();
          setVideoDevices(videoInputDevices);
          if (videoInputDevices.length > 0) {
            const firstId = videoInputDevices[0].deviceId;
            await session.audioVideo.startVideoInput(firstId);
            selectedDeviceIdRef.current = firstId;
            setSelectedDeviceId(firstId);
          } else {
            const stream = createDummyStream(resolution.width, resolution.height);
            dummyStreamRef.current = stream;
            await session.audioVideo.startVideoInput(stream as unknown as string);
            selectedDeviceIdRef.current = DUMMY_DEVICE_ID;
            setSelectedDeviceId(DUMMY_DEVICE_ID);
            setIsDummyCamera(true);
          }
        } catch {
          console.warn('カメラデバイスの取得に失敗しました。ダミーカメラを使用します。');
          try {
            const stream = createDummyStream(resolution.width, resolution.height);
            dummyStreamRef.current = stream;
            await session.audioVideo.startVideoInput(stream as unknown as string);
            selectedDeviceIdRef.current = DUMMY_DEVICE_ID;
            setSelectedDeviceId(DUMMY_DEVICE_ID);
            setIsDummyCamera(true);
          } catch (dummyErr) {
            console.warn('ダミーカメラの設定にも失敗しました:', dummyErr);
          }
        }

        session.audioVideo.addObserver({
          videoTileDidUpdate: (tileState) => {
            if (tileState.localTile && tileState.tileId != null) {
              const tileId = tileState.tileId;
              const bind = () => {
                if (localVideoRef.current) {
                  session.audioVideo.bindVideoElement(tileId, localVideoRef.current);
                  return true;
                }
                return false;
              };
              // 即時試行 + React のコミット待ちリトライ (0ms / 50ms / 150ms)
              // startLocalVideoTile() は同期的に observer を fire するため
              // React がまだ DOM をコミットしていないことがある
              if (!bind()) {
                [0, 50, 150].forEach((delay) => setTimeout(bind, delay));
              }
            }
          },
          audioVideoDidStop: () => setStatus('ended'),
          connectionDidBecomePoor: () => setNetworkQuality('poor'),
          connectionDidBecomeGood: () => setNetworkQuality('good'),
          connectionDidSuggestStopVideo: () => setNetworkQuality('poor'),
        });

        // 背景ぼかし対応状況を非同期で確認 + localStorage preference の自動適用
        BackgroundBlurVideoFrameProcessor.isSupported().then(async (supported) => {
          setIsBlurSupported(supported);
          if (supported && localStorage.getItem('blurPreference') === 'on' && !dummyStreamRef.current) {
            try {
              const processor = await BackgroundBlurVideoFrameProcessor.create();
              if (processor && loggerRef.current && selectedDeviceIdRef.current && selectedDeviceIdRef.current !== DUMMY_DEVICE_ID) {
                blurProcessorRef.current = processor;
                const transformDevice = new DefaultVideoTransformDevice(
                  loggerRef.current,
                  selectedDeviceIdRef.current,
                  [processor],
                );
                blurTransformDeviceRef.current = transformDevice;
                await session.audioVideo.startVideoInput(transformDevice);
                isBlurEnabledRef.current = true;
                setIsBlurEnabled(true);
              }
            } catch (e) {
              console.warn('ぼかし自動適用に失敗:', e);
            }
          }
        }).catch(() => {
          setIsBlurSupported(false);
        });

        session.audioVideo.transcriptionController?.subscribeToTranscriptEvent(handleTranscriptEvent);

        session.audioVideo.start();
        session.audioVideo.startLocalVideoTile();
        // デフォルトミュート
        session.audioVideo.realtimeMuteLocalAudio();
        isMutedRef.current = true;
        setStatus('connected');

        // Web Speech API フォールバック (iOS Chrome 等 Chime Transcribe 非対応環境)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const SpeechRecognitionClass = (window as any).webkitSpeechRecognition ?? (window as any).SpeechRecognition;
        if (SpeechRecognitionClass) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const recognition = new SpeechRecognitionClass() as any;
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'ja-JP';
          recognition.onresult = (event: { resultIndex: number; results: SpeechRecognitionResultList }) => {
            if (isMutedRef.current || transcriptionPausedRef.current) return;
            let final = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              if (event.results[i].isFinal) final += event.results[i][0].transcript;
            }
            if (final.trim()) accumulateTranscript(final.trim());
          };
          recognition.onerror = (event: { error: string }) => {
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
              speechRecognitionRef.current = null;
            }
          };
          recognition.onend = () => {
            // ミュート中・AI発話中・ダイアログ表示中・Chime有効時は再起動しない
            if (
              speechRecognitionRef.current &&
              !isMutedRef.current &&
              !transcriptionPausedRef.current &&
              !showSilenceConfirmRef.current &&
              !chimeTranscriptActiveRef.current
            ) {
              recognition.start();
            }
          };
          speechRecognitionRef.current = recognition;
          // デフォルトミュートのため start() しない
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : '会議への接続に失敗しました');
        setStatus('error');
      }
    },
    [handleTranscriptEvent, accumulateTranscript, resolution.width, resolution.height],
  );

  const changeCamera = useCallback(
    async (deviceId: string) => {
      const session = sessionRef.current;
      if (!session) return;

      if (dummyStreamRef.current) {
        dummyStreamRef.current.getTracks().forEach((t) => t.stop());
        dummyStreamRef.current = null;
      }

      // ぼかし用 transform device を先に停止
      if (blurTransformDeviceRef.current) {
        try { await blurTransformDeviceRef.current.stop(); } catch { /* 無視 */ }
        blurTransformDeviceRef.current = null;
      }

      if (deviceId === DUMMY_DEVICE_ID) {
        const stream = createDummyStream(resolution.width, resolution.height);
        dummyStreamRef.current = stream;
        await session.audioVideo.startVideoInput(stream as unknown as string);
        setIsDummyCamera(true);
        // ダミーカメラではぼかし無効
        if (isBlurEnabledRef.current) {
          if (blurProcessorRef.current) {
            try { await blurProcessorRef.current.destroy(); } catch { /* 無視 */ }
            blurProcessorRef.current = null;
          }
          isBlurEnabledRef.current = false;
          setIsBlurEnabled(false);
        }
      } else {
        if (isBlurEnabledRef.current && blurProcessorRef.current && loggerRef.current) {
          // ぼかし ON のままカメラ切り替え: 新しいデバイスで transform device を再作成
          const transformDevice = new DefaultVideoTransformDevice(
            loggerRef.current,
            deviceId,
            [blurProcessorRef.current],
          );
          blurTransformDeviceRef.current = transformDevice;
          await session.audioVideo.startVideoInput(transformDevice);
        } else {
          await session.audioVideo.startVideoInput(deviceId);
        }
        setIsDummyCamera(false);
        if (!isVideoOn) {
          session.audioVideo.startLocalVideoTile();
          setIsVideoOn(true);
        }
      }
      selectedDeviceIdRef.current = deviceId;
      setSelectedDeviceId(deviceId);
    },
    [resolution, isVideoOn],
  );

  const changeResolution = useCallback(
    async (width: number, height: number) => {
      const session = sessionRef.current;
      if (!session) return;
      setResolution({ width, height });

      if (isDummyCamera) {
        if (dummyStreamRef.current) {
          dummyStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        const stream = createDummyStream(width, height);
        dummyStreamRef.current = stream;
        await session.audioVideo.startVideoInput(stream as unknown as string);
      } else if (selectedDeviceId) {
        await session.audioVideo.startVideoInput({
          deviceId: { exact: selectedDeviceId },
          width: { ideal: width },
          height: { ideal: height },
        } as MediaTrackConstraints as unknown as string);
      }
    },
    [isDummyCamera, selectedDeviceId],
  );

  /**
   * ローカルカメラのフレームを JPEG Base64 でキャプチャする。
   * カメラ OFF またはダミーカメラ使用時は null を返す。
   */
  const captureLocalFrame = useCallback((maxWidth = 640, quality = 0.6): string | null => {
    const video = localVideoRef.current;
    if (!video || !isVideoOn || isDummyCamera || video.videoWidth === 0) return null;

    const scale = Math.min(1, maxWidth / video.videoWidth);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // scaleX(-1) のミラー表示をキャンセルして元の向きで描画
    ctx.drawImage(video, 0, 0, w, h);

    return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? null;
  }, [isVideoOn, isDummyCamera]);

  // -------------------------------------------------------
  // 背景ぼかし ON/OFF 切り替え
  // ダミーカメラ使用中・非対応ブラウザ・会議未開始時は無効
  // -------------------------------------------------------
  const toggleBackgroundBlur = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || !isBlurSupported) return;
    // ダミーカメラ時はぼかし不可 (MediaStream は VideoTransformDevice に渡せない)
    if (isBlurEnabledRef.current === false && dummyStreamRef.current) return;

    if (isBlurEnabledRef.current) {
      // ぼかし OFF: transform device を停止してから元のデバイスに戻す
      if (blurTransformDeviceRef.current) {
        try { await blurTransformDeviceRef.current.stop(); } catch { /* 無視 */ }
        blurTransformDeviceRef.current = null;
      }
      if (blurProcessorRef.current) {
        try { await blurProcessorRef.current.destroy(); } catch { /* 無視 */ }
        blurProcessorRef.current = null;
      }
      if (selectedDeviceId && selectedDeviceId !== DUMMY_DEVICE_ID) {
        await session.audioVideo.startVideoInput(selectedDeviceId);
      }
      isBlurEnabledRef.current = false;
      setIsBlurEnabled(false);
    } else {
      // ぼかし ON
      try {
        const processor = await BackgroundBlurVideoFrameProcessor.create();
        if (!processor) {
          console.warn('背景ぼかしプロセッサーの作成に失敗 (isSupported() が true でも create() が undefined を返した)');
          return;
        }
        blurProcessorRef.current = processor;
        const transformDevice = new DefaultVideoTransformDevice(
          loggerRef.current!,
          selectedDeviceId,
          [processor],
        );
        blurTransformDeviceRef.current = transformDevice;
        await session.audioVideo.startVideoInput(transformDevice);
        isBlurEnabledRef.current = true;
        setIsBlurEnabled(true);
      } catch (err) {
        console.warn('背景ぼかしの有効化に失敗:', err);
      }
    }
  }, [isBlurSupported, selectedDeviceId]);

  const startContentShare = useCallback(async (stream: MediaStream) => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      await session.audioVideo.startContentShare(stream);
      setIsContentSharing(true);
    } catch (err) {
      console.warn('Chime コンテンツ共有の開始に失敗:', err);
    }
  }, []);

  const stopContentShare = useCallback(() => {
    sessionRef.current?.audioVideo.stopContentShare();
    setIsContentSharing(false);
  }, []);

  const endMeeting = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (dummyStreamRef.current) {
      dummyStreamRef.current.getTracks().forEach((t) => t.stop());
      dummyStreamRef.current = null;
    }
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.onend = null;
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
    }
    // 背景ぼかし クリーンアップ
    if (blurTransformDeviceRef.current) {
      void blurTransformDeviceRef.current.stop().catch(() => {});
      blurTransformDeviceRef.current = null;
    }
    if (blurProcessorRef.current) {
      void blurProcessorRef.current.destroy().catch(() => {});
      blurProcessorRef.current = null;
    }
    isBlurEnabledRef.current = false;
    setIsBlurEnabled(false);
    // バッファ・フラグをクリア
    pendingTextRef.current = '';
    setPendingText('');
    showSilenceConfirmRef.current = false;
    setShowSilenceConfirm(false);
    chimeTranscriptActiveRef.current = false;
    lastAccumulatedRef.current = null;

    const session = sessionRef.current;
    if (session) {
      session.audioVideo.transcriptionController?.unsubscribeFromTranscriptEvent(handleTranscriptEvent);
      session.audioVideo.stopContentShare();
      session.audioVideo.stopLocalVideoTile();
      session.audioVideo.stop();
      session.audioVideo.stopVideoInput();
      session.audioVideo.stopAudioInput();
      sessionRef.current = null;
    }
    // React StrictMode のクリーンアップ対策:
    // 会議が未開始 (status='idle') の場合は 'ended' に遷移させない
    // React StrictMode のクリーンアップ対策:
    // 会議が未開始 (status='idle') の場合は 'ended' に遷移させない
    setStatus((prev) => (prev === 'idle' ? 'idle' : 'ended'));
    setMeetingId(null);
    setIsContentSharing(false);
    setIsDummyCamera(false);
    setNetworkQuality('unknown');
    setVideoDevices([]);
    setSelectedDeviceId('');
  }, [handleTranscriptEvent]);

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (isMuted) {
      // ミュート解除: 音声認識を開始
      session.audioVideo.realtimeUnmuteLocalAudio();
      isMutedRef.current = false;
      setIsMuted(false);
      // ダイアログ表示中・AI発話中でなければ認識開始
      if (!transcriptionPausedRef.current && !showSilenceConfirmRef.current && speechRecognitionRef.current) {
        try { speechRecognitionRef.current.start(); } catch { /* 既に開始中 */ }
      }
    } else {
      // ミュート: 音声認識を停止
      session.audioVideo.realtimeMuteLocalAudio();
      isMutedRef.current = true;
      setIsMuted(true);
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch { /* 既に停止中 */ }
      }
      // 3秒タイマーをクリア (ミュート後は自動送信しない)
      if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
      // 未送信テキストがあればすぐにダイアログを表示
      if (pendingTextRef.current.trim()) {
        showSilenceConfirmRef.current = true;
        setShowSilenceConfirm(true);
      }
    }
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (isVideoOn) session.audioVideo.stopLocalVideoTile();
    else session.audioVideo.startLocalVideoTile();
    setIsVideoOn((prev) => !prev);
  }, [isVideoOn]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      endMeeting();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    meetingId,
    isMuted,
    isVideoOn,
    isDummyCamera,
    isBlurEnabled,
    isBlurSupported,
    networkQuality,
    videoDevices,
    selectedDeviceId,
    resolution,
    isContentSharing,
    localVideoRef,
    audioRef,
    errorMessage,
    pendingText,
    showSilenceConfirm,
    startMeeting,
    endMeeting,
    toggleMute,
    toggleVideo,
    toggleBackgroundBlur,
    changeCamera,
    changeResolution,
    startContentShare,
    stopContentShare,
    confirmSend,
    cancelSend,
    confirmContinue,
    pauseTranscription,
    resumeTranscription,
    captureLocalFrame,
  };
}
