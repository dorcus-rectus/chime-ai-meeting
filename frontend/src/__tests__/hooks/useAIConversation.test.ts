import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAIConversation } from '../../hooks/useAIConversation';

const mockGetIdToken = vi.fn().mockResolvedValue('mock-token');

describe('useAIConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 初期状態 ─────────────────────────────────────────────────────────────────

  it('初期状態が正しい', () => {
    const { result } = renderHook(() =>
      useAIConversation({ sessionId: 'session-1', getIdToken: mockGetIdToken }),
    );
    expect(result.current.messages).toEqual([]);
    expect(result.current.aiText).toBe('');
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ── sessionId が null の場合 ──────────────────────────────────────────────────

  it('sessionId が null のとき sendTranscript は何もしない', async () => {
    global.fetch = vi.fn();
    const { result } = renderHook(() =>
      useAIConversation({ sessionId: null, getIdToken: mockGetIdToken }),
    );

    await act(async () => {
      await result.current.sendTranscript('テスト');
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it('テキストが空のとき sendTranscript は何もしない', async () => {
    global.fetch = vi.fn();
    const { result } = renderHook(() =>
      useAIConversation({ sessionId: 'session-1', getIdToken: mockGetIdToken }),
    );

    await act(async () => {
      await result.current.sendTranscript('   ');
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── 送信成功 ─────────────────────────────────────────────────────────────────

  it('sendTranscript が成功時にメッセージを追加する', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'AI の返答です', audio: null }),
    } as Response);

    const { result } = renderHook(() =>
      useAIConversation({ sessionId: 'session-1', getIdToken: mockGetIdToken }),
    );

    await act(async () => {
      await result.current.sendTranscript('こんにちは');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'こんにちは' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', content: 'AI の返答です' });
    expect(result.current.aiText).toBe('AI の返答です');
    expect(result.current.isProcessing).toBe(false);
  });

  it('送信中は isProcessing=true になる', async () => {
    let resolvePromise!: (v: unknown) => void;
    global.fetch = vi.fn().mockReturnValueOnce(
      new Promise((resolve) => { resolvePromise = resolve; }),
    );

    const { result } = renderHook(() =>
      useAIConversation({ sessionId: 'session-1', getIdToken: mockGetIdToken }),
    );

    act(() => {
      void result.current.sendTranscript('テスト');
    });

    // fetch が保留中のとき isProcessing=true
    expect(result.current.isProcessing).toBe(true);

    // fetch を完了させる
    await act(async () => {
      resolvePromise({
        ok: true,
        json: async () => ({ text: '応答', audio: null }),
      });
    });

    expect(result.current.isProcessing).toBe(false);
  });

  // ── 送信失敗 ─────────────────────────────────────────────────────────────────

  it('API エラー時に error をセットする', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'サーバーエラー' }),
    } as Response);

    const { result } = renderHook(() =>
      useAIConversation({ sessionId: 'session-1', getIdToken: mockGetIdToken }),
    );

    await act(async () => {
      await result.current.sendTranscript('テスト');
    });

    expect(result.current.error).toBe('サーバーエラー');
    expect(result.current.isProcessing).toBe(false);
  });

  // ── clearConversation ────────────────────────────────────────────────────────

  it('clearConversation でメッセージとエラーをリセットする', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: '返答', audio: null }),
    } as Response);

    const { result } = renderHook(() =>
      useAIConversation({ sessionId: 'session-1', getIdToken: mockGetIdToken }),
    );

    await act(async () => {
      await result.current.sendTranscript('こんにちは');
    });
    expect(result.current.messages).toHaveLength(2);

    act(() => {
      result.current.clearConversation();
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.aiText).toBe('');
    expect(result.current.error).toBeNull();
  });

  // ── sendMessage (添付ファイル) ────────────────────────────────────────────────

  it('テキスト添付ファイルを本文に付加して送信する', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'ok', audio: null }),
    } as Response);

    const { result } = renderHook(() =>
      useAIConversation({ sessionId: 'session-1', getIdToken: mockGetIdToken }),
    );

    await act(async () => {
      await result.current.sendMessage('分析して', {
        type: 'text',
        content: 'ファイルの内容です',
        name: 'test.txt',
      });
    });

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as { text: string };
    expect(body.text).toContain('分析して');
    expect(body.text).toContain('ファイルの内容です');
  });
});
