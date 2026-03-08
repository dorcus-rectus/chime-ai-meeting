import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  VoiceFocusDeviceTransformer,
  type TranscriptEvent,
  Transcript,
} from 'amazon-chime-sdk-js';
import { API_URL } from '../config';
import type { MeetingResponse } from '../types';

export type MeetingStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'ended';

export const DUMMY_DEVICE_ID = 'dummy';

export interface UseMeetingReturn {
  status: MeetingStatus;
  meetingId: string | null;
  isMuted: boolean;
  isVideoOn: boolean;
  isDummyCamera: boolean;
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
  changeCamera: (deviceId: string) => Promise<void>;
  changeResolution: (width: number, height: number) => Promise<void>;
  startContentShare: (stream: MediaStream) => Promise<void>;
  stopContentShare: () => void;
  /** 「AIに送る」: pendingText を onTranscript に渡し、バッファをクリア */
  confirmSend: () => void;
  /** 「続ける」: ダイアログを閉じて音声認識を再開 */
  confirmContinue: () => void;
  /** AI が話している間など、音声認識を一時停止 */
  pauseTranscription: () => void;
  /** pauseTranscription 後に認識を再開 */
  resumeTranscription: () => void;
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

export function useMeeting(onTranscript: (text: string) => void): UseMeetingReturn {
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

  const sessionRef = useRef<DefaultMeetingSession | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dummyStreamRef = useRef<MediaStream | null>(null);
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

  // -------------------------------------------------------
  // テキスト蓄積: 発話の確定結果を受け取り、3秒無音でダイアログ表示
  // -------------------------------------------------------
  const accumulateTranscript = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const next = pendingTextRef.current ? `${pendingTextRef.current} ${trimmed}` : trimmed;
    pendingTextRef.current = next;
    setPendingText(next);

    // 3秒無音タイマーをリセット
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      if (!pendingTextRef.current.trim()) return;
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
      if (isMutedRef.current || transcriptionPausedRef.current) return;
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
  const confirmSend = useCallback(() => {
    const text = pendingTextRef.current.trim();
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
            setSelectedDeviceId(firstId);
          } else {
            const stream = createDummyStream(resolution.width, resolution.height);
            dummyStreamRef.current = stream;
            await session.audioVideo.startVideoInput(stream as unknown as string);
            setSelectedDeviceId(DUMMY_DEVICE_ID);
            setIsDummyCamera(true);
          }
        } catch {
          console.warn('カメラデバイスの取得に失敗しました。ダミーカメラを使用します。');
          try {
            const stream = createDummyStream(resolution.width, resolution.height);
            dummyStreamRef.current = stream;
            await session.audioVideo.startVideoInput(stream as unknown as string);
            setSelectedDeviceId(DUMMY_DEVICE_ID);
            setIsDummyCamera(true);
          } catch (dummyErr) {
            console.warn('ダミーカメラの設定にも失敗しました:', dummyErr);
          }
        }

        session.audioVideo.addObserver({
          videoTileDidUpdate: (tileState) => {
            if (tileState.localTile && tileState.tileId != null && localVideoRef.current) {
              session.audioVideo.bindVideoElement(tileState.tileId, localVideoRef.current);
            }
          },
          audioVideoDidStop: () => setStatus('ended'),
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

      if (deviceId === DUMMY_DEVICE_ID) {
        const stream = createDummyStream(resolution.width, resolution.height);
        dummyStreamRef.current = stream;
        await session.audioVideo.startVideoInput(stream as unknown as string);
        setIsDummyCamera(true);
      } else {
        await session.audioVideo.startVideoInput(deviceId);
        setIsDummyCamera(false);
        if (!isVideoOn) {
          session.audioVideo.startLocalVideoTile();
          setIsVideoOn(true);
        }
      }
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
    // バッファ・フラグをクリア
    pendingTextRef.current = '';
    setPendingText('');
    showSilenceConfirmRef.current = false;
    setShowSilenceConfirm(false);
    chimeTranscriptActiveRef.current = false;

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
    setStatus('ended');
    setMeetingId(null);
    setIsContentSharing(false);
    setIsDummyCamera(false);
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
    changeCamera,
    changeResolution,
    startContentShare,
    stopContentShare,
    confirmSend,
    confirmContinue,
    pauseTranscription,
    resumeTranscription,
  };
}
