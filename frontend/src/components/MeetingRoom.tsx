import { useRef, useState, useEffect, type CSSProperties, type ChangeEvent, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { useMeeting, DUMMY_DEVICE_ID } from '../hooks/useMeeting';
import { useAIConversation } from '../hooks/useAIConversation';
import { useScreenShare } from '../hooks/useScreenShare';
import { AIParticipant } from './AIParticipant';
import { DocumentUpload } from './DocumentUpload';
import type { ConversationMessage, FileAttachment } from '../types';
import { RESOLUTIONS } from '../types';
import type { UseAuthReturn } from '../hooks/useAuth';

// ─── スタイル ──────────────────────────────────────────────────────────────────
const s: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', background: '#0f0f1a', color: '#e0e0e0', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  title: { fontSize: 16, fontWeight: 700, color: '#a78bfa' },
  statusPill: { fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600 },
  videoArea: { display: 'flex', flex: 1, gap: 10, padding: 10, overflow: 'hidden' },
  videoCard: { flex: 1, background: '#1a1a2e', borderRadius: 10, overflow: 'hidden', position: 'relative', minHeight: 120 },
  screenCard: { flex: 2, background: '#0a0a1a', border: '1px solid #3b82f6', borderRadius: 10, overflow: 'hidden', position: 'relative', minHeight: 0 },
  localVideo: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' },
  screenVideo: { width: '100%', height: '100%', objectFit: 'contain', background: '#0a0a1a' },
  videoLabel: { position: 'absolute', bottom: 8, left: 10, fontSize: 11, background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: 6, color: '#e0e0e0', fontWeight: 600 },
  screenLabel: { position: 'absolute', top: 8, left: 10, fontSize: 11, background: 'rgba(59,130,246,0.8)', padding: '2px 8px', borderRadius: 6, color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 },
  frameIndicator: { position: 'absolute', top: 8, right: 10, fontSize: 10, background: 'rgba(16,185,129,0.8)', padding: '2px 8px', borderRadius: 6, color: '#fff', fontWeight: 600 },
  chatArea: { flex: 1, overflowY: 'auto' as CSSProperties['overflowY'], padding: 10, display: 'flex', flexDirection: 'column', gap: 6 },
  chatEmpty: { color: '#4a4a7a', fontSize: 11, textAlign: 'center', marginTop: 16, lineHeight: 1.8 },
  bubble: { padding: '7px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.5, maxWidth: '92%', wordBreak: 'break-word' as CSSProperties['wordBreak'] },
  sidebarSection: { padding: '8px 10px', borderTop: '1px solid #2a2a4a', flexShrink: 0 },
  controls: { display: 'flex', justifyContent: 'center', gap: 10, padding: '10px 16px', background: '#16162a', borderTop: '1px solid #2a2a4a', flexShrink: 0 },
  btn: { border: 'none', borderRadius: 50, width: 44, height: 44, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  endBtn: { borderRadius: 22, width: 'auto', padding: '0 20px', fontSize: 13, fontWeight: 700 },
  lobby: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 20, background: '#0f0f1a' },
  lobbyTitle: { fontSize: 28, fontWeight: 700, color: '#a78bfa', textAlign: 'center' },
  lobbySubtitle: { color: '#6b7280', fontSize: 14, textAlign: 'center', lineHeight: 1.8, maxWidth: 380 },
  startBtn: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 36px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  logoutBtn: { background: 'none', border: '1px solid #2a2a4a', borderRadius: 8, color: '#6b7280', fontSize: 12, cursor: 'pointer', padding: '4px 12px' },
  errorBox: { background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 16px', color: '#fca5a5', fontSize: 12, maxWidth: 360, textAlign: 'center' },
  ragBadge: { fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(102,126,234,0.2)', color: '#a78bfa', fontWeight: 600, display: 'inline-block', marginTop: 2 },
  frameBadge: { fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(16,185,129,0.2)', color: '#10b981', fontWeight: 600, display: 'inline-block', marginTop: 2, marginLeft: 4 },
  attachBadge: { fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.2)', color: '#60a5fa', fontWeight: 600, display: 'inline-block', marginTop: 2, marginLeft: 4 },
  // チャット入力エリア
  chatInputArea: { padding: '8px', borderTop: '1px solid #2a2a4a', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  chatInputRow: { display: 'flex', gap: 6, alignItems: 'flex-end' },
  chatInput: { flex: 1, background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 8, color: '#e0e0e0', fontSize: 12, padding: '7px 10px', resize: 'none' as CSSProperties['resize'], fontFamily: 'inherit', outline: 'none', maxHeight: 80, overflowY: 'auto' as CSSProperties['overflowY'] },
  iconBtn: { background: '#1e1e3a', border: '1px solid #2a2a4a', borderRadius: 8, color: '#a0a0c0', fontSize: 16, cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtn: { background: 'rgba(102,126,234,0.25)', border: '1px solid rgba(102,126,234,0.4)', borderRadius: 8, color: '#a78bfa', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '6px 12px', flexShrink: 0 },
  attachPreview: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#60a5fa', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, padding: '4px 8px' },
  // カメラ設定パネル
  cameraPanel: { padding: '10px', borderTop: '1px solid #2a2a4a', background: '#13132a', flexShrink: 0 },
  cameraPanelTitle: { fontSize: 11, fontWeight: 700, color: '#a0a0c0', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  select: { width: '100%', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 6, color: '#e0e0e0', fontSize: 11, padding: '5px 8px', outline: 'none', cursor: 'pointer', marginBottom: 6 },
  dummyToggle: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#a0a0c0', cursor: 'pointer' },
};

// ─── チャットバブル ─────────────────────────────────────────────────────────────
function ChatBubble({ msg }: { msg: ConversationMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ alignSelf: isUser ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          ...s.bubble,
          background: isUser ? 'rgba(102,126,234,0.22)' : 'rgba(55,55,80,0.8)',
          borderBottomRightRadius: isUser ? 2 : 8,
          borderBottomLeftRadius: isUser ? 8 : 2,
        }}
      >
        {!isUser && <div style={{ fontSize: 9, color: '#a78bfa', fontWeight: 700, marginBottom: 2 }}>AI</div>}
        {msg.content}
        {isUser && msg.hasFrame && <div style={s.frameBadge}>🖥️ 画面</div>}
      </div>
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  auth: Pick<UseAuthReturn, 'user' | 'logout' | 'getIdToken'>;
  onOpenProfile: () => void;
}

// ─── MeetingRoom ───────────────────────────────────────────────────────────────
export function MeetingRoom({ auth, onOpenProfile }: Props) {
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // チャット入力ステート
  const [chatText, setChatText] = useState('');
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);

  // カメラ設定パネル表示
  const [showCameraSettings, setShowCameraSettings] = useState(false);
  // 無音確認ダイアログ内の編集テキスト
  const [editedText, setEditedText] = useState('');

  // 画面共有フック
  const { isSharing, error: screenShareError, screenVideoRef, startScreenShare, stopScreenShare, captureFrame } = useScreenShare();

  // 会議フック (meetingId を先に取得するため先に呼ぶ)
  // sendTranscript は後続の useAIConversation で定義されるが、
  // onTranscript は ref 経由で参照するため呼び出し時に最新のものが使われる
  const {
    status, meetingId, isMuted, isVideoOn, isDummyCamera,
    videoDevices, selectedDeviceId, resolution,
    localVideoRef, audioRef, errorMessage,
    pendingText, showSilenceConfirm,
    startMeeting, endMeeting, toggleMute, toggleVideo,
    changeCamera, changeResolution,
    startContentShare, stopContentShare,
    confirmSend, cancelSend, confirmContinue,
    pauseTranscription, resumeTranscription,
  } = useMeeting((transcript) => {
    const frame = isSharing ? captureFrame() : null;
    // sendTranscript は下で定義されるが、この callback は呼ばれる時点では定義済み
    sendTranscript(transcript, frame ?? undefined);
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  });

  // AI 会話フック
  const {
    messages, aiText, isProcessing, isSpeaking, error,
    unlockAudio, sendTranscript, sendMessage,
  } = useAIConversation({
    sessionId: meetingId,
    getIdToken: auth.getIdToken,
  });

  // AI 発話中は音声認識を停止し、終了後に再開
  useEffect(() => {
    if (isSpeaking) {
      pauseTranscription();
    } else {
      resumeTranscription();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpeaking]);

  // showSilenceConfirm が true になった瞬間に editedText を pendingText で初期化
  useEffect(() => {
    if (showSilenceConfirm) setEditedText(pendingText);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSilenceConfirm]);

  // pendingText が更新されたらチャットを最下部にスクロール
  useEffect(() => {
    if (pendingText) {
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [pendingText]);

  const handleStartMeeting = async () => {
    // iOS で AudioContext をアンロック (ユーザージェスチャー内で呼ぶ必要がある)
    unlockAudio();
    const token = await auth.getIdToken();
    await startMeeting(token);
  };

  // ミュートボタン: AudioContext のアンロックも兼ねる
  const handleToggleMute = () => {
    unlockAudio();
    toggleMute();
  };

  const handleToggleScreenShare = async () => {
    if (isSharing) {
      stopScreenShare();
      stopContentShare();
    } else {
      const stream = await startScreenShare();
      if (stream) await startContentShare(stream);
    }
  };

  // ─── ファイル添付 ───────────────────────────────────────────────────────────
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const isImage = file.type.startsWith('image/');
    const isText = file.type.startsWith('text/') || /\.(txt|md|csv|log)$/i.test(file.name);

    if (isImage) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        setAttachment({ type: 'image', base64, mimeType: file.type, name: file.name });
      };
      reader.readAsDataURL(file);
    } else if (isText) {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachment({ type: 'text', content: reader.result as string, name: file.name });
      };
      reader.readAsText(file);
    } else {
      alert('対応ファイル形式: 画像 (JPG / PNG / GIF / WebP)、テキスト (TXT / MD / CSV)');
    }
  };

  // ─── チャット送信 ───────────────────────────────────────────────────────────
  const handleSendChat = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!chatText.trim() && !attachment) return;
    if (isProcessing) return;

    const text = chatText.trim();
    const att = attachment ?? undefined;
    setChatText('');
    setAttachment(null);

    await sendMessage(text, att);
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleChatKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendChat();
    }
  };

  // ─── カメラ設定 ─────────────────────────────────────────────────────────────
  const handleCameraChange = async (deviceId: string) => {
    await changeCamera(deviceId);
  };

  const handleResolutionChange = async (idx: number) => {
    const res = RESOLUTIONS[idx];
    if (res) await changeResolution(res.width, res.height);
  };

  const currentResolutionIdx = RESOLUTIONS.findIndex(
    (r) => r.width === resolution.width && r.height === resolution.height,
  );

  // ─── ステータス情報 ─────────────────────────────────────────────────────────
  const statusInfo =
    status === 'connecting'
      ? { text: '接続中...', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
      : { text: '会議中', color: '#10b981', bg: 'rgba(16,185,129,0.12)' };

  const userEmail = auth.user?.signInDetails?.loginId ?? '';

  // ─── ロビー ─────────────────────────────────────────────────────────────────
  if (status === 'idle' || status === 'error') {
    return (
      <div className="lobby-screen">
        <div style={{ fontSize: 56 }}>🎥</div>
        <div style={s.lobbyTitle}>AI ビデオ会議</div>
        <div style={s.lobbySubtitle}>
          Amazon Chime SDK × Bedrock AgentCore で会議室に AI が参加します
          <br />
          <span style={{ color: '#a78bfa', fontSize: 12 }}>日本語で話しかけると AI が応答します</span>
          <br />
          <span style={{ color: '#3b82f6', fontSize: 12 }}>🖥️ 画面共有中に話しかけると AI が画面を解析します</span>
        </div>
        {(errorMessage || error) && <div style={s.errorBox}>{errorMessage || error}</div>}
        <button style={s.startBtn} onClick={handleStartMeeting}>
          会議を開始する
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>{userEmail} でログイン中</span>
          <button style={s.logoutBtn} onClick={onOpenProfile}>アカウント設定</button>
          <button style={s.logoutBtn} onClick={auth.logout}>ログアウト</button>
        </div>
      </div>
    );
  }

  if (status === 'ended') {
    return (
      <div className="lobby-screen">
        <div style={{ fontSize: 56 }}>👋</div>
        <div style={s.lobbyTitle}>会議が終了しました</div>
        <button style={s.startBtn} onClick={handleStartMeeting}>もう一度参加する</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button style={s.logoutBtn} onClick={onOpenProfile}>アカウント設定</button>
          <button style={s.logoutBtn} onClick={auth.logout}>ログアウト</button>
        </div>
      </div>
    );
  }

  // ─── 会議室メイン ───────────────────────────────────────────────────────────
  return (
    <div className="screen-full" style={s.root}>
      {/* ヘッダー */}
      <div className="meeting-header">
        <div style={s.title}>🎥 AI ビデオ会議</div>
        <div className="meeting-header-right">
          <div className="hide-tablet" style={{ fontSize: 12, color: '#6b7280', background: '#0f0f1a', padding: '4px 10px', borderRadius: 20, border: '1px solid #2a2a4a' }}>
            {userEmail}
          </div>
          <div style={{ ...s.statusPill, color: statusInfo.color, background: statusInfo.bg, border: `1px solid ${statusInfo.color}30` }}>
            {statusInfo.text}
          </div>
          {isSharing && (
            <div className="hide-tablet" style={{ ...s.statusPill, color: '#3b82f6', background: 'rgba(59,130,246,0.12)', border: '1px solid #3b82f630', fontSize: 11, padding: '3px 10px' }}>
              🖥️ 画面共有中
            </div>
          )}
          <button style={s.logoutBtn} onClick={onOpenProfile}>設定</button>
          <button style={s.logoutBtn} onClick={auth.logout}>ログアウト</button>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="meeting-body">
        {/* ビデオエリア */}
        <div style={s.videoArea}>
          {/* AI アバター (aibot.mp4 + AR オーバーレイ) */}
          <div style={s.videoCard}>
            <AIParticipant isSpeaking={isSpeaking} isProcessing={isProcessing} aiText={aiText} />
          </div>

          {/* 画面共有プレビュー: video 要素は常にマウント (ref を確保するため)、表示は isSharing で制御 */}
          <div style={{ ...s.screenCard, display: isSharing ? undefined : 'none' }}>
            <video ref={screenVideoRef as RefObject<HTMLVideoElement>} autoPlay muted playsInline style={s.screenVideo} />
            <div style={s.screenLabel}><span>🖥️ 画面共有</span></div>
            {isProcessing && <div style={s.frameIndicator}>AI 解析中...</div>}
          </div>

          {/* ローカルカメラ */}
          <div style={s.videoCard}>
            <video
              ref={localVideoRef as RefObject<HTMLVideoElement>}
              autoPlay
              muted
              playsInline
              style={{ ...s.localVideo, display: isVideoOn ? 'block' : 'none', transform: isDummyCamera ? 'none' : 'scaleX(-1)' }}
            />
            {!isVideoOn && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 40 }}>
                👤
              </div>
            )}
            <div style={s.videoLabel}>
              あなた {isMuted && '🔇'} {isDummyCamera && '(ダミー)'}
            </div>
          </div>
        </div>

        {/* サイドバー */}
        <div className="meeting-sidebar">
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #2a2a4a', fontSize: 11, fontWeight: 600, color: '#a0a0c0' }}>
            会話履歴 (音声 + チャット)
          </div>

          {/* チャットメッセージ一覧 */}
          <div style={s.chatArea}>
            {messages.length === 0 && !pendingText ? (
              <div style={s.chatEmpty}>
                話しかけるか、下のチャットに入力してください<br />
                📎 ファイルを添付して AI に分析させることもできます
                {isSharing && <><br /><span style={{ color: '#3b82f6' }}>🖥️ 画面共有中は画面を解析します</span></>}
              </div>
            ) : (
              messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)
            )}
            {/* 音声認識中のペンディングテキスト */}
            {pendingText && !showSilenceConfirm && (
              <div style={{ alignSelf: 'flex-end' }}>
                <div style={{ ...s.bubble, background: 'rgba(102,126,234,0.12)', borderBottomRightRadius: 2, color: '#c0c0e0', fontSize: 12, fontStyle: 'italic', border: '1px dashed rgba(102,126,234,0.3)' }}>
                  🎤 {pendingText}
                </div>
              </div>
            )}
            {isProcessing && (
              <div style={{ alignSelf: 'flex-start' }}>
                <div style={{ ...s.bubble, background: 'rgba(55,55,80,0.8)', color: '#a78bfa', fontSize: 11 }}>
                  {isSharing ? '🖥️ 画面を解析中...' : 'AI が考え中...'}
                </div>
              </div>
            )}
            {isSpeaking && (
              <div style={{ alignSelf: 'flex-start' }}>
                <div style={{ ...s.bubble, background: 'rgba(16,185,129,0.1)', color: '#10b981', fontSize: 11 }}>
                  🔊 AI が話しています...
                </div>
              </div>
            )}
            {(error || screenShareError) && (
              <div style={{ ...s.bubble, background: 'rgba(239,68,68,0.12)', color: '#fca5a5', fontSize: 11, alignSelf: 'center' }}>
                ⚠️ {error || screenShareError}
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* チャット入力エリア */}
          <div style={s.chatInputArea}>
            {/* 添付プレビュー */}
            {attachment && (
              <div style={s.attachPreview}>
                <span>{attachment.type === 'image' ? '🖼️' : '📄'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {attachment.name}
                </span>
                <button
                  onClick={() => setAttachment(null)}
                  style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: 0 }}
                >
                  ✕
                </button>
              </div>
            )}

            <form onSubmit={handleSendChat} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={s.chatInputRow}>
                {/* ファイル添付ボタン */}
                <button
                  type="button"
                  style={s.iconBtn}
                  title="ファイルを添付 (画像・テキスト)"
                  onClick={() => fileInputRef.current?.click()}
                >
                  📎
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,text/*,.txt,.md,.csv,.log"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />

                {/* テキスト入力 */}
                <textarea
                  style={s.chatInput}
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  placeholder="メッセージを入力… (Enter で送信 / Shift+Enter で改行)"
                  rows={1}
                />

                {/* 送信ボタン */}
                <button
                  type="submit"
                  style={{
                    ...s.sendBtn,
                    opacity: (!chatText.trim() && !attachment) || isProcessing ? 0.4 : 1,
                    cursor: (!chatText.trim() && !attachment) || isProcessing ? 'not-allowed' : 'pointer',
                  }}
                  disabled={(!chatText.trim() && !attachment) || isProcessing}
                >
                  送信
                </button>
              </div>
            </form>
          </div>

          {/* RAG ドキュメント登録 */}
          <div style={s.sidebarSection}>
            <DocumentUpload getIdToken={auth.getIdToken} />
          </div>
        </div>
      </div>

      {/* カメラ設定パネル (展開時) */}
      {showCameraSettings && (
        <div style={s.cameraPanel}>
          <div style={s.cameraPanelTitle}>
            <span>⚙️ カメラ設定</span>
            <button
              onClick={() => setShowCameraSettings(false)}
              style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14 }}
            >
              ✕
            </button>
          </div>

          {/* カメラデバイス選択 */}
          <select
            style={s.select}
            value={isDummyCamera ? DUMMY_DEVICE_ID : selectedDeviceId}
            onChange={(e) => void handleCameraChange(e.target.value)}
          >
            {videoDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `カメラ ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
            <option value={DUMMY_DEVICE_ID}>ダミーカメラ (カメラ無効)</option>
          </select>

          {/* 解像度選択 */}
          <select
            style={s.select}
            value={currentResolutionIdx >= 0 ? currentResolutionIdx : 1}
            onChange={(e) => void handleResolutionChange(Number(e.target.value))}
          >
            {RESOLUTIONS.map((r, i) => (
              <option key={i} value={i}>{r.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* コントロールバー */}
      <div style={s.controls}>
        <button
          style={{ ...s.btn, background: isMuted ? '#ef4444' : '#2a2a4a', color: '#fff' }}
          onClick={handleToggleMute}
          title={isMuted ? 'ミュート解除' : 'ミュート'}
        >
          {isMuted ? '🔇' : '🎤'}
        </button>
        <button
          style={{ ...s.btn, background: isVideoOn ? '#2a2a4a' : '#ef4444', color: '#fff' }}
          onClick={toggleVideo}
          title={isVideoOn ? 'カメラ OFF' : 'カメラ ON'}
        >
          {isVideoOn ? '📷' : '🚫'}
        </button>
        <button
          style={{ ...s.btn, background: isSharing ? '#3b82f6' : '#2a2a4a', color: '#fff' }}
          onClick={handleToggleScreenShare}
          title={isSharing ? '画面共有を停止' : '画面を共有して AI に解析させる'}
        >
          🖥️
        </button>
        <button
          style={{ ...s.btn, background: showCameraSettings ? '#a78bfa' : '#2a2a4a', color: '#fff' }}
          onClick={() => setShowCameraSettings((p) => !p)}
          title="カメラ設定 (デバイス・解像度・ダミーカメラ)"
        >
          ⚙️
        </button>
        <button
          style={{ ...s.btn, ...s.endBtn, background: '#dc2626', color: '#fff' }}
          onClick={endMeeting}
        >
          📵 退出
        </button>
      </div>

      <audio ref={audioRef as RefObject<HTMLAudioElement>} style={{ display: 'none' }} />

      {/* ─── 3秒無音: 送信確認ダイアログ ───────────────────────────────────────── */}
      {showSilenceConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 16px',
        }}>
          <div style={{
            background: '#1a1a2e', border: '1px solid #3b3b6a',
            borderRadius: 16, padding: '24px 20px', maxWidth: 400, width: '100%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa', marginBottom: 10 }}>
              🎤 3秒間の無音を検知しました
            </div>
            {/* 認識テキスト: 編集可能 */}
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              style={{
                width: '100%', background: 'rgba(102,126,234,0.08)',
                border: '1px solid rgba(102,126,234,0.35)',
                borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#e0e0e0',
                lineHeight: 1.6, marginBottom: 16, minHeight: 80, maxHeight: 160,
                resize: 'vertical', fontFamily: 'inherit', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => confirmSend(editedText)}
                disabled={!editedText.trim()}
                style={{
                  flex: 1, minWidth: 100,
                  background: editedText.trim()
                    ? 'linear-gradient(135deg, #667eea, #764ba2)'
                    : 'rgba(102,126,234,0.2)',
                  color: '#fff', border: 'none', borderRadius: 10,
                  padding: '11px 0', fontSize: 14, fontWeight: 700,
                  cursor: editedText.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                AIに送る
              </button>
              <button
                onClick={confirmContinue}
                style={{
                  flex: 1, minWidth: 100, background: '#2a2a4a', color: '#a0a0c0',
                  border: '1px solid #3b3b6a', borderRadius: 10,
                  padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                続けて話す
              </button>
              <button
                onClick={cancelSend}
                style={{
                  background: 'rgba(239,68,68,0.12)', color: '#fca5a5',
                  border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10,
                  padding: '11px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                破棄
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
