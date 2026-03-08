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
  startMeeting: (idToken: string) => Promise<void>;
  endMeeting: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  changeCamera: (deviceId: string) => Promise<void>;
  changeResolution: (width: number, height: number) => Promise<void>;
  startContentShare: (stream: MediaStream) => Promise<void>;
  stopContentShare: () => void;
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

  const sessionRef = useRef<DefaultMeetingSession | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptBufferRef = useRef<string>('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dummyStreamRef = useRef<MediaStream | null>(null);
  // Web Speech API (Chime 書き起こしの非対応環境向けフォールバック)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speechRecognitionRef = useRef<any>(null);
  // ミュート状態を同期的に参照するための ref (コールバック内での stale closure 回避)
  const isMutedRef = useRef(true);
  // onTranscript を ref で保持: startMeeting 実行後の再レンダリングで sessionId が
  // 更新されても、音声認識コールバックが常に最新の関数を参照できるようにする
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const flushTranscript = useCallback(() => {
    const text = transcriptBufferRef.current.trim();
    if (text) {
      transcriptBufferRef.current = '';
      onTranscriptRef.current(text);
    }
  }, []);

  const handleTranscriptEvent = useCallback(
    (event: TranscriptEvent) => {
      if (isMutedRef.current) return; // ミュート中は文字起こしをスキップ
      if (!(event instanceof Transcript)) return;
      for (const result of event.results) {
        if (result.isPartial) {
          transcriptBufferRef.current = result.alternatives[0]?.transcript ?? '';
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(flushTranscript, 2000);
        } else {
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          transcriptBufferRef.current = result.alternatives[0]?.transcript ?? '';
          flushTranscript();
        }
      }
    },
    [flushTranscript],
  );

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
          // マイクアクセス拒否・デバイス取得失敗 → マイクなしで継続
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
            // デバイスなし → ダミーカメラ
            const stream = createDummyStream(resolution.width, resolution.height);
            dummyStreamRef.current = stream;
            await session.audioVideo.startVideoInput(stream as unknown as string);
            setSelectedDeviceId(DUMMY_DEVICE_ID);
            setIsDummyCamera(true);
          }
        } catch {
          // カメラアクセス拒否・デバイス取得失敗 → ダミーカメラで継続
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
        // デフォルトミュート: 会議開始直後はマイクをオフにする
        session.audioVideo.realtimeMuteLocalAudio();
        isMutedRef.current = true;
        setStatus('connected');

        // Web Speech API フォールバック:
        // iOS Chrome など Chime の AWS Transcribe 書き起こしが機能しない環境で使用。
        // ミュート状態に連動して start/stop を制御する。
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const SpeechRecognitionClass = (window as any).webkitSpeechRecognition ?? (window as any).SpeechRecognition;
        if (SpeechRecognitionClass) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const recognition = new SpeechRecognitionClass() as any;
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'ja-JP';
          recognition.onresult = (event: { resultIndex: number; results: SpeechRecognitionResultList }) => {
            if (isMutedRef.current) return; // ミュート中は無視
            let final = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              if (event.results[i].isFinal) final += event.results[i][0].transcript;
            }
            if (final.trim()) onTranscriptRef.current(final.trim());
          };
          // 致命的エラー時は自動再起動を停止 (not-allowed で無限ループ防止)
          recognition.onerror = (event: { error: string }) => {
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
              speechRecognitionRef.current = null;
            }
          };
          // 途切れたら自動再起動 — ただしミュート中は再起動しない
          recognition.onend = () => {
            if (speechRecognitionRef.current && !isMutedRef.current) recognition.start();
          };
          speechRecognitionRef.current = recognition;
          // デフォルトミュートのため、ここでは start() しない
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : '会議への接続に失敗しました');
        setStatus('error');
      }
    },
    [handleTranscriptEvent],
  );

  /** カメラデバイスを切り替える。'dummy' を指定するとキャンバス製のダミー映像を使用 */
  const changeCamera = useCallback(
    async (deviceId: string) => {
      const session = sessionRef.current;
      if (!session) return;

      // 前のダミーストリームをクリーンアップ
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

  /** 解像度を変更する */
  const changeResolution = useCallback(
    async (width: number, height: number) => {
      const session = sessionRef.current;
      if (!session) return;
      setResolution({ width, height });

      if (isDummyCamera) {
        // ダミーカメラを新しい解像度で再生成
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
      if (speechRecognitionRef.current) {
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
    startMeeting,
    endMeeting,
    toggleMute,
    toggleVideo,
    changeCamera,
    changeResolution,
    startContentShare,
    stopContentShare,
  };
}
