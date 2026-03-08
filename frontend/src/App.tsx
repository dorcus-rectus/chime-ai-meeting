import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { LoginScreen } from './components/LoginScreen';
import { MeetingRoom } from './components/MeetingRoom';
import { UserProfile } from './components/UserProfile';
import { RAGManagement } from './components/RAGManagement';

type View = 'meeting' | 'profile' | 'rag';

export default function App() {
  const auth = useAuth();
  const [view, setView] = useState<View>('meeting');

  if (auth.status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f0f1a', color: '#a78bfa', fontSize: 16 }}>
        読み込み中...
      </div>
    );
  }

  if (auth.status === 'unauthenticated') {
    return <LoginScreen auth={auth} />;
  }

  // MeetingRoom は常にマウントしたまま display で切り替える。
  // アンマウントすると useMeeting の会議セッションが破棄されるため、
  // 設定・RAG管理から戻ったときに会議が終了してしまう問題を防ぐ。
  return (
    <>
      <div style={{ display: view === 'meeting' ? undefined : 'none' }}>
        <MeetingRoom
          auth={auth}
          onOpenProfile={() => setView('profile')}
          onOpenRagManagement={() => setView('rag')}
        />
      </div>

      {view === 'profile' && (
        <UserProfile
          auth={auth}
          onBack={() => setView('meeting')}
        />
      )}

      {view === 'rag' && (
        <RAGManagement
          getIdToken={auth.getIdToken}
          onBack={() => setView('meeting')}
        />
      )}
    </>
  );
}
