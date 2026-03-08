import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { useMeeting, DUMMY_DEVICE_ID } from '../hooks/useMeeting';
import { useAIConversation } from '../hooks/useAIConversation';
import { useScreenShare } from '../hooks/useScreenShare';
import { AIParticipant } from './AIParticipant';
import { DocumentUpload } from './DocumentUpload';
import { RESOLUTIONS } from '../types';
// ─── スタイル ──────────────────────────────────────────────────────────────────
const s = {
    root: { display: 'flex', flexDirection: 'column', background: '#0f0f1a', color: '#e0e0e0', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    title: { fontSize: 16, fontWeight: 700, color: '#a78bfa' },
    statusPill: { fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600 },
    videoArea: { display: 'flex', flex: 1, gap: 10, padding: 10, overflow: 'hidden' },
    videoCard: { flex: 1, background: '#1a1a2e', borderRadius: 10, overflow: 'hidden', position: 'relative', minHeight: 0 },
    screenCard: { flex: 2, background: '#0a0a1a', border: '1px solid #3b82f6', borderRadius: 10, overflow: 'hidden', position: 'relative', minHeight: 0 },
    localVideo: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' },
    screenVideo: { width: '100%', height: '100%', objectFit: 'contain', background: '#0a0a1a' },
    videoLabel: { position: 'absolute', bottom: 8, left: 10, fontSize: 11, background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: 6, color: '#e0e0e0', fontWeight: 600 },
    screenLabel: { position: 'absolute', top: 8, left: 10, fontSize: 11, background: 'rgba(59,130,246,0.8)', padding: '2px 8px', borderRadius: 6, color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 },
    frameIndicator: { position: 'absolute', top: 8, right: 10, fontSize: 10, background: 'rgba(16,185,129,0.8)', padding: '2px 8px', borderRadius: 6, color: '#fff', fontWeight: 600 },
    chatArea: { flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 },
    chatEmpty: { color: '#4a4a7a', fontSize: 11, textAlign: 'center', marginTop: 16, lineHeight: 1.8 },
    bubble: { padding: '7px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.5, maxWidth: '92%', wordBreak: 'break-word' },
    sidebarSection: { padding: '8px 10px', borderTop: '1px solid #2a2a4a', flexShrink: 0 },
    controls: { display: 'flex', justifyContent: 'center', gap: 10, padding: '10px 16px', background: '#16162a', borderTop: '1px solid #2a2a4a', flexShrink: 0 },
    btn: { border: 'none', borderRadius: 50, width: 44, height: 44, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    endBtn: { borderRadius: 22, width: 'auto', padding: '0 20px', fontSize: 13, fontWeight: 700 },
    lobby: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 20, background: '#0f0f1a' },
    lobbyTitle: { fontSize: 28, fontWeight: 700, color: '#a78bfa', textAlign: 'center' },
    lobbySubtitle: { color: '#6b7280', fontSize: 14, textAlign: 'center', lineHeight: 1.8, maxWidth: 380 },
    startBtn: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 36px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
    logoutBtn: { background: 'none', border: '1px solid #2a2a4a', borderRadius: 8, color: '#6b7280', fontSize: 12, cursor: 'pointer', padding: '4px 12px' },
    errorBox: { background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 16px', color: '#fca5a5', fontSize: 12, maxWidth: 360, textAlign: 'center' },
    ragBadge: { fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(102,126,234,0.2)', color: '#a78bfa', fontWeight: 600, display: 'inline-block', marginTop: 2 },
    frameBadge: { fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(16,185,129,0.2)', color: '#10b981', fontWeight: 600, display: 'inline-block', marginTop: 2, marginLeft: 4 },
    attachBadge: { fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.2)', color: '#60a5fa', fontWeight: 600, display: 'inline-block', marginTop: 2, marginLeft: 4 },
    // チャット入力エリア
    chatInputArea: { padding: '8px', borderTop: '1px solid #2a2a4a', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 },
    chatInputRow: { display: 'flex', gap: 6, alignItems: 'flex-end' },
    chatInput: { flex: 1, background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 8, color: '#e0e0e0', fontSize: 12, padding: '7px 10px', resize: 'none', fontFamily: 'inherit', outline: 'none', maxHeight: 80, overflowY: 'auto' },
    iconBtn: { background: '#1e1e3a', border: '1px solid #2a2a4a', borderRadius: 8, color: '#a0a0c0', fontSize: 16, cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    sendBtn: { background: 'rgba(102,126,234,0.25)', border: '1px solid rgba(102,126,234,0.4)', borderRadius: 8, color: '#a78bfa', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '6px 12px', flexShrink: 0 },
    attachPreview: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#60a5fa', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, padding: '4px 8px' },
    // カメラ設定パネル
    cameraPanel: { padding: '10px', borderTop: '1px solid #2a2a4a', background: '#13132a', flexShrink: 0 },
    cameraPanelTitle: { fontSize: 11, fontWeight: 700, color: '#a0a0c0', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    select: { width: '100%', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 6, color: '#e0e0e0', fontSize: 11, padding: '5px 8px', outline: 'none', cursor: 'pointer', marginBottom: 6 },
    dummyToggle: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#a0a0c0', cursor: 'pointer' },
};
// ─── チャットバブル ─────────────────────────────────────────────────────────────
function ChatBubble({ msg }) {
    const isUser = msg.role === 'user';
    return (_jsx("div", { style: { alignSelf: isUser ? 'flex-end' : 'flex-start' }, children: _jsxs("div", { style: {
                ...s.bubble,
                background: isUser ? 'rgba(102,126,234,0.22)' : 'rgba(55,55,80,0.8)',
                borderBottomRightRadius: isUser ? 2 : 8,
                borderBottomLeftRadius: isUser ? 8 : 2,
            }, children: [!isUser && _jsx("div", { style: { fontSize: 9, color: '#a78bfa', fontWeight: 700, marginBottom: 2 }, children: "AI" }), msg.content, isUser && msg.hasFrame && _jsx("div", { style: s.frameBadge, children: "\uD83D\uDDA5\uFE0F \u753B\u9762" })] }) }));
}
// ─── MeetingRoom ───────────────────────────────────────────────────────────────
export function MeetingRoom({ auth, onOpenProfile }) {
    const chatBottomRef = useRef(null);
    const fileInputRef = useRef(null);
    // チャット入力ステート
    const [chatText, setChatText] = useState('');
    const [attachment, setAttachment] = useState(null);
    // カメラ設定パネル表示
    const [showCameraSettings, setShowCameraSettings] = useState(false);
    // 画面共有フック
    const { isSharing, error: screenShareError, screenVideoRef, startScreenShare, stopScreenShare, captureFrame } = useScreenShare();
    // 会議フック
    const { status, meetingId, isMuted, isVideoOn, isDummyCamera, videoDevices, selectedDeviceId, resolution, localVideoRef, audioRef, errorMessage, startMeeting, endMeeting, toggleMute, toggleVideo, changeCamera, changeResolution, startContentShare, stopContentShare, } = useMeeting((transcript) => {
        const frame = isSharing ? captureFrame() : null;
        sendTranscript(transcript, frame ?? undefined);
        setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });
    // AI 会話フック
    const { messages, aiText, isProcessing, isSpeaking, error, sendTranscript, sendMessage } = useAIConversation({
        sessionId: meetingId,
        getIdToken: auth.getIdToken,
    });
    const handleStartMeeting = async () => {
        const token = await auth.getIdToken();
        await startMeeting(token);
    };
    const handleToggleScreenShare = async () => {
        if (isSharing) {
            stopScreenShare();
            stopContentShare();
        }
        else {
            const stream = await startScreenShare();
            if (stream)
                await startContentShare(stream);
        }
    };
    // ─── ファイル添付 ───────────────────────────────────────────────────────────
    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        e.target.value = '';
        const isImage = file.type.startsWith('image/');
        const isText = file.type.startsWith('text/') || /\.(txt|md|csv|log)$/i.test(file.name);
        if (isImage) {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                const base64 = dataUrl.split(',')[1];
                setAttachment({ type: 'image', base64, mimeType: file.type, name: file.name });
            };
            reader.readAsDataURL(file);
        }
        else if (isText) {
            const reader = new FileReader();
            reader.onload = () => {
                setAttachment({ type: 'text', content: reader.result, name: file.name });
            };
            reader.readAsText(file);
        }
        else {
            alert('対応ファイル形式: 画像 (JPG / PNG / GIF / WebP)、テキスト (TXT / MD / CSV)');
        }
    };
    // ─── チャット送信 ───────────────────────────────────────────────────────────
    const handleSendChat = async (e) => {
        e?.preventDefault();
        if (!chatText.trim() && !attachment)
            return;
        if (isProcessing)
            return;
        const text = chatText.trim();
        const att = attachment ?? undefined;
        setChatText('');
        setAttachment(null);
        await sendMessage(text, att);
        setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    };
    const handleChatKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSendChat();
        }
    };
    // ─── カメラ設定 ─────────────────────────────────────────────────────────────
    const handleCameraChange = async (deviceId) => {
        await changeCamera(deviceId);
    };
    const handleResolutionChange = async (idx) => {
        const res = RESOLUTIONS[idx];
        if (res)
            await changeResolution(res.width, res.height);
    };
    const currentResolutionIdx = RESOLUTIONS.findIndex((r) => r.width === resolution.width && r.height === resolution.height);
    // ─── ステータス情報 ─────────────────────────────────────────────────────────
    const statusInfo = status === 'connecting'
        ? { text: '接続中...', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
        : { text: '会議中', color: '#10b981', bg: 'rgba(16,185,129,0.12)' };
    const userEmail = auth.user?.signInDetails?.loginId ?? '';
    // ─── ロビー ─────────────────────────────────────────────────────────────────
    if (status === 'idle' || status === 'error') {
        return (_jsxs("div", { className: "lobby-screen", children: [_jsx("div", { style: { fontSize: 56 }, children: "\uD83C\uDFA5" }), _jsx("div", { style: s.lobbyTitle, children: "AI \u30D3\u30C7\u30AA\u4F1A\u8B70" }), _jsxs("div", { style: s.lobbySubtitle, children: ["Amazon Chime SDK \u00D7 Bedrock AgentCore \u3067\u4F1A\u8B70\u5BA4\u306B AI \u304C\u53C2\u52A0\u3057\u307E\u3059", _jsx("br", {}), _jsx("span", { style: { color: '#a78bfa', fontSize: 12 }, children: "\u65E5\u672C\u8A9E\u3067\u8A71\u3057\u304B\u3051\u308B\u3068 AI \u304C\u5FDC\u7B54\u3057\u307E\u3059" }), _jsx("br", {}), _jsx("span", { style: { color: '#3b82f6', fontSize: 12 }, children: "\uD83D\uDDA5\uFE0F \u753B\u9762\u5171\u6709\u4E2D\u306B\u8A71\u3057\u304B\u3051\u308B\u3068 AI \u304C\u753B\u9762\u3092\u89E3\u6790\u3057\u307E\u3059" })] }), (errorMessage || error) && _jsx("div", { style: s.errorBox, children: errorMessage || error }), _jsx("button", { style: s.startBtn, onClick: handleStartMeeting, children: "\u4F1A\u8B70\u3092\u958B\u59CB\u3059\u308B" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }, children: [_jsxs("span", { style: { fontSize: 12, color: '#6b7280' }, children: [userEmail, " \u3067\u30ED\u30B0\u30A4\u30F3\u4E2D"] }), _jsx("button", { style: s.logoutBtn, onClick: onOpenProfile, children: "\u30A2\u30AB\u30A6\u30F3\u30C8\u8A2D\u5B9A" }), _jsx("button", { style: s.logoutBtn, onClick: auth.logout, children: "\u30ED\u30B0\u30A2\u30A6\u30C8" })] })] }));
    }
    if (status === 'ended') {
        return (_jsxs("div", { className: "lobby-screen", children: [_jsx("div", { style: { fontSize: 56 }, children: "\uD83D\uDC4B" }), _jsx("div", { style: s.lobbyTitle, children: "\u4F1A\u8B70\u304C\u7D42\u4E86\u3057\u307E\u3057\u305F" }), _jsx("button", { style: s.startBtn, onClick: handleStartMeeting, children: "\u3082\u3046\u4E00\u5EA6\u53C2\u52A0\u3059\u308B" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }, children: [_jsx("button", { style: s.logoutBtn, onClick: onOpenProfile, children: "\u30A2\u30AB\u30A6\u30F3\u30C8\u8A2D\u5B9A" }), _jsx("button", { style: s.logoutBtn, onClick: auth.logout, children: "\u30ED\u30B0\u30A2\u30A6\u30C8" })] })] }));
    }
    // ─── 会議室メイン ───────────────────────────────────────────────────────────
    return (_jsxs("div", { className: "screen-full", style: s.root, children: [_jsxs("div", { className: "meeting-header", children: [_jsx("div", { style: s.title, children: "\uD83C\uDFA5 AI \u30D3\u30C7\u30AA\u4F1A\u8B70" }), _jsxs("div", { className: "meeting-header-right", children: [_jsx("div", { className: "hide-tablet", style: { fontSize: 12, color: '#6b7280', background: '#0f0f1a', padding: '4px 10px', borderRadius: 20, border: '1px solid #2a2a4a' }, children: userEmail }), _jsx("div", { style: { ...s.statusPill, color: statusInfo.color, background: statusInfo.bg, border: `1px solid ${statusInfo.color}30` }, children: statusInfo.text }), isSharing && (_jsx("div", { className: "hide-tablet", style: { ...s.statusPill, color: '#3b82f6', background: 'rgba(59,130,246,0.12)', border: '1px solid #3b82f630', fontSize: 11, padding: '3px 10px' }, children: "\uD83D\uDDA5\uFE0F \u753B\u9762\u5171\u6709\u4E2D" })), _jsx("button", { style: s.logoutBtn, onClick: onOpenProfile, children: "\u8A2D\u5B9A" }), _jsx("button", { style: s.logoutBtn, onClick: auth.logout, children: "\u30ED\u30B0\u30A2\u30A6\u30C8" })] })] }), _jsxs("div", { className: "meeting-body", children: [_jsxs("div", { style: s.videoArea, children: [_jsx("div", { style: s.videoCard, children: _jsx(AIParticipant, { isSpeaking: isSpeaking, isProcessing: isProcessing, aiText: aiText }) }), isSharing && (_jsxs("div", { style: s.screenCard, children: [_jsx("video", { ref: screenVideoRef, autoPlay: true, muted: true, playsInline: true, style: s.screenVideo }), _jsx("div", { style: s.screenLabel, children: _jsx("span", { children: "\uD83D\uDDA5\uFE0F \u753B\u9762\u5171\u6709" }) }), isProcessing && _jsx("div", { style: s.frameIndicator, children: "AI \u89E3\u6790\u4E2D..." })] })), _jsxs("div", { style: s.videoCard, children: [_jsx("video", { ref: localVideoRef, autoPlay: true, muted: true, playsInline: true, style: { ...s.localVideo, display: isVideoOn ? 'block' : 'none' } }), !isVideoOn && (_jsx("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 40 }, children: "\uD83D\uDC64" })), _jsxs("div", { style: s.videoLabel, children: ["\u3042\u306A\u305F ", isMuted && '🔇', " ", isDummyCamera && '(ダミー)'] })] })] }), _jsxs("div", { className: "meeting-sidebar", children: [_jsx("div", { style: { padding: '8px 10px', borderBottom: '1px solid #2a2a4a', fontSize: 11, fontWeight: 600, color: '#a0a0c0' }, children: "\u4F1A\u8A71\u5C65\u6B74 (\u97F3\u58F0 + \u30C1\u30E3\u30C3\u30C8)" }), _jsxs("div", { style: s.chatArea, children: [messages.length === 0 ? (_jsxs("div", { style: s.chatEmpty, children: ["\u8A71\u3057\u304B\u3051\u308B\u304B\u3001\u4E0B\u306E\u30C1\u30E3\u30C3\u30C8\u306B\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044", _jsx("br", {}), "\uD83D\uDCCE \u30D5\u30A1\u30A4\u30EB\u3092\u6DFB\u4ED8\u3057\u3066 AI \u306B\u5206\u6790\u3055\u305B\u308B\u3053\u3068\u3082\u3067\u304D\u307E\u3059", isSharing && _jsxs(_Fragment, { children: [_jsx("br", {}), _jsx("span", { style: { color: '#3b82f6' }, children: "\uD83D\uDDA5\uFE0F \u753B\u9762\u5171\u6709\u4E2D\u306F\u753B\u9762\u3092\u89E3\u6790\u3057\u307E\u3059" })] })] })) : (messages.map((msg, i) => _jsx(ChatBubble, { msg: msg }, i))), isProcessing && (_jsx("div", { style: { alignSelf: 'flex-start' }, children: _jsx("div", { style: { ...s.bubble, background: 'rgba(55,55,80,0.8)', color: '#a78bfa', fontSize: 11 }, children: isSharing ? '🖥️ 画面を解析中...' : 'AI が考え中...' }) })), (error || screenShareError) && (_jsxs("div", { style: { ...s.bubble, background: 'rgba(239,68,68,0.12)', color: '#fca5a5', fontSize: 11, alignSelf: 'center' }, children: ["\u26A0\uFE0F ", error || screenShareError] })), _jsx("div", { ref: chatBottomRef })] }), _jsxs("div", { style: s.chatInputArea, children: [attachment && (_jsxs("div", { style: s.attachPreview, children: [_jsx("span", { children: attachment.type === 'image' ? '🖼️' : '📄' }), _jsx("span", { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: attachment.name }), _jsx("button", { onClick: () => setAttachment(null), style: { background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: 0 }, children: "\u2715" })] })), _jsx("form", { onSubmit: handleSendChat, style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: _jsxs("div", { style: s.chatInputRow, children: [_jsx("button", { type: "button", style: s.iconBtn, title: "\u30D5\u30A1\u30A4\u30EB\u3092\u6DFB\u4ED8 (\u753B\u50CF\u30FB\u30C6\u30AD\u30B9\u30C8)", onClick: () => fileInputRef.current?.click(), children: "\uD83D\uDCCE" }), _jsx("input", { ref: fileInputRef, type: "file", accept: "image/*,text/*,.txt,.md,.csv,.log", style: { display: 'none' }, onChange: handleFileChange }), _jsx("textarea", { style: s.chatInput, value: chatText, onChange: (e) => setChatText(e.target.value), onKeyDown: handleChatKeyDown, placeholder: "\u30E1\u30C3\u30BB\u30FC\u30B8\u3092\u5165\u529B\u2026 (Enter \u3067\u9001\u4FE1 / Shift+Enter \u3067\u6539\u884C)", rows: 1 }), _jsx("button", { type: "submit", style: {
                                                        ...s.sendBtn,
                                                        opacity: (!chatText.trim() && !attachment) || isProcessing ? 0.4 : 1,
                                                        cursor: (!chatText.trim() && !attachment) || isProcessing ? 'not-allowed' : 'pointer',
                                                    }, disabled: (!chatText.trim() && !attachment) || isProcessing, children: "\u9001\u4FE1" })] }) })] }), _jsx("div", { style: s.sidebarSection, children: _jsx(DocumentUpload, { getIdToken: auth.getIdToken }) })] })] }), showCameraSettings && (_jsxs("div", { style: s.cameraPanel, children: [_jsxs("div", { style: s.cameraPanelTitle, children: [_jsx("span", { children: "\u2699\uFE0F \u30AB\u30E1\u30E9\u8A2D\u5B9A" }), _jsx("button", { onClick: () => setShowCameraSettings(false), style: { background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14 }, children: "\u2715" })] }), _jsxs("select", { style: s.select, value: isDummyCamera ? DUMMY_DEVICE_ID : selectedDeviceId, onChange: (e) => void handleCameraChange(e.target.value), children: [videoDevices.map((d) => (_jsx("option", { value: d.deviceId, children: d.label || `カメラ ${d.deviceId.slice(0, 8)}` }, d.deviceId))), _jsx("option", { value: DUMMY_DEVICE_ID, children: "\u30C0\u30DF\u30FC\u30AB\u30E1\u30E9 (\u30AB\u30E1\u30E9\u7121\u52B9)" })] }), _jsx("select", { style: s.select, value: currentResolutionIdx >= 0 ? currentResolutionIdx : 1, onChange: (e) => void handleResolutionChange(Number(e.target.value)), children: RESOLUTIONS.map((r, i) => (_jsx("option", { value: i, children: r.label }, i))) })] })), _jsxs("div", { style: s.controls, children: [_jsx("button", { style: { ...s.btn, background: isMuted ? '#ef4444' : '#2a2a4a', color: '#fff' }, onClick: toggleMute, title: isMuted ? 'ミュート解除' : 'ミュート', children: isMuted ? '🔇' : '🎤' }), _jsx("button", { style: { ...s.btn, background: isVideoOn ? '#2a2a4a' : '#ef4444', color: '#fff' }, onClick: toggleVideo, title: isVideoOn ? 'カメラ OFF' : 'カメラ ON', children: isVideoOn ? '📷' : '🚫' }), _jsx("button", { style: { ...s.btn, background: isSharing ? '#3b82f6' : '#2a2a4a', color: '#fff' }, onClick: handleToggleScreenShare, title: isSharing ? '画面共有を停止' : '画面を共有して AI に解析させる', children: "\uD83D\uDDA5\uFE0F" }), _jsx("button", { style: { ...s.btn, background: showCameraSettings ? '#a78bfa' : '#2a2a4a', color: '#fff' }, onClick: () => setShowCameraSettings((p) => !p), title: "\u30AB\u30E1\u30E9\u8A2D\u5B9A (\u30C7\u30D0\u30A4\u30B9\u30FB\u89E3\u50CF\u5EA6\u30FB\u30C0\u30DF\u30FC\u30AB\u30E1\u30E9)", children: "\u2699\uFE0F" }), _jsx("button", { style: { ...s.btn, ...s.endBtn, background: '#dc2626', color: '#fff' }, onClick: endMeeting, children: "\uD83D\uDCF5 \u9000\u51FA" })] }), _jsx("audio", { ref: audioRef, style: { display: 'none' } })] }));
}
