import { useState, useCallback, useRef } from 'react';
import { API_URL } from '../config';
import type { ConversationMessage, AIChatResponse, FileAttachment } from '../types';

interface UseAIConversationOptions {
  sessionId: string | null;
  getIdToken: () => Promise<string>;
}

export function useAIConversation({ sessionId, getIdToken }: UseAIConversationOptions) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [aiText, setAiText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // iOS/Android 対応: AudioContext で完全メモリ再生
  // new Audio().play() は iOS では非ユーザージェスチャー時に失敗する
  // AudioContext は一度ユーザージェスチャーでアンロックすれば以降は自由に使える
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  /** マイクボタンや会議開始ボタンのクリック時に呼び出してAudioContextをアンロック */
  const unlockAudio = useCallback(() => {
    if (!audioContextRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AudioCtx = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume();
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch { /* 既に停止中 */ }
      audioSourceRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const playAudio = useCallback(
    (base64Audio: string): Promise<void> => {
      return new Promise((resolve) => {
        stopSpeaking();

        const ctx = audioContextRef.current;
        if (!ctx) {
          // AudioContext 未初期化の場合は無音で継続 (unlockAudio が呼ばれていない)
          console.warn('AudioContext が初期化されていません。unlockAudio() を先に呼んでください。');
          resolve();
          return;
        }

        setIsSpeaking(true);

        // Base64 → Uint8Array → ArrayBuffer
        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        // slice(0) でコピーを作成: decodeAudioData は ArrayBuffer の所有権を取得するため
        const arrayBuffer = bytes.buffer.slice(0);

        // MP3 をデコードして BufferSource で再生
        // AudioContext 経由のため iOS/Android でも非ユーザージェスチャー時に再生可能
        ctx.decodeAudioData(arrayBuffer)
          .then((audioBuffer) => {
            // 再生前に再度停止チェック (decodeAudioData は非同期)
            if (!audioSourceRef.current && !isSpeaking) {
              // stopSpeaking が呼ばれていたらスキップ
            }
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            audioSourceRef.current = source;

            source.onended = () => {
              audioSourceRef.current = null;
              setIsSpeaking(false);
              resolve();
            };
            source.start(0);
          })
          .catch((err) => {
            console.error('音声デコードエラー:', err);
            setIsSpeaking(false);
            resolve();
          });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopSpeaking],
  );

  // 音声書き起こし・チャット入力共通の送信処理
  const sendTranscript = useCallback(
    async (userText: string, frameBase64?: string) => {
      if (!userText.trim() || isProcessing || !sessionId) return;

      setIsProcessing(true);
      setError(null);
      setMessages((prev) => [
        ...prev,
        {
          role: 'user',
          content: userText,
          timestamp: Date.now(),
          hasFrame: !!frameBase64,
        },
      ]);

      try {
        const token = await getIdToken();
        const response = await fetch(`${API_URL}/ai-chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            text: userText,
            sessionId,
            ...(frameBase64 ? { frame: frameBase64 } : {}),
          }),
        });

        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error ?? `HTTP ${response.status}`);
        }

        const data = (await response.json()) as AIChatResponse;
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.text, timestamp: Date.now() },
        ]);
        setAiText(data.text);

        if (data.audio) await playAudio(data.audio);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'AI との通信に失敗しました');
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, sessionId, getIdToken, playAudio],
  );

  /**
   * チャット入力から手動で送信 (添付ファイル対応)
   */
  const sendMessage = useCallback(
    async (text: string, attachment?: FileAttachment) => {
      let frameBase64: string | undefined;
      let effectiveText = text.trim();

      if (attachment) {
        if (attachment.type === 'image') {
          frameBase64 = attachment.base64;
          if (!effectiveText) effectiveText = 'この画像について教えてください';
        } else {
          const snippet = attachment.content.slice(0, 3000);
          effectiveText = effectiveText
            ? `${effectiveText}\n\n[添付: ${attachment.name}]\n${snippet}`
            : `[添付ファイル「${attachment.name}」の内容を分析してください]\n${snippet}`;
        }
      }

      if (!effectiveText) return;
      await sendTranscript(effectiveText, frameBase64);
    },
    [sendTranscript],
  );

  const clearConversation = useCallback(() => {
    stopSpeaking();
    setMessages([]);
    setAiText('');
    setError(null);
  }, [stopSpeaking]);

  return {
    messages,
    aiText,
    isProcessing,
    isSpeaking,
    error,
    unlockAudio,
    sendTranscript,
    sendMessage,
    clearConversation,
    stopSpeaking,
  };
}
