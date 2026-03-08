import { useState, useEffect, useCallback } from 'react';
import { signIn, signOut, signUp, confirmSignUp, getCurrentUser, fetchAuthSession, } from 'aws-amplify/auth';
import { API_URL } from '../config';
export function useAuth() {
    const [user, setUser] = useState(null);
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState('');
    // アプリ起動時に認証状態を確認
    useEffect(() => {
        getCurrentUser()
            .then((u) => {
            setUser(u);
            setStatus('authenticated');
        })
            .catch(() => {
            setUser(null);
            setStatus('unauthenticated');
        });
    }, []);
    const login = useCallback(async (email, password) => {
        setError('');
        try {
            await signIn({ username: email, password });
            const u = await getCurrentUser();
            setUser(u);
            setStatus('authenticated');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'ログインに失敗しました';
            setError(msg);
            throw err;
        }
    }, []);
    const logout = useCallback(async () => {
        await signOut();
        setUser(null);
        setStatus('unauthenticated');
    }, []);
    const register = useCallback(async (email, password) => {
        setError('');
        try {
            const result = await signUp({
                username: email,
                password,
                options: { userAttributes: { email } },
            });
            return {
                needsConfirmation: result.nextStep.signUpStep === 'CONFIRM_SIGN_UP',
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : '登録に失敗しました';
            setError(msg);
            throw err;
        }
    }, []);
    const confirmRegistration = useCallback(async (email, code) => {
        setError('');
        try {
            await confirmSignUp({ username: email, confirmationCode: code });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : '確認コードが無効です';
            setError(msg);
            throw err;
        }
    }, []);
    // API リクエストに付与する Cognito ID トークンを取得
    const getIdToken = useCallback(async () => {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        if (!token)
            throw new Error('認証セッションが無効です。再ログインしてください。');
        return token;
    }, []);
    // アカウント削除: API 経由で Cognito ユーザーを削除してサインアウト
    const deleteAccount = useCallback(async () => {
        setError('');
        try {
            const token = await getIdToken();
            const response = await fetch(`${API_URL}/users`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) {
                const data = (await response.json().catch(() => ({})));
                throw new Error(data.error ?? 'アカウント削除に失敗しました');
            }
            await signOut();
            setUser(null);
            setStatus('unauthenticated');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'アカウント削除に失敗しました';
            setError(msg);
            throw err;
        }
    }, [getIdToken]);
    return { user, status, error, login, logout, register, confirmRegistration, getIdToken, deleteAccount };
}
