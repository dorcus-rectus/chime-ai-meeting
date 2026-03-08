import { useState, type CSSProperties, type FormEvent } from 'react';
import type { UseAuthReturn } from '../hooks/useAuth';

type Mode = 'login' | 'register' | 'confirm';

const s: Record<string, CSSProperties> = {
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
    boxSizing: 'border-box' as CSSProperties['boxSizing'],
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

interface Props {
  auth: Pick<UseAuthReturn, 'login' | 'logout' | 'register' | 'confirmRegistration' | 'error'>;
}

export function LoginScreen({ auth }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');

  const displayError = localError || auth.error;

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setLoading(true);
    try {
      await auth.login(email, password);
    } catch {
      // auth.error に格納済み
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (password.length < 8) {
      setLocalError('パスワードは8文字以上にしてください');
      return;
    }
    setLoading(true);
    try {
      const result = await auth.register(email, password);
      if (result.needsConfirmation) setMode('confirm');
      else setMode('login');
    } catch {
      // auth.error に格納済み
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setLoading(true);
    try {
      await auth.confirmRegistration(email, confirmCode);
      setMode('login');
    } catch {
      // auth.error に格納済み
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.root}>
      <div style={s.card}>
        <div style={{ fontSize: 48, textAlign: 'center' }}>🎥</div>
        <div style={s.title}>AI ビデオ会議</div>
        <div style={s.subtitle}>
          {mode === 'login' && 'ログインして会議を開始'}
          {mode === 'register' && 'アカウントを作成'}
          {mode === 'confirm' && `確認コードを ${email} に送信しました`}
        </div>

        {displayError && <div style={s.errorBox}>{displayError}</div>}

        {mode === 'login' && (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label htmlFor="login-email" style={s.label}>メールアドレス</label>
              <input
                id="login-email"
                style={s.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="login-password" style={s.label}>パスワード</label>
              <input
                id="login-password"
                style={s.input}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            <button style={s.btn} type="submit" disabled={loading}>
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label htmlFor="reg-email" style={s.label}>メールアドレス</label>
              <input
                id="reg-email"
                style={s.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="reg-password" style={s.label}>パスワード (8文字以上・大小英字・数字)</label>
              <input
                id="reg-password"
                style={s.input}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
            <button style={s.btn} type="submit" disabled={loading}>
              {loading ? '登録中...' : 'アカウント作成'}
            </button>
          </form>
        )}

        {mode === 'confirm' && (
          <form onSubmit={handleConfirm} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label htmlFor="confirm-code" style={s.label}>確認コード (6桁)</label>
              <input
                id="confirm-code"
                style={s.input}
                type="text"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                required
                placeholder="123456"
                maxLength={6}
                inputMode="numeric"
              />
            </div>
            <button style={s.btn} type="submit" disabled={loading}>
              {loading ? '確認中...' : 'コードを確認'}
            </button>
          </form>
        )}

        <div style={s.row}>
          {mode === 'login' && (
            <>
              アカウントをお持ちでない方は
              <button style={s.link} onClick={() => setMode('register')}>
                新規登録
              </button>
            </>
          )}
          {mode === 'register' && (
            <>
              既にアカウントをお持ちの方は
              <button style={s.link} onClick={() => setMode('login')}>
                ログイン
              </button>
            </>
          )}
          {mode === 'confirm' && (
            <button style={s.link} onClick={() => setMode('login')}>
              ログインに戻る
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
