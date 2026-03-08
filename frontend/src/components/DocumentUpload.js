import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { API_URL } from '../config';
const s = {
    panel: {
        background: '#16162a',
        border: '1px solid #2a2a4a',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
    },
    title: { fontSize: 13, fontWeight: 700, color: '#a0a0c0', letterSpacing: '0.05em' },
    textarea: {
        width: '100%',
        height: 100,
        background: '#0f0f1a',
        border: '1px solid #2a2a4a',
        borderRadius: 8,
        color: '#e0e0e0',
        fontSize: 12,
        padding: '8px 10px',
        resize: 'vertical',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
        outline: 'none',
    },
    input: {
        width: '100%',
        padding: '7px 10px',
        background: '#0f0f1a',
        border: '1px solid #2a2a4a',
        borderRadius: 8,
        color: '#e0e0e0',
        fontSize: 12,
        boxSizing: 'border-box',
        outline: 'none',
    },
    btn: {
        padding: '8px 16px',
        background: 'rgba(102,126,234,0.2)',
        border: '1px solid rgba(102,126,234,0.4)',
        borderRadius: 8,
        color: '#a78bfa',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        alignSelf: 'flex-start',
    },
    status: { fontSize: 11, borderRadius: 6, padding: '6px 10px' },
};
export function DocumentUpload({ getIdToken }) {
    const [content, setContent] = useState('');
    const [source, setSource] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [result, setResult] = useState(null);
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!content.trim())
            return;
        setIsUploading(true);
        setResult(null);
        try {
            const token = await getIdToken();
            const res = await fetch(`${API_URL}/documents`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    content: content.trim(),
                    source: source.trim() || '未設定',
                }),
            });
            const data = (await res.json());
            if (!res.ok)
                throw new Error(data.error ?? 'アップロード失敗');
            setResult({
                type: 'success',
                message: `✅ ${data.chunks} チャンク登録完了 — AI が参照できるようになりました`,
            });
            setContent('');
            setSource('');
        }
        catch (err) {
            setResult({
                type: 'error',
                message: `❌ ${err instanceof Error ? err.message : 'アップロードに失敗しました'}`,
            });
        }
        finally {
            setIsUploading(false);
        }
    };
    return (_jsxs("div", { style: s.panel, children: [_jsx("div", { style: s.title, children: "\uD83D\uDCC4 RAG \u30C9\u30AD\u30E5\u30E1\u30F3\u30C8\u767B\u9332" }), _jsxs("form", { onSubmit: handleSubmit, style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [_jsx("input", { style: s.input, type: "text", value: source, onChange: (e) => setSource(e.target.value), placeholder: "\u51FA\u5178\u540D (\u4F8B: \u793E\u5185FAQ\u3001\u88FD\u54C1\u4ED5\u69D8\u66F8)" }), _jsx("textarea", { style: s.textarea, value: content, onChange: (e) => setContent(e.target.value), placeholder: "AI \u306B\u53C2\u7167\u3055\u305B\u305F\u3044\u30C6\u30AD\u30B9\u30C8\u3092\u8CBC\u308A\u4ED8\u3051\u3066\u304F\u3060\u3055\u3044...", required: true }), _jsx("button", { style: s.btn, type: "submit", disabled: isUploading || !content.trim(), children: isUploading ? '登録中...' : 'インデックス登録' })] }), result && (_jsx("div", { style: {
                    ...s.status,
                    background: result.type === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                    color: result.type === 'success' ? '#6ee7b7' : '#fca5a5',
                    border: `1px solid ${result.type === 'success' ? '#10b981' : '#ef4444'}40`,
                }, children: result.message }))] }));
}
