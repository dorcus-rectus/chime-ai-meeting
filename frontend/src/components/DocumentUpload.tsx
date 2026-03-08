import { useState, type CSSProperties, type FormEvent } from 'react';
import { API_URL } from '../config';

interface Props {
  getIdToken: () => Promise<string>;
}

const s: Record<string, CSSProperties> = {
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
    resize: 'vertical' as CSSProperties['resize'],
    fontFamily: 'inherit',
    boxSizing: 'border-box' as CSSProperties['boxSizing'],
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
    boxSizing: 'border-box' as CSSProperties['boxSizing'],
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
    alignSelf: 'flex-start' as CSSProperties['alignSelf'],
  },
  status: { fontSize: 11, borderRadius: 6, padding: '6px 10px' },
};

export function DocumentUpload({ getIdToken }: Props) {
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

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

      const data = (await res.json()) as { message?: string; chunks?: number; error?: string };

      if (!res.ok) throw new Error(data.error ?? 'アップロード失敗');

      setResult({
        type: 'success',
        // 202: 非同期処理 (SQS キューイング済み) / 200: 同期完了 (旧フロー互換)
        message: res.status === 202
          ? `✅ 登録リクエストを受け付けました — 数秒後に AI が参照できるようになります`
          : `✅ ${data.chunks ?? '?'} チャンク登録完了 — AI が参照できるようになりました`,
      });
      setContent('');
      setSource('');
    } catch (err) {
      setResult({
        type: 'error',
        message: `❌ ${err instanceof Error ? err.message : 'アップロードに失敗しました'}`,
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div style={s.panel}>
      <div style={s.title}>📄 RAG ドキュメント登録</div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          style={s.input}
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="出典名 (例: 社内FAQ、製品仕様書)"
        />
        <textarea
          style={s.textarea}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="AI に参照させたいテキストを貼り付けてください..."
          required
        />
        <button style={s.btn} type="submit" disabled={isUploading || !content.trim()}>
          {isUploading ? '登録中...' : 'インデックス登録'}
        </button>
      </form>
      {result && (
        <div
          style={{
            ...s.status,
            background:
              result.type === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
            color: result.type === 'success' ? '#6ee7b7' : '#fca5a5',
            border: `1px solid ${result.type === 'success' ? '#10b981' : '#ef4444'}40`,
          }}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}
