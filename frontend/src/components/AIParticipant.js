import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
const corner = {
    position: 'absolute',
    width: 20,
    height: 20,
    zIndex: 10,
};
export function AIParticipant({ isSpeaking, isProcessing, aiText }) {
    const statusColor = isProcessing ? '#f59e0b' : isSpeaking ? '#10b981' : '#00bfff';
    const statusText = isProcessing ? '解析中...' : isSpeaking ? '応答中' : '待機中';
    const statusBg = isProcessing ? 'rgba(245,158,11,0.2)' : isSpeaking ? 'rgba(16,185,129,0.2)' : 'rgba(0,191,255,0.15)';
    return (_jsxs("div", { style: {
            position: 'relative',
            width: '100%',
            height: '100%',
            background: '#000',
            borderRadius: 10,
            overflow: 'hidden',
            animation: isSpeaking ? 'speaking-pulse 1.2s ease-out infinite' : undefined,
        }, children: [_jsx("style", { children: arStyles }), _jsx("video", { src: "/aibot.mp4", autoPlay: true, loop: true, muted: true, playsInline: true, style: { width: '100%', height: '100%', objectFit: 'cover' } }), _jsx("div", { style: { ...corner, top: 8, left: 8, borderTop: `2px solid ${statusColor}cc`, borderLeft: `2px solid ${statusColor}cc` } }), _jsx("div", { style: { ...corner, top: 8, right: 8, borderTop: `2px solid ${statusColor}cc`, borderRight: `2px solid ${statusColor}cc` } }), _jsx("div", { style: { ...corner, bottom: 8, left: 8, borderBottom: `2px solid ${statusColor}cc`, borderLeft: `2px solid ${statusColor}cc` } }), _jsx("div", { style: { ...corner, bottom: 8, right: 8, borderBottom: `2px solid ${statusColor}cc`, borderRight: `2px solid ${statusColor}cc` } }), isProcessing && (_jsx("div", { style: {
                    position: 'absolute',
                    left: 0,
                    width: '100%',
                    height: 2,
                    background: `linear-gradient(90deg, transparent, ${statusColor}cc, transparent)`,
                    animation: 'scan 2s linear infinite',
                    zIndex: 5,
                    boxShadow: `0 0 6px ${statusColor}`,
                } })), _jsx("div", { style: {
                    position: 'absolute',
                    top: 8,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    zIndex: 10,
                }, children: _jsx("div", { style: {
                        fontSize: 11,
                        color: `${statusColor}`,
                        fontWeight: 700,
                        background: 'rgba(0,0,0,0.55)',
                        padding: '2px 10px',
                        borderRadius: 6,
                        letterSpacing: '0.06em',
                        backdropFilter: 'blur(4px)',
                        animation: 'pulse-border 3s ease-in-out infinite',
                    }, children: "AI \u30A2\u30B7\u30B9\u30BF\u30F3\u30C8" }) }), _jsx("div", { style: {
                    position: 'absolute',
                    bottom: aiText ? 44 : 8,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    zIndex: 10,
                }, children: _jsx("div", { style: {
                        fontSize: 11,
                        padding: '3px 12px',
                        borderRadius: 20,
                        background: statusBg,
                        color: statusColor,
                        border: `1px solid ${statusColor}50`,
                        fontWeight: 600,
                        backdropFilter: 'blur(4px)',
                    }, children: statusText }) }), aiText && (_jsx("div", { style: {
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
                    WebkitBoxOrient: 'vertical',
                    backdropFilter: 'blur(6px)',
                }, children: aiText }))] }));
}
