import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { API_URL } from '../config';

interface RAGDocument {
  source: string;
  chunks: number;
  createdAt: string;
  keys: string[];
  tags?: string[];
}

interface Props {
  getIdToken: () => Promise<string>;
  onBack: () => void;
}

const s: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0f0f1a',
    color: '#e0e0e0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 20px',
    borderBottom: '1px solid #2a2a4a',
    background: '#16162a',
    flexShrink: 0,
  },
  title: { fontSize: 16, fontWeight: 700, color: '#a78bfa', flex: 1 },
  backBtn: {
    background: 'none',
    border: '1px solid #2a2a4a',
    borderRadius: 8,
    color: '#6b7280',
    fontSize: 12,
    cursor: 'pointer',
    padding: '5px 12px',
  },
  body: { flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 },
  card: {
    background: '#16162a',
    border: '1px solid #2a2a4a',
    borderRadius: 12,
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  source: { flex: 1, fontSize: 13, fontWeight: 600, color: '#e0e0e0', wordBreak: 'break-all' as CSSProperties['wordBreak'] },
  meta: { fontSize: 11, color: '#6b7280', marginTop: 3 },
  deleteBtn: {
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8,
    color: '#fca5a5',
    fontSize: 12,
    cursor: 'pointer',
    padding: '5px 12px',
    fontWeight: 600,
    flexShrink: 0,
  },
  emptyMsg: { textAlign: 'center', color: '#4a4a7a', fontSize: 13, marginTop: 40, lineHeight: 2 },
  refreshBtn: {
    background: 'rgba(102,126,234,0.15)',
    border: '1px solid rgba(102,126,234,0.35)',
    borderRadius: 8,
    color: '#a78bfa',
    fontSize: 12,
    cursor: 'pointer',
    padding: '6px 14px',
    fontWeight: 600,
    alignSelf: 'flex-start' as CSSProperties['alignSelf'],
  },
  confirmOverlay: {
    position: 'fixed' as CSSProperties['position'],
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: '0 16px',
  },
  confirmBox: {
    background: '#1a1a2e',
    border: '1px solid #3b3b6a',
    borderRadius: 16,
    padding: '24px 20px',
    maxWidth: 360,
    width: '100%',
  },
  errorBox: {
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid #ef444440',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#fca5a5',
    fontSize: 12,
  },
};

export function RAGManagement({ getIdToken, onBack }: Props) {
  const [documents, setDocuments] = useState<RAGDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RAGDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_URL}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { documents: RAGDocument[]; total: number };
      setDocuments(data.documents);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ドキュメント一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => { void fetchDocuments(); }, [fetchDocuments]);

  const handleDelete = async (doc: RAGDocument) => {
    setIsDeleting(true);
    setError(null);
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_URL}/documents`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ source: doc.source }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmDelete(null);
      await fetchDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  return (
    <div style={s.root}>
      <div style={s.header}>
        <button style={s.backBtn} onClick={onBack}>← 戻る</button>
        <div style={s.title}>🗂️ RAG ドキュメント管理</div>
        <button style={s.refreshBtn} onClick={() => void fetchDocuments()} disabled={isLoading}>
          {isLoading ? '読み込み中...' : '🔄 更新'}
        </button>
      </div>

      <div style={s.body}>
        {error && <div style={s.errorBox}>⚠️ {error}</div>}

        {!isLoading && documents.length === 0 && !error && (
          <div style={s.emptyMsg}>
            登録済みのドキュメントはありません<br />
            会議室のサイドバーから RAG ドキュメントを登録できます
          </div>
        )}

        {documents.length > 0 && (
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            {documents.length} 件のドキュメント / {total} チャンク
          </div>
        )}

        {documents.map((doc) => (
          <div key={doc.source} style={s.card}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.source}>📄 {doc.source}</div>
              <div style={s.meta}>{doc.chunks} チャンク · {formatDate(doc.createdAt)}</div>
              {doc.tags && doc.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                  {doc.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: 'rgba(102,126,234,0.15)', color: '#a78bfa', border: '1px solid rgba(102,126,234,0.3)', fontWeight: 600 }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              style={s.deleteBtn}
              onClick={() => setConfirmDelete(doc)}
            >
              削除
            </button>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <div style={s.confirmOverlay}>
          <div style={s.confirmBox}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fca5a5', marginBottom: 12 }}>
              🗑️ ドキュメントを削除
            </div>
            <div style={{ fontSize: 12, color: '#c0c0d0', marginBottom: 6, lineHeight: 1.6 }}>
              「{confirmDelete.source}」({confirmDelete.chunks} チャンク) を削除します。
              <br />この操作は取り消せません。
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                style={{
                  flex: 1,
                  background: isDeleting ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.85)',
                  border: 'none',
                  borderRadius: 10,
                  color: '#fff',
                  padding: '10px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                }}
                onClick={() => void handleDelete(confirmDelete)}
                disabled={isDeleting}
              >
                {isDeleting ? '削除中...' : '削除する'}
              </button>
              <button
                style={{
                  flex: 1,
                  background: '#2a2a4a',
                  border: '1px solid #3b3b6a',
                  borderRadius: 10,
                  color: '#a0a0c0',
                  padding: '10px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                onClick={() => setConfirmDelete(null)}
                disabled={isDeleting}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
