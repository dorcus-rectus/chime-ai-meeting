import { jsx as _jsx } from "react/jsx-runtime";
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
        return (_jsx("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f0f1a', color: '#a78bfa', fontSize: 16 }, children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." }));
    }
    // 未認証: ログイン・新規登録・確認コード入力
    if (auth.status === 'unauthenticated') {
        return _jsx(LoginScreen, { auth: auth });
    }
    // 認証済み: プロフィール画面
    if (showProfile) {
        return (_jsx(UserProfile, { auth: auth, onBack: () => setShowProfile(false) }));
    }
    // 認証済み: 会議室 (プロフィールへの遷移コールバックを渡す)
    return _jsx(MeetingRoom, { auth: auth, onOpenProfile: () => setShowProfile(true) });
}
