import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
const s = {
    root: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0f0f1a',
    },
    card: {
        background: '#16162a',
        border: '1px solid #2a2a4a',
        borderRadius: 16,
        padding: '40px 36px',
        width: 360,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
    },
    title: { fontSize: 22, fontWeight: 700, color: '#a78bfa', textAlign: 'center' },
    subtitle: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: -12 },
    label: { fontSize: 13, color: '#a0a0c0', marginBottom: 4, display: 'block' },
    input: {
        width: '100%',
        padding: '10px 14px',
        background: '#0f0f1a',
        border: '1px solid #2a2a4a',
        borderRadius: 8,
        color: '#e0e0e0',
        fontSize: 14,
        outline: 'none',
        boxSizing: 'border-box',
    },
    btn: {
        width: '100%',
        padding: '12px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        fontSize: 15,
        fontWeight: 700,
        cursor: 'pointer',
    },
    link: {
        background: 'none',
        border: 'none',
        color: '#a78bfa',
        fontSize: 13,
        cursor: 'pointer',
        textDecoration: 'underline',
        padding: 0,
    },
    errorBox: {
        background: 'rgba(239,68,68,0.12)',
        border: '1px solid #ef4444',
        borderRadius: 8,
        padding: '10px 14px',
        color: '#fca5a5',
        fontSize: 13,
    },
    row: { display: 'flex', justifyContent: 'center', gap: 8, fontSize: 13, color: '#6b7280' },
};
export function LoginScreen({ auth }) {
    const [mode, setMode] = useState('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmCode, setConfirmCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [localError, setLocalError] = useState('');
    const displayError = localError || auth.error;
    const handleLogin = async (e) => {
        e.preventDefault();
        setLocalError('');
        setLoading(true);
        try {
            await auth.login(email, password);
        }
        catch {
            // auth.error に格納済み
        }
        finally {
            setLoading(false);
        }
    };
    const handleRegister = async (e) => {
        e.preventDefault();
        setLocalError('');
        if (password.length < 8) {
            setLocalError('パスワードは8文字以上にしてください');
            return;
        }
        setLoading(true);
        try {
            const result = await auth.register(email, password);
            if (result.needsConfirmation)
                setMode('confirm');
            else
                setMode('login');
        }
        catch {
            // auth.error に格納済み
        }
        finally {
            setLoading(false);
        }
    };
    const handleConfirm = async (e) => {
        e.preventDefault();
        setLocalError('');
        setLoading(true);
        try {
            await auth.confirmRegistration(email, confirmCode);
            setMode('login');
        }
        catch {
            // auth.error に格納済み
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { style: s.root, children: _jsxs("div", { style: s.card, children: [_jsx("div", { style: { fontSize: 48, textAlign: 'center' }, children: "\uD83C\uDFA5" }), _jsx("div", { style: s.title, children: "AI \u30D3\u30C7\u30AA\u4F1A\u8B70" }), _jsxs("div", { style: s.subtitle, children: [mode === 'login' && 'ログインして会議を開始', mode === 'register' && 'アカウントを作成', mode === 'confirm' && `確認コードを ${email} に送信しました`] }), displayError && _jsx("div", { style: s.errorBox, children: displayError }), mode === 'login' && (_jsxs("form", { onSubmit: handleLogin, style: { display: 'flex', flexDirection: 'column', gap: 14 }, children: [_jsxs("div", { children: [_jsx("label", { style: s.label, children: "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9" }), _jsx("input", { style: s.input, type: "email", value: email, onChange: (e) => setEmail(e.target.value), required: true, placeholder: "you@example.com", autoComplete: "email" })] }), _jsxs("div", { children: [_jsx("label", { style: s.label, children: "\u30D1\u30B9\u30EF\u30FC\u30C9" }), _jsx("input", { style: s.input, type: "password", value: password, onChange: (e) => setPassword(e.target.value), required: true, placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", autoComplete: "current-password" })] }), _jsx("button", { style: s.btn, type: "submit", disabled: loading, children: loading ? 'ログイン中...' : 'ログイン' })] })), mode === 'register' && (_jsxs("form", { onSubmit: handleRegister, style: { display: 'flex', flexDirection: 'column', gap: 14 }, children: [_jsxs("div", { children: [_jsx("label", { style: s.label, children: "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9" }), _jsx("input", { style: s.input, type: "email", value: email, onChange: (e) => setEmail(e.target.value), required: true, placeholder: "you@example.com" })] }), _jsxs("div", { children: [_jsx("label", { style: s.label, children: "\u30D1\u30B9\u30EF\u30FC\u30C9 (8\u6587\u5B57\u4EE5\u4E0A\u30FB\u5927\u5C0F\u82F1\u5B57\u30FB\u6570\u5B57)" }), _jsx("input", { style: s.input, type: "password", value: password, onChange: (e) => setPassword(e.target.value), required: true, placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", autoComplete: "new-password" })] }), _jsx("button", { style: s.btn, type: "submit", disabled: loading, children: loading ? '登録中...' : 'アカウント作成' })] })), mode === 'confirm' && (_jsxs("form", { onSubmit: handleConfirm, style: { display: 'flex', flexDirection: 'column', gap: 14 }, children: [_jsxs("div", { children: [_jsx("label", { style: s.label, children: "\u78BA\u8A8D\u30B3\u30FC\u30C9 (6\u6841)" }), _jsx("input", { style: s.input, type: "text", value: confirmCode, onChange: (e) => setConfirmCode(e.target.value), required: true, placeholder: "123456", maxLength: 6, inputMode: "numeric" })] }), _jsx("button", { style: s.btn, type: "submit", disabled: loading, children: loading ? '確認中...' : 'コードを確認' })] })), _jsxs("div", { style: s.row, children: [mode === 'login' && (_jsxs(_Fragment, { children: ["\u30A2\u30AB\u30A6\u30F3\u30C8\u3092\u304A\u6301\u3061\u3067\u306A\u3044\u65B9\u306F", _jsx("button", { style: s.link, onClick: () => setMode('register'), children: "\u65B0\u898F\u767B\u9332" })] })), mode === 'register' && (_jsxs(_Fragment, { children: ["\u65E2\u306B\u30A2\u30AB\u30A6\u30F3\u30C8\u3092\u304A\u6301\u3061\u306E\u65B9\u306F", _jsx("button", { style: s.link, onClick: () => setMode('login'), children: "\u30ED\u30B0\u30A4\u30F3" })] })), mode === 'confirm' && (_jsx("button", { style: s.link, onClick: () => setMode('login'), children: "\u30ED\u30B0\u30A4\u30F3\u306B\u623B\u308B" }))] })] }) }));
}
