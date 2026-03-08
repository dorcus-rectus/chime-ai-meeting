import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { LoginScreen } from './components/LoginScreen';
import { MeetingRoom } from './components/MeetingRoom';
import { UserProfile } from './components/UserProfile';

export default function App() {
  const auth = useAuth();
  const [showProfile, setShowProfile] = useState(false);

  // 認証状態の確認中
  if (auth.status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f0f1a', color: '#a78bfa', fontSize: 16 }}>
        読み込み中...
      </div>
    );
  }

  // 未認証: ログイン・新規登録・確認コード入力
  if (auth.status === 'unauthenticated') {
    return <LoginScreen auth={auth} />;
  }

  // 認証済み: プロフィール画面
  if (showProfile) {
    return (
      <UserProfile
        auth={auth}
        onBack={() => setShowProfile(false)}
      />
    );
  }

  // 認証済み: 会議室 (プロフィールへの遷移コールバックを渡す)
  return <MeetingRoom auth={auth} onOpenProfile={() => setShowProfile(true)} />;
}
