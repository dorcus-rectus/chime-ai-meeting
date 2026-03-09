import { useState, useRef, useCallback } from 'react';

export interface UseScreenShareReturn {
  isSharing: boolean;
  error: string | null;
  screenVideoRef: React.RefObject<HTMLVideoElement | null>;
  startScreenShare: () => Promise<MediaStream | null>;
  stopScreenShare: () => void;
  captureFrame: () => string | null;
}

export function useScreenShare(): UseScreenShareReturn {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  // stopScreenShare を先に定義して startScreenShare から参照できるようにする
  const stopScreenShare = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    setIsSharing(false);
    setError(null);
  }, []);

  const startScreenShare = useCallback(async (): Promise<MediaStream | null> => {
    setError(null);
    // iOS Chrome/Firefox は getDisplayMedia 非対応
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('画面共有はこのブラウザでサポートされていません (iOS Safari 以外では利用できません)');
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // AI へのフレーム送信用に低フレームレートで十分
          frameRate: { ideal: 5, max: 15 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      // プレビュー用 <video> 要素に接続し、フレームが届くまで待機してから isSharing を true にする
      // (loadeddata より前に isSharing = true にすると captureFrame が videoWidth === 0 で null を返す)
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
        await new Promise<void>((resolve) => {
          const video = screenVideoRef.current!;
          if (video.videoWidth > 0) { resolve(); return; }
          const onReady = () => { video.removeEventListener('loadeddata', onReady); resolve(); };
          video.addEventListener('loadeddata', onReady);
          // フォールバック: 2 秒経っても loadeddata が来なければ続行
          setTimeout(resolve, 2000);
        });
        screenVideoRef.current.play().catch(console.error);
      }

      // ユーザーが OS 側の「共有停止」ボタンを押した際のハンドリング
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopScreenShare();
      });

      setIsSharing(true);
      return stream;
    } catch (err) {
      // 取得済みのストリームがあれば確実に停止してリークを防ぐ
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      // NotAllowedError はユーザーのキャンセル操作なのでエラー表示しない
      if (err instanceof Error && err.name !== 'NotAllowedError') {
        setError(`画面共有の開始に失敗しました: ${err.message}`);
      }
      return null;
    }
  }, [stopScreenShare]);

  /**
   * 現在の画面フレームを JPEG (Base64) としてキャプチャする。
   * AI へ送信するため最大幅 1280px にリサイズし、ファイルサイズを抑制する。
   * 画面共有が非アクティブな場合は null を返す。
   */
  const captureFrame = useCallback((maxWidth = 1280, quality = 0.65): string | null => {
    const video = screenVideoRef.current;
    if (!video || !streamRef.current || video.videoWidth === 0) return null;

    // アスペクト比を保ちながら縮小 (API ペイロードサイズ削減)
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, w, h);

    // "data:image/jpeg;base64," プレフィックスを除いた Base64 文字列を返す
    return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? null;
  }, []);

  return { isSharing, error, screenVideoRef, startScreenShare, stopScreenShare, captureFrame };
}
