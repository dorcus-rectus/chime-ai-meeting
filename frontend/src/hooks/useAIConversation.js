import { useState, useCallback, useRef } from 'react';
import { API_URL } from '../config';
export function useAIConversation({ sessionId, getIdToken }) {
    const [messages, setMessages] = useState([]);
    const [aiText, setAiText] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [error, setError] = useState(null);
    const currentAudioRef = useRef(null);
    const stopSpeaking = useCallback(() => {
        if (currentAudioRef.current) {
            currentAudioRef.current.pause();
            currentAudioRef.current = null;
        }
        setIsSpeaking(false);
    }, []);
    const playAudio = useCallback((base64Audio) => {
        return new Promise((resolve) => {
            stopSpeaking();
            const binary = atob(base64Audio);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++)
                bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: 'audio/mp3' });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            currentAudioRef.current = audio;
            setIsSpeaking(true);
            audio.play().catch(console.error);
            const cleanup = () => {
                URL.revokeObjectURL(url);
                currentAudioRef.current = null;
                setIsSpeaking(false);
                resolve();
            };
            audio.onended = cleanup;
            audio.onerror = cleanup;
        });
    }, [stopSpeaking]);
    // 音声書き起こし・チャット入力共通の送信処理
    const sendTranscript = useCallback(async (userText, frameBase64) => {
        if (!userText.trim() || isProcessing || !sessionId)
            return;
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
                const errData = (await response.json().catch(() => ({})));
                throw new Error(errData.error ?? `HTTP ${response.status}`);
            }
            const data = (await response.json());
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: data.text, timestamp: Date.now() },
            ]);
            setAiText(data.text);
            if (data.audio)
                await playAudio(data.audio);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'AI との通信に失敗しました');
        }
        finally {
            setIsProcessing(false);
        }
    }, [isProcessing, sessionId, getIdToken, playAudio]);
    /**
     * チャット入力から手動で送信 (添付ファイル対応)
     * - 画像ファイル: frame フィールド経由で AgentCore Vision に送信
     * - テキストファイル: 本文にインライン展開 (先頭 3000 文字)
     */
    const sendMessage = useCallback(async (text, attachment) => {
        let frameBase64;
        let effectiveText = text.trim();
        if (attachment) {
            if (attachment.type === 'image') {
                frameBase64 = attachment.base64;
                if (!effectiveText)
                    effectiveText = 'この画像について教えてください';
            }
            else {
                // テキストファイル: 内容を本文に付加
                const snippet = attachment.content.slice(0, 3000);
                effectiveText = effectiveText
                    ? `${effectiveText}\n\n[添付: ${attachment.name}]\n${snippet}`
                    : `[添付ファイル「${attachment.name}」の内容を分析してください]\n${snippet}`;
            }
        }
        if (!effectiveText)
            return;
        await sendTranscript(effectiveText, frameBase64);
    }, [sendTranscript]);
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
        sendTranscript,
        sendMessage,
        clearConversation,
        stopSpeaking,
    };
}
