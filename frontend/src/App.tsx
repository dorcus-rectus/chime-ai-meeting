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

  if (view === 'profile') {
    return (
      <UserProfile
        auth={auth}
        onBack={() => setView('meeting')}
      />
    );
  }

  if (view === 'rag') {
    return (
      <RAGManagement
        getIdToken={auth.getIdToken}
        onBack={() => setView('meeting')}
      />
    );
  }

  return (
    <MeetingRoom
      auth={auth}
      onOpenProfile={() => setView('profile')}
      onOpenRagManagement={() => setView('rag')}
    />
  );
}
