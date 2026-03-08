import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useRef, useCallback } from 'react';
import { API_URL } from '../config';
const s = {
    root: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        background: '#0f0f1a',
        padding: '16px',
        boxSizing: 'border-box',
    },
    header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 },
    title: { fontSize: 20, fontWeight: 700, color: '#a78bfa' },
    backBtn: {
        background: 'none',
        border: '1px solid #2a2a4a',
        borderRadius: 8,
        color: '#6b7280',
        fontSize: 13,
        cursor: 'pointer',
        padding: '6px 14px',
        marginLeft: 'auto',
    },
    section: {
        background: '#0f0f1a',
        border: '1px solid #2a2a4a',
        borderRadius: 10,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
    },
    sectionTitle: { fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' },
    infoRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 },
    infoLabel: { color: '#6b7280' },
    infoValue: { color: '#e0e0e0', fontWeight: 500 },
    dangerSection: {
        background: 'rgba(239,68,68,0.06)',
        border: '1px solid rgba(239,68,68,0.3)',
        borderRadius: 10,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
    },
    dangerTitle: { fontSize: 12, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em' },
    dangerDesc: { fontSize: 12, color: '#9ca3af', lineHeight: 1.6 },
    deleteBtn: {
        width: '100%',
        padding: '11px',
        background: 'transparent',
        color: '#ef4444',
        border: '1px solid #ef4444',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
    },
    deleteBtnDisabled: {
        opacity: 0.5,
        cursor: 'not-allowed',
    },
    confirmBox: {
        background: 'rgba(239,68,68,0.12)',
        border: '1px solid #ef4444',
        borderRadius: 10,
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
    },
    confirmText: { fontSize: 13, color: '#fca5a5', lineHeight: 1.6 },
    confirmInput: {
        width: '100%',
        padding: '9px 12px',
        background: '#0f0f1a',
        border: '1px solid #ef4444',
        borderRadius: 6,
        color: '#e0e0e0',
        fontSize: 13,
        outline: 'none',
        boxSizing: 'border-box',
    },
    confirmRow: { display: 'flex', gap: 8 },
    confirmDeleteBtn: {
        flex: 1,
        padding: '10px',
        background: '#ef4444',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
    },
    cancelBtn: {
        flex: 1,
        padding: '10px',
        background: 'transparent',
        color: '#6b7280',
        border: '1px solid #2a2a4a',
        borderRadius: 8,
        fontSize: 13,
        cursor: 'pointer',
    },
    errorBox: {
        background: 'rgba(239,68,68,0.12)',
        border: '1px solid #ef4444',
        borderRadius: 8,
        padding: '10px 14px',
        color: '#fca5a5',
        fontSize: 13,
    },
    loadingText: { color: '#6b7280', fontSize: 13 },
    // デバイステスト
    deviceRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 },
    deviceLabel: { color: '#6b7280', width: 48, flexShrink: 0 },
    deviceSelect: { flex: 1, background: '#16162a', border: '1px solid #2a2a4a', borderRadius: 6, color: '#e0e0e0', fontSize: 12, padding: '4px 8px', outline: 'none' },
    testVideoWrap: { borderRadius: 8, overflow: 'hidden', background: '#0a0a1a', aspectRatio: '16/9', width: '100%' },
    testVideo: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' },
    levelBar: { flex: 1, height: 10, background: '#1a1a2e', borderRadius: 5, overflow: 'hidden' },
    testBtn: { width: '100%', padding: '9px', background: 'transparent', border: '1px solid #a78bfa', borderRadius: 8, color: '#a78bfa', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
    stopBtn: { width: '100%', padding: '9px', background: 'transparent', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
};
export function UserProfile({ auth, onBack }) {
    const [userInfo, setUserInfo] = useState(null);
    const [loadingInfo, setLoadingInfo] = useState(true);
    const [showConfirm, setShowConfirm] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [localError, setLocalError] = useState('');
    // ─── デバイステスト ─────────────────────────────────────────────
    const [testActive, setTestActive] = useState(false);
    const [cameras, setCameras] = useState([]);
    const [mics, setMics] = useState([]);
    const [selectedCam, setSelectedCam] = useState('');
    const [selectedMic, setSelectedMic] = useState('');
    const [micLevel, setMicLevel] = useState(0);
    const [testError, setTestError] = useState('');
    const testStreamRef = useRef(null);
    const testVideoRef = useRef(null);
    const animRef = useRef(0);
    const audioCtxRef = useRef(null);
    const stopTest = useCallback(() => {
        cancelAnimationFrame(animRef.current);
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        testStreamRef.current?.getTracks().forEach((t) => t.stop());
        testStreamRef.current = null;
        if (testVideoRef.current)
            testVideoRef.current.srcObject = null;
        setMicLevel(0);
        setTestActive(false);
    }, []);
    // アンマウント時にストリームを解放
    useEffect(() => () => stopTest(), [stopTest]);
    const startTest = useCallback(async (camId, micId) => {
        setTestError('');
        // 前のストリームを停止
        testStreamRef.current?.getTracks().forEach((t) => t.stop());
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        cancelAnimationFrame(animRef.current);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: camId ? { deviceId: { exact: camId } } : true,
                audio: micId ? { deviceId: { exact: micId } } : true,
            });
            testStreamRef.current = stream;
            // デバイス一覧を更新 (権限取得後にラベルが取れる)
            const devices = await navigator.mediaDevices.enumerateDevices();
            const camList = devices.filter((d) => d.kind === 'videoinput');
            const micList = devices.filter((d) => d.kind === 'audioinput');
            setCameras(camList);
            setMics(micList);
            if (!camId && camList.length > 0)
                setSelectedCam(camList[0].deviceId);
            if (!micId && micList.length > 0)
                setSelectedMic(micList[0].deviceId);
            // カメラプレビュー
            if (testVideoRef.current) {
                testVideoRef.current.srcObject = stream;
                testVideoRef.current.play().catch(() => { });
            }
            // マイクレベルメーター
            const ctx = new AudioContext();
            audioCtxRef.current = ctx;
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            ctx.createMediaStreamSource(stream).connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
                analyser.getByteFrequencyData(data);
                setMicLevel(Math.min(100, (data.reduce((a, b) => a + b, 0) / data.length) * 2.5));
                animRef.current = requestAnimationFrame(tick);
            };
            animRef.current = requestAnimationFrame(tick);
            setTestActive(true);
        }
        catch (e) {
            setTestError(e instanceof Error ? e.message : 'デバイスへのアクセスに失敗しました');
        }
    }, []);
    const handleCamChange = useCallback(async (deviceId) => {
        setSelectedCam(deviceId);
        if (testActive)
            await startTest(deviceId, selectedMic);
    }, [testActive, selectedMic, startTest]);
    const handleMicChange = useCallback(async (deviceId) => {
        setSelectedMic(deviceId);
        if (testActive)
            await startTest(selectedCam, deviceId);
    }, [testActive, selectedCam, startTest]);
    const displayError = localError || auth.error;
    const { getIdToken } = auth;
    useEffect(() => {
        (async () => {
            try {
                const token = await getIdToken();
                const res = await fetch(`${API_URL}/users`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    setUserInfo((await res.json()));
                }
            }
            catch {
                // 取得失敗時は Amplify のローカル情報を使用
            }
            finally {
                setLoadingInfo(false);
            }
        })();
    }, [getIdToken]);
    const handleDeleteAccount = async () => {
        if (confirmText !== 'DELETE')
            return;
        setLocalError('');
        setDeleting(true);
        try {
            await auth.deleteAccount();
        }
        catch {
            setLocalError('アカウントの削除に失敗しました。もう一度お試しください。');
            setDeleting(false);
        }
    };
    const email = userInfo?.email ?? auth.user?.signInDetails?.loginId ?? '';
    const createdAt = userInfo?.createdAt
        ? new Date(userInfo.createdAt).toLocaleDateString('ja-JP')
        : '—';
    return (_jsx("div", { style: s.root, children: _jsxs("div", { className: "profile-card", children: [_jsxs("div", { style: s.header, children: [_jsx("div", { style: { fontSize: 28 }, children: "\uD83D\uDC64" }), _jsx("div", { style: s.title, children: "\u30A2\u30AB\u30A6\u30F3\u30C8\u8A2D\u5B9A" }), _jsx("button", { style: s.backBtn, onClick: onBack, children: "\u623B\u308B" })] }), displayError && _jsx("div", { style: s.errorBox, children: displayError }), _jsxs("div", { style: s.section, children: [_jsx("div", { style: s.sectionTitle, children: "\u30C7\u30D0\u30A4\u30B9\u30C6\u30B9\u30C8" }), testError && _jsx("div", { style: { ...s.errorBox, fontSize: 12 }, children: testError }), testActive && (_jsxs(_Fragment, { children: [_jsx("div", { style: s.testVideoWrap, children: _jsx("video", { ref: testVideoRef, autoPlay: true, muted: true, playsInline: true, style: s.testVideo }) }), _jsxs("div", { style: s.deviceRow, children: [_jsx("span", { style: s.deviceLabel, children: "\uD83D\uDCF7 \u30AB\u30E1\u30E9" }), _jsx("select", { style: s.deviceSelect, value: selectedCam, onChange: (e) => void handleCamChange(e.target.value), children: cameras.map((d) => (_jsx("option", { value: d.deviceId, children: d.label || `カメラ ${d.deviceId.slice(0, 8)}` }, d.deviceId))) })] }), _jsxs("div", { style: s.deviceRow, children: [_jsx("span", { style: s.deviceLabel, children: "\uD83C\uDFA4 \u30DE\u30A4\u30AF" }), _jsx("select", { style: s.deviceSelect, value: selectedMic, onChange: (e) => void handleMicChange(e.target.value), children: mics.map((d) => (_jsx("option", { value: d.deviceId, children: d.label || `マイク ${d.deviceId.slice(0, 8)}` }, d.deviceId))) })] }), _jsxs("div", { style: s.deviceRow, children: [_jsx("span", { style: s.deviceLabel, children: "\u30EC\u30D9\u30EB" }), _jsx("div", { style: s.levelBar, children: _jsx("div", { style: { height: '100%', width: `${micLevel}%`, background: micLevel > 70 ? '#ef4444' : '#10b981', transition: 'width 0.08s' } }) }), _jsxs("span", { style: { fontSize: 11, color: '#6b7280', width: 32, textAlign: 'right' }, children: [Math.round(micLevel), "%"] })] }), _jsx("button", { style: s.stopBtn, onClick: stopTest, children: "\u30C6\u30B9\u30C8\u505C\u6B62" })] })), !testActive && (_jsx("button", { style: s.testBtn, onClick: () => void startTest(), children: "\u30C6\u30B9\u30C8\u958B\u59CB (\u30AB\u30E1\u30E9\u30FB\u30DE\u30A4\u30AF\u3092\u78BA\u8A8D)" }))] }), _jsxs("div", { style: s.section, children: [_jsx("div", { style: s.sectionTitle, children: "\u30A2\u30AB\u30A6\u30F3\u30C8\u60C5\u5831" }), loadingInfo ? (_jsx("div", { style: s.loadingText, children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." })) : (_jsxs(_Fragment, { children: [_jsxs("div", { style: s.infoRow, children: [_jsx("span", { style: s.infoLabel, children: "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9" }), _jsx("span", { style: s.infoValue, children: email })] }), _jsxs("div", { style: s.infoRow, children: [_jsx("span", { style: s.infoLabel, children: "\u767B\u9332\u65E5" }), _jsx("span", { style: s.infoValue, children: createdAt })] }), _jsxs("div", { style: s.infoRow, children: [_jsx("span", { style: s.infoLabel, children: "\u30B9\u30C6\u30FC\u30BF\u30B9" }), _jsx("span", { style: { ...s.infoValue, color: '#10b981' }, children: userInfo?.status === 'CONFIRMED' ? '確認済み' : userInfo?.status ?? '確認済み' })] })] }))] }), _jsxs("div", { style: s.section, children: [_jsx("div", { style: s.sectionTitle, children: "\u30BB\u30C3\u30B7\u30E7\u30F3" }), _jsx("button", { style: {
                                width: '100%',
                                padding: '10px',
                                background: 'transparent',
                                color: '#a78bfa',
                                border: '1px solid #a78bfa',
                                borderRadius: 8,
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: 'pointer',
                            }, onClick: auth.logout, children: "\u30ED\u30B0\u30A2\u30A6\u30C8" })] }), _jsxs("div", { style: s.dangerSection, children: [_jsx("div", { style: s.dangerTitle, children: "\u5371\u967A\u306A\u64CD\u4F5C" }), _jsx("div", { style: s.dangerDesc, children: "\u30A2\u30AB\u30A6\u30F3\u30C8\u3092\u524A\u9664\u3059\u308B\u3068\u3001\u4F1A\u8A71\u5C65\u6B74\u30FB\u5229\u7528\u8A18\u9332\u30FBRAG \u30C9\u30AD\u30E5\u30E1\u30F3\u30C8\u3092\u542B\u3080 \u3059\u3079\u3066\u306E\u30C7\u30FC\u30BF\u304C\u5B8C\u5168\u306B\u524A\u9664\u3055\u308C\u307E\u3059\u3002\u3053\u306E\u64CD\u4F5C\u306F\u5143\u306B\u623B\u305B\u307E\u305B\u3093\u3002" }), !showConfirm ? (_jsx("button", { style: s.deleteBtn, onClick: () => setShowConfirm(true), children: "\u30A2\u30AB\u30A6\u30F3\u30C8\u3092\u524A\u9664\u3059\u308B" })) : (_jsxs("div", { style: s.confirmBox, children: [_jsxs("div", { style: s.confirmText, children: ["\u672C\u5F53\u306B\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F\u78BA\u8A8D\u306E\u305F\u3081 ", _jsx("strong", { children: "DELETE" }), " \u3068\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002"] }), _jsx("input", { style: s.confirmInput, type: "text", value: confirmText, onChange: (e) => setConfirmText(e.target.value), placeholder: "DELETE", autoComplete: "off" }), _jsxs("div", { style: s.confirmRow, children: [_jsx("button", { style: {
                                                ...s.confirmDeleteBtn,
                                                ...(confirmText !== 'DELETE' || deleting ? s.deleteBtnDisabled : {}),
                                            }, onClick: handleDeleteAccount, disabled: confirmText !== 'DELETE' || deleting, children: deleting ? '削除中...' : '完全に削除する' }), _jsx("button", { style: s.cancelBtn, onClick: () => {
                                                setShowConfirm(false);
                                                setConfirmText('');
                                            }, children: "\u30AD\u30E3\u30F3\u30BB\u30EB" })] })] }))] })] }) }));
}
