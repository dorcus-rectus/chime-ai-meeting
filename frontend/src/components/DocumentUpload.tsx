import { useState, useRef, type CSSProperties, type FormEvent, type ChangeEvent } from 'react';
import { API_URL } from '../config';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

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
    height: 80,
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
  fileBtn: {
    padding: '6px 12px',
    background: 'rgba(59,130,246,0.15)',
    border: '1px solid rgba(59,130,246,0.35)',
    borderRadius: 8,
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start' as CSSProperties['alignSelf'],
  },
  status: { fontSize: 11, borderRadius: 6, padding: '6px 10px' },
  row: { display: 'flex', gap: 8, alignItems: 'center' },
};

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    if (pageText.trim()) pages.push(pageText.trim());
  }
  return pages.join('\n\n');
}

export function DocumentUpload({ getIdToken }: Props) {
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!source.trim()) setSource(file.name.replace(/\.[^.]+$/, ''));

    const isText = file.type.startsWith('text/') || /\.(txt|md|csv|log)$/i.test(file.name);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

    if (isText) {
      const text = await file.text();
      setContent((prev) => (prev ? `${prev}\n\n${text}` : text));
    } else if (isPdf) {
      setIsExtracting(true);
      try {
        const text = await extractPdfText(file);
        setContent((prev) => (prev ? `${prev}\n\n${text}` : text));
      } catch {
        setResult({ type: 'error', message: '❌ PDF のテキスト抽出に失敗しました' });
      } finally {
        setIsExtracting(false);
      }
    } else {
      setResult({ type: 'error', message: '❌ 対応形式: TXT / MD / CSV / PDF' });
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    // クライアントサイドのサイズバリデーション (250KB 上限)
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const sizeBytes = new TextEncoder().encode(
      JSON.stringify({ content: content.trim(), source: source.trim() || '未設定', tags, isPublic }),
    ).length;
    if (sizeBytes > 250_000) {
      setResult({
        type: 'error',
        message: `❌ テキストが大きすぎます（現在約 ${Math.round(sizeBytes / 1024)} KB / 上限 250 KB）。分割して登録してください`,
      });
      return;
    }

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
          ...(tags.length > 0 ? { tags } : {}),
          isPublic,
        }),
      });

      const data = (await res.json()) as { message?: string; chunks?: number; error?: string };

      if (!res.ok) throw new Error(data.error ?? 'アップロード失敗');

      setResult({
        type: 'success',
        message: res.status === 202
          ? `✅ 登録リクエストを受け付けました — 数秒後に AI が参照できるようになります`
          : `✅ ${data.chunks ?? '?'} チャンク登録完了 — AI が参照できるようになりました`,
      });
      setContent('');
      setSource('');
      setTagsInput('');
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
        <input
          style={s.input}
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="タグ (カンマ区切り、例: 技術,FAQ,2024)"
        />
        <div style={s.row}>
          <button
            type="button"
            style={{ ...s.fileBtn, opacity: isExtracting ? 0.6 : 1 }}
            onClick={() => fileInputRef.current?.click()}
            disabled={isExtracting}
          >
            {isExtracting ? '⏳ 抽出中...' : '📁 ファイル読み込み'}
          </button>
          <span style={{ fontSize: 10, color: '#4a4a7a' }}>TXT / MD / CSV / PDF</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.csv,.log,.pdf,text/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <textarea
          style={s.textarea}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="AI に参照させたいテキストを貼り付けるか、ファイルから読み込んでください..."
          required
        />
        <span style={{ fontSize: 10, color: '#4a4a7a' }}>最大 250 KB</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#a0a0c0', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          公開する（全ユーザーの AI が参照可能）
        </label>
        <button style={s.btn} type="submit" disabled={isUploading || isExtracting || !content.trim()}>
          {isUploading ? '登録中...' : 'インデックス登録'}
        </button>
      </form>
      {result && (
        <div
          style={{
            ...s.status,
            background: result.type === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
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
