import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { BackgroundBlurVideoFrameProcessor } from 'amazon-chime-sdk-js';
import type { UseAuthReturn } from '../hooks/useAuth';
import { API_URL } from '../config';

const s: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100dvh' as CSSProperties['minHeight'],
    background: '#0f0f1a',
    padding: '16px',
    boxSizing: 'border-box' as CSSProperties['boxSizing'],
  },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 },
  title: { fontSize: 20, fontWeight: 700, color: '#a78bfa' },
  backBtn: {
    background: 'none',
    border: '1px solid #2a2a4a',
    borderRadius: 8,
    color: '#6b7280',
    fontSize: 13,
    cursor: 'pointer',
    padding: '6px 14px',
    marginLeft: 'auto',
  },
  section: {
    background: '#0f0f1a',
    border: '1px solid #2a2a4a',
    borderRadius: 10,
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' },
  infoRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 },
  infoLabel: { color: '#6b7280' },
  infoValue: { color: '#e0e0e0', fontWeight: 500 },
  dangerSection: {
    background: 'rgba(239,68,68,0.06)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 10,
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  dangerTitle: { fontSize: 12, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em' },
  dangerDesc: { fontSize: 12, color: '#9ca3af', lineHeight: 1.6 },
  deleteBtn: {
    width: '100%',
    padding: '11px',
    background: 'transparent',
    color: '#ef4444',
    border: '1px solid #ef4444',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  deleteBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  confirmBox: {
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid #ef4444',
    borderRadius: 10,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  confirmText: { fontSize: 13, color: '#fca5a5', lineHeight: 1.6 },
  confirmInput: {
    width: '100%',
    padding: '9px 12px',
    background: '#0f0f1a',
    border: '1px solid #ef4444',
    borderRadius: 6,
    color: '#e0e0e0',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box' as CSSProperties['boxSizing'],
  },
  confirmRow: { display: 'flex', gap: 8 },
  confirmDeleteBtn: {
    flex: 1,
    padding: '10px',
    background: '#ef4444',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  cancelBtn: {
    flex: 1,
    padding: '10px',
    background: 'transparent',
    color: '#6b7280',
    border: '1px solid #2a2a4a',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
  },
  errorBox: {
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid #ef4444',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#fca5a5',
    fontSize: 13,
  },
  loadingText: { color: '#6b7280', fontSize: 13 },
  // デバイステスト
  deviceRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 },
  deviceLabel: { color: '#6b7280', width: 48, flexShrink: 0 },
  deviceSelect: { flex: 1, background: '#16162a', border: '1px solid #2a2a4a', borderRadius: 6, color: '#e0e0e0', fontSize: 12, padding: '4px 8px', outline: 'none' },
  testVideoWrap: { borderRadius: 8, overflow: 'hidden', background: '#0a0a1a', aspectRatio: '16/9' as CSSProperties['aspectRatio'], width: '100%' },
  testVideo: { width: '100%', height: '100%', objectFit: 'cover' as CSSProperties['objectFit'], transform: 'scaleX(-1)', display: 'block' },
  levelBar: { flex: 1, height: 10, background: '#1a1a2e', borderRadius: 5, overflow: 'hidden' },
  testBtn: { width: '100%', padding: '9px', background: 'transparent', border: '1px solid #a78bfa', borderRadius: 8, color: '#a78bfa', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  stopBtn: { width: '100%', padding: '9px', background: 'transparent', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
};

interface UserInfo {
  userId: string;
  email: string;
  status: string;
  createdAt?: string;
}

interface Props {
  auth: Pick<UseAuthReturn, 'user' | 'logout' | 'getIdToken' | 'deleteAccount' | 'error' | 'changePassword'>;
  onBack: () => void;
}

export function UserProfile({ auth, onBack }: Props) {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [localError, setLocalError] = useState('');

  // ─── パスワード変更 ─────────────────────────────────────────────
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  // ─── 背景ぼかし preference ─────────────────────────────────────
  const [blurPreference, setBlurPreference] = useState<boolean>(() => {
    return localStorage.getItem('blurPreference') === 'on';
  });
  const [blurSupported, setBlurSupported] = useState<boolean | null>(null);

  useEffect(() => {
    BackgroundBlurVideoFrameProcessor.isSupported()
      .then((supported) => setBlurSupported(supported))
      .catch(() => setBlurSupported(false));
  }, []);

  const handleBlurToggle = () => {
    const next = !blurPreference;
    setBlurPreference(next);
    localStorage.setItem('blurPreference', next ? 'on' : 'off');
  };

  // ─── デバイステスト ─────────────────────────────────────────────
  const [testActive, setTestActive] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedCam, setSelectedCam] = useState('');
  const [selectedMic, setSelectedMic] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [testError, setTestError] = useState('');
  const testStreamRef = useRef<MediaStream | null>(null);
  const testVideoRef = useRef<HTMLVideoElement | null>(null);
  const animRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const stopTest = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    testStreamRef.current?.getTracks().forEach((t) => t.stop());
    testStreamRef.current = null;
    if (testVideoRef.current) testVideoRef.current.srcObject = null;
    setMicLevel(0);
    setTestActive(false);
  }, []);

  // アンマウント時にストリームを解放
  useEffect(() => () => stopTest(), [stopTest]);

  const startTest = useCallback(async (camId?: string, micId?: string) => {
    setTestError('');
    // 前のストリームを停止
    testStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    cancelAnimationFrame(animRef.current);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: camId ? { deviceId: { exact: camId } } : true,
        audio: micId ? { deviceId: { exact: micId } } : true,
      });
      testStreamRef.current = stream;

      // デバイス一覧を更新 (権限取得後にラベルが取れる)
      const devices = await navigator.mediaDevices.enumerateDevices();
      const camList = devices.filter((d) => d.kind === 'videoinput');
      const micList = devices.filter((d) => d.kind === 'audioinput');
      setCameras(camList);
      setMics(micList);
      if (!camId && camList.length > 0) setSelectedCam(camList[0].deviceId);
      if (!micId && micList.length > 0) setSelectedMic(micList[0].deviceId);

      // カメラプレビュー
      if (testVideoRef.current) {
        testVideoRef.current.srcObject = stream;
        testVideoRef.current.play().catch(() => {});
      }

      // マイクレベルメーター
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        setMicLevel(Math.min(100, (data.reduce((a, b) => a + b, 0) / data.length) * 2.5));
        animRef.current = requestAnimationFrame(tick);
      };
      animRef.current = requestAnimationFrame(tick);
      setTestActive(true);
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'デバイスへのアクセスに失敗しました');
    }
  }, []);

  const handleCamChange = useCallback(async (deviceId: string) => {
    setSelectedCam(deviceId);
    if (testActive) await startTest(deviceId, selectedMic);
  }, [testActive, selectedMic, startTest]);

  const handleMicChange = useCallback(async (deviceId: string) => {
    setSelectedMic(deviceId);
    if (testActive) await startTest(selectedCam, deviceId);
  }, [testActive, selectedCam, startTest]);

  const handleChangePassword = async () => {
    setPwError('');
    setPwSuccess(false);
    if (!oldPassword || !newPassword || !confirmPassword) {
      setPwError('すべてのフィールドを入力してください');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('新しいパスワードが一致しません');
      return;
    }
    if (newPassword.length < 8) {
      setPwError('パスワードは 8 文字以上で設定してください');
      return;
    }
    setChangingPassword(true);
    try {
      await auth.changePassword(oldPassword, newPassword);
      setPwSuccess(true);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'パスワードの変更に失敗しました';
      setPwError(msg.includes('Incorrect') || msg.includes('NotAuthorizedException')
        ? '現在のパスワードが正しくありません'
        : msg);
    } finally {
      setChangingPassword(false);
    }
  };

  const displayError = localError || auth.error;

  const { getIdToken } = auth;
  useEffect(() => {
    (async () => {
      try {
        const token = await getIdToken();
        const res = await fetch(`${API_URL}/users`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setUserInfo((await res.json()) as UserInfo);
        }
      } catch {
        // 取得失敗時は Amplify のローカル情報を使用
      } finally {
        setLoadingInfo(false);
      }
    })();
  }, [getIdToken]);

  const handleDeleteAccount = async () => {
    if (confirmText !== 'DELETE') return;
    setLocalError('');
    setDeleting(true);
    try {
      await auth.deleteAccount();
    } catch {
      setLocalError('アカウントの削除に失敗しました。もう一度お試しください。');
      setDeleting(false);
    }
  };

  const email = userInfo?.email ?? auth.user?.signInDetails?.loginId ?? '';
  const createdAt = userInfo?.createdAt
    ? new Date(userInfo.createdAt).toLocaleDateString('ja-JP')
    : '—';

  return (
    <div style={s.root}>
      <div className="profile-card">
        {/* ヘッダー */}
        <div style={s.header}>
          <div style={{ fontSize: 28 }}>👤</div>
          <div style={s.title}>アカウント設定</div>
          <button style={s.backBtn} onClick={onBack}>
            戻る
          </button>
        </div>

        {displayError && <div style={s.errorBox}>{displayError}</div>}

        {/* デバイステスト */}
        <div style={s.section}>
          <div style={s.sectionTitle}>デバイステスト</div>
          {testError && <div style={{ ...s.errorBox, fontSize: 12 }}>{testError}</div>}

          {testActive && (
            <>
              {/* カメラプレビュー */}
              <div style={s.testVideoWrap}>
                <video ref={testVideoRef} autoPlay muted playsInline style={s.testVideo} />
              </div>

              {/* カメラ選択 */}
              <div style={s.deviceRow}>
                <span style={s.deviceLabel}>📷 カメラ</span>
                <select
                  style={s.deviceSelect}
                  value={selectedCam}
                  onChange={(e) => void handleCamChange(e.target.value)}
                >
                  {cameras.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `カメラ ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* マイク選択 + レベルメーター */}
              <div style={s.deviceRow}>
                <span style={s.deviceLabel}>🎤 マイク</span>
                <select
                  style={s.deviceSelect}
                  value={selectedMic}
                  onChange={(e) => void handleMicChange(e.target.value)}
                >
                  {mics.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `マイク ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div style={s.deviceRow}>
                <span style={s.deviceLabel}>レベル</span>
                <div style={s.levelBar}>
                  <div style={{ height: '100%', width: `${micLevel}%`, background: micLevel > 70 ? '#ef4444' : '#10b981', transition: 'width 0.08s' }} />
                </div>
                <span style={{ fontSize: 11, color: '#6b7280', width: 32, textAlign: 'right' }}>{Math.round(micLevel)}%</span>
              </div>

              <button style={s.stopBtn} onClick={stopTest}>テスト停止</button>
            </>
          )}

          {!testActive && (
            <button style={s.testBtn} onClick={() => void startTest()}>
              テスト開始 (カメラ・マイクを確認)
            </button>
          )}
        </div>

        {/* 背景ぼかし設定 */}
        <div style={s.section}>
          <div style={s.sectionTitle}>映像設定</div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>背景ぼかし</span>
            {blurSupported === null ? (
              <span style={{ fontSize: 12, color: '#6b7280' }}>確認中...</span>
            ) : blurSupported ? (
              <button
                onClick={handleBlurToggle}
                style={{
                  background: blurPreference ? 'rgba(124,58,237,0.2)' : '#1a1a2e',
                  border: `1px solid ${blurPreference ? '#7c3aed' : '#2a2a4a'}`,
                  borderRadius: 20,
                  color: blurPreference ? '#a78bfa' : '#6b7280',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '4px 14px',
                  cursor: 'pointer',
                }}
              >
                {blurPreference ? '🌫️ ON' : 'OFF'}
              </button>
            ) : (
              <span style={{ fontSize: 12, color: '#6b7280' }}>非対応ブラウザ</span>
            )}
          </div>
          {blurSupported && (
            <div style={{ fontSize: 11, color: '#4a4a7a' }}>
              ※ 次の会議から有効になります
            </div>
          )}
        </div>

        {/* アカウント情報 */}
        <div style={s.section}>
          <div style={s.sectionTitle}>アカウント情報</div>
          {loadingInfo ? (
            <div style={s.loadingText}>読み込み中...</div>
          ) : (
            <>
              <div style={s.infoRow}>
                <span style={s.infoLabel}>メールアドレス</span>
                <span style={s.infoValue}>{email}</span>
              </div>
              <div style={s.infoRow}>
                <span style={s.infoLabel}>登録日</span>
                <span style={s.infoValue}>{createdAt}</span>
              </div>
              <div style={s.infoRow}>
                <span style={s.infoLabel}>ステータス</span>
                <span style={{ ...s.infoValue, color: '#10b981' }}>
                  {userInfo?.status === 'CONFIRMED' ? '確認済み' : userInfo?.status ?? '確認済み'}
                </span>
              </div>
            </>
          )}
        </div>

        {/* パスワード変更 */}
        <div style={s.section}>
          <div style={s.sectionTitle}>パスワード変更</div>
          <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
            8文字以上、大文字・小文字・数字・記号を含めてください
          </div>
          {pwError && <div style={{ ...s.errorBox, fontSize: 12 }}>{pwError}</div>}
          {pwSuccess && (
            <div style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid #10b981', borderRadius: 8, padding: '8px 12px', color: '#6ee7b7', fontSize: 12 }}>
              ✅ パスワードを変更しました
            </div>
          )}
          <input
            style={s.confirmInput}
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            placeholder="現在のパスワード"
            autoComplete="current-password"
          />
          <input
            style={s.confirmInput}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="新しいパスワード"
            autoComplete="new-password"
          />
          <input
            style={s.confirmInput}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="新しいパスワード（確認）"
            autoComplete="new-password"
          />
          <button
            style={{
              width: '100%',
              padding: '10px',
              background: changingPassword ? 'rgba(102,126,234,0.2)' : 'rgba(102,126,234,0.25)',
              color: '#a78bfa',
              border: '1px solid rgba(102,126,234,0.4)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: changingPassword ? 'not-allowed' : 'pointer',
              opacity: changingPassword ? 0.6 : 1,
            }}
            onClick={handleChangePassword}
            disabled={changingPassword}
          >
            {changingPassword ? '変更中...' : 'パスワードを変更する'}
          </button>
        </div>

        {/* ログアウト */}
        <div style={s.section}>
          <div style={s.sectionTitle}>セッション</div>
          <button
            style={{
              width: '100%',
              padding: '10px',
              background: 'transparent',
              color: '#a78bfa',
              border: '1px solid #a78bfa',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            onClick={auth.logout}
          >
            ログアウト
          </button>
        </div>

        {/* アカウント削除 */}
        <div style={s.dangerSection}>
          <div style={s.dangerTitle}>危険な操作</div>
          <div style={s.dangerDesc}>
            アカウントを削除すると、会話履歴・利用記録・RAG ドキュメントを含む
            すべてのデータが完全に削除されます。この操作は元に戻せません。
          </div>

          {!showConfirm ? (
            <button
              style={s.deleteBtn}
              onClick={() => setShowConfirm(true)}
            >
              アカウントを削除する
            </button>
          ) : (
            <div style={s.confirmBox}>
              <div style={s.confirmText}>
                本当に削除しますか？確認のため <strong>DELETE</strong> と入力してください。
              </div>
              <input
                style={s.confirmInput}
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
              <div style={s.confirmRow}>
                <button
                  style={{
                    ...s.confirmDeleteBtn,
                    ...(confirmText !== 'DELETE' || deleting ? s.deleteBtnDisabled : {}),
                  }}
                  onClick={handleDeleteAccount}
                  disabled={confirmText !== 'DELETE' || deleting}
                >
                  {deleting ? '削除中...' : '完全に削除する'}
                </button>
                <button
                  style={s.cancelBtn}
                  onClick={() => {
                    setShowConfirm(false);
                    setConfirmText('');
                  }}
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
