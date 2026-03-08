import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginScreen } from '../../components/LoginScreen';
import type { UseAuthReturn } from '../../hooks/useAuth';

/** LoginScreen が要求するモック auth オブジェクト */
function makeAuth(overrides: Partial<UseAuthReturn> = {}): Pick<
  UseAuthReturn,
  'login' | 'logout' | 'register' | 'confirmRegistration' | 'error'
> {
  return {
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    register: vi.fn().mockResolvedValue({ needsConfirmation: true }),
    confirmRegistration: vi.fn().mockResolvedValue(undefined),
    error: null,
    ...overrides,
  };
}

describe('LoginScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── ログインモード ────────────────────────────────────────────────────────────

  it('初期状態でログインフォームを表示する', () => {
    render(<LoginScreen auth={makeAuth()} />);
    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument();
  });

  it('メール・パスワードを入力してログインを呼び出す', async () => {
    const auth = makeAuth();
    render(<LoginScreen auth={auth} />);

    await userEvent.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
    await userEvent.type(screen.getByLabelText('パスワード'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() => {
      expect(auth.login).toHaveBeenCalledWith('test@example.com', 'Password123');
    });
  });

  it('auth.error が存在するときエラーメッセージを表示する', () => {
    render(<LoginScreen auth={makeAuth({ error: 'ユーザーが見つかりません' })} />);
    expect(screen.getByText('ユーザーが見つかりません')).toBeInTheDocument();
  });

  // ── 新規登録モード ────────────────────────────────────────────────────────────

  it('「新規登録」リンクをクリックすると登録フォームに切り替わる', async () => {
    render(<LoginScreen auth={makeAuth()} />);
    await userEvent.click(screen.getByRole('button', { name: '新規登録' }));
    expect(screen.getByRole('button', { name: 'アカウント作成' })).toBeInTheDocument();
  });

  it('パスワード 7 文字以下でバリデーションエラーを表示する', async () => {
    render(<LoginScreen auth={makeAuth()} />);
    await userEvent.click(screen.getByRole('button', { name: '新規登録' }));
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'new@example.com');
    await userEvent.type(screen.getByLabelText(/パスワード/), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'アカウント作成' }));

    await waitFor(() => {
      // エラーボックス内の「8文字以上」メッセージを確認 (ラベルとの重複を避けるため getAllByText)
      const matches = screen.getAllByText(/8文字以上/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      // 少なくとも1つはエラーボックス内のテキスト
      const errorMsg = matches.find((el) => el.closest('[style*="ef4444"]'));
      expect(errorMsg).toBeTruthy();
    });
  });

  it('登録完了後に確認コード入力画面に遷移する', async () => {
    render(<LoginScreen auth={makeAuth()} />);
    await userEvent.click(screen.getByRole('button', { name: '新規登録' }));
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'new@example.com');
    await userEvent.type(screen.getByLabelText(/パスワード/), 'ValidPass1');
    await userEvent.click(screen.getByRole('button', { name: 'アカウント作成' }));

    await waitFor(() => {
      expect(screen.getByLabelText(/確認コード/)).toBeInTheDocument();
    });
  });

  // ── 確認コードモード ──────────────────────────────────────────────────────────

  it('確認コードを入力して confirmRegistration を呼び出す', async () => {
    const auth = makeAuth();
    render(<LoginScreen auth={auth} />);

    // 新規登録 → 確認コード画面へ
    await userEvent.click(screen.getByRole('button', { name: '新規登録' }));
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'new@example.com');
    await userEvent.type(screen.getByLabelText(/パスワード/), 'ValidPass1');
    await userEvent.click(screen.getByRole('button', { name: 'アカウント作成' }));

    await waitFor(() => screen.getByLabelText(/確認コード/));

    await userEvent.type(screen.getByLabelText(/確認コード/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'コードを確認' }));

    await waitFor(() => {
      expect(auth.confirmRegistration).toHaveBeenCalledWith('new@example.com', '123456');
    });
  });
});
