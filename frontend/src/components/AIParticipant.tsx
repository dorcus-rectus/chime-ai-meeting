import { type CSSProperties, useRef, useEffect } from 'react';

interface AIParticipantProps {
  isSpeaking: boolean;
  isProcessing: boolean;
  aiText: string;
}

const arStyles = `
  @keyframes scan {
    0%   { top: 0%; opacity: 0.8; }
    48%  { opacity: 0.8; }
    50%  { top: 100%; opacity: 0; }
    50.1%{ top: 0%; opacity: 0; }
    52%  { opacity: 0.8; }
    100% { top: 100%; opacity: 0.8; }
  }
  @keyframes pulse-border {
    0%   { opacity: 0.7; }
    50%  { opacity: 0.2; }
    100% { opacity: 0.7; }
  }
  @keyframes speaking-pulse {
    0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
    70%  { box-shadow: 0 0 0 8px rgba(16,185,129,0); }
    100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
  }
`;

const corner: CSSProperties = {
  position: 'absolute',
  width: 20,
  height: 20,
  zIndex: 10,
};

export function AIParticipant({ isSpeaking, isProcessing, aiText }: AIParticipantProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // autoPlay 属性だけでは一部ブラウザで再生されないため、マウント時に play() を呼ぶ
  // play() は readyState に関わらず呼んでよい — ブラウザがキューに積んで再生可能になり次第実行する
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tryPlay = () => { video.play().catch(() => {}); };
    tryPlay();
    video.addEventListener('canplay', tryPlay);
    return () => video.removeEventListener('canplay', tryPlay);
  }, []);

  const statusColor = isProcessing ? '#f59e0b' : isSpeaking ? '#10b981' : '#00bfff';
  const statusText  = isProcessing ? '解析中...' : isSpeaking ? '応答中' : '待機中';
  const statusBg    = isProcessing ? 'rgba(245,158,11,0.2)' : isSpeaking ? 'rgba(16,185,129,0.2)' : 'rgba(0,191,255,0.15)';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#000',
        borderRadius: 10,
        overflow: 'hidden',
        animation: isSpeaking ? 'speaking-pulse 1.2s ease-out infinite' : undefined,
      }}
    >
      <style>{arStyles}</style>

      {/* AI アバター映像 — React 19 では muted が HTML 属性として正しく出力される */}
      <video
        ref={videoRef}
        src="/aibot.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />

      {/* AR コーナーブラケット — 左上 */}
      <div style={{ ...corner, top: 8, left: 8, borderTop: `2px solid ${statusColor}cc`, borderLeft: `2px solid ${statusColor}cc` }} />
      {/* 右上 */}
      <div style={{ ...corner, top: 8, right: 8, borderTop: `2px solid ${statusColor}cc`, borderRight: `2px solid ${statusColor}cc` }} />
      {/* 左下 */}
      <div style={{ ...corner, bottom: 8, left: 8, borderBottom: `2px solid ${statusColor}cc`, borderLeft: `2px solid ${statusColor}cc` }} />
      {/* 右下 */}
      <div style={{ ...corner, bottom: 8, right: 8, borderBottom: `2px solid ${statusColor}cc`, borderRight: `2px solid ${statusColor}cc` }} />

      {/* スキャンライン (解析中のみ) */}
      {isProcessing && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: '100%',
            height: 2,
            background: `linear-gradient(90deg, transparent, ${statusColor}cc, transparent)`,
            animation: 'scan 2s linear infinite',
            zIndex: 5,
            boxShadow: `0 0 6px ${statusColor}`,
          }}
        />
      )}

      {/* ラベル */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          zIndex: 10,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: `${statusColor}`,
            fontWeight: 700,
            background: 'rgba(0,0,0,0.55)',
            padding: '2px 10px',
            borderRadius: 6,
            letterSpacing: '0.06em',
            backdropFilter: 'blur(4px)',
            animation: 'pulse-border 3s ease-in-out infinite',
          }}
        >
          AI アシスタント
        </div>
      </div>

      {/* ステータスバッジ */}
      <div
        style={{
          position: 'absolute',
          bottom: aiText ? 44 : 8,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          zIndex: 10,
        }}
      >
        <div
          style={{
            fontSize: 11,
            padding: '3px 12px',
            borderRadius: 20,
            background: statusBg,
            color: statusColor,
            border: `1px solid ${statusColor}50`,
            fontWeight: 600,
            backdropFilter: 'blur(4px)',
          }}
        >
          {statusText}
        </div>
      </div>

      {/* 最新 AI 発言 */}
      {aiText && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            right: 8,
            background: 'rgba(0,0,0,0.72)',
            border: `1px solid ${statusColor}40`,
            borderRadius: 8,
            padding: '5px 9px',
            fontSize: 11,
            color: '#c0e0ff',
            lineHeight: 1.5,
            zIndex: 10,
            maxHeight: 56,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical' as CSSProperties['WebkitBoxOrient'],
            backdropFilter: 'blur(6px)',
          }}
        >
          {aiText}
        </div>
      )}
    </div>
  );
}
