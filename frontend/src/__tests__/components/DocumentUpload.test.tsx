import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentUpload } from '../../components/DocumentUpload';

describe('DocumentUpload', () => {
  const mockGetIdToken = vi.fn().mockResolvedValue('mock-id-token');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── レンダリング ─────────────────────────────────────────────────────────────

  it('出典名入力・テキストエリア・送信ボタンを表示する', () => {
    render(<DocumentUpload getIdToken={mockGetIdToken} />);
    expect(screen.getByPlaceholderText(/出典名/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/テキストを貼り付け/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'インデックス登録' })).toBeInTheDocument();
  });

  it('初期状態で送信ボタンが無効化されている', () => {
    render(<DocumentUpload getIdToken={mockGetIdToken} />);
    expect(screen.getByRole('button', { name: 'インデックス登録' })).toBeDisabled();
  });

  it('テキストを入力すると送信ボタンが有効化される', async () => {
    render(<DocumentUpload getIdToken={mockGetIdToken} />);
    await userEvent.type(screen.getByPlaceholderText(/テキストを貼り付け/), 'テスト文書の内容');
    expect(screen.getByRole('button', { name: 'インデックス登録' })).toBeEnabled();
  });

  // ── 送信成功 ─────────────────────────────────────────────────────────────────

  it('202 レスポンスで非同期登録成功メッセージを表示する', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ message: '受け付けました', source: 'テスト' }),
    } as Response);

    render(<DocumentUpload getIdToken={mockGetIdToken} />);
    await userEvent.type(screen.getByPlaceholderText(/テキストを貼り付け/), '登録するテキスト');
    await userEvent.click(screen.getByRole('button', { name: 'インデックス登録' }));

    await waitFor(() => {
      expect(screen.getByText(/登録リクエストを受け付けました/)).toBeInTheDocument();
    });
  });

  it('送信後にフォームがリセットされる', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ message: 'ok', source: 'test' }),
    } as Response);

    render(<DocumentUpload getIdToken={mockGetIdToken} />);
    const textarea = screen.getByPlaceholderText(/テキストを貼り付け/);
    await userEvent.type(textarea, '送信後にクリアされるテキスト');
    await userEvent.click(screen.getByRole('button', { name: 'インデックス登録' }));

    await waitFor(() => {
      expect(textarea).toHaveValue('');
    });
  });

  it('Authorization ヘッダーに ID トークンを付与して fetch を呼ぶ', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ message: 'ok' }),
    } as Response);

    render(<DocumentUpload getIdToken={mockGetIdToken} />);
    await userEvent.type(screen.getByPlaceholderText(/テキストを貼り付け/), '内容');
    await userEvent.click(screen.getByRole('button', { name: 'インデックス登録' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer mock-id-token');
  });

  // ── 送信失敗 ─────────────────────────────────────────────────────────────────

  it('API エラー時にエラーメッセージを表示する', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'テキストを解析できませんでした' }),
    } as Response);

    render(<DocumentUpload getIdToken={mockGetIdToken} />);
    await userEvent.type(screen.getByPlaceholderText(/テキストを貼り付け/), '短すぎ');
    await userEvent.click(screen.getByRole('button', { name: 'インデックス登録' }));

    await waitFor(() => {
      expect(screen.getByText(/テキストを解析できませんでした/)).toBeInTheDocument();
    });
  });

  it('fetch 失敗 (ネットワークエラー) 時にエラーメッセージを表示する', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network Error'));

    render(<DocumentUpload getIdToken={mockGetIdToken} />);
    await userEvent.type(screen.getByPlaceholderText(/テキストを貼り付け/), 'テスト内容');
    await userEvent.click(screen.getByRole('button', { name: 'インデックス登録' }));

    await waitFor(() => {
      expect(screen.getByText(/Network Error/)).toBeInTheDocument();
    });
  });
});
