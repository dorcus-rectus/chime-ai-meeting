import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import { COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, REGION } from './config';
import './app.css';
import App from './App';

// Amplify v6 の設定 — Cognito User Pool に接続
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: COGNITO_USER_POOL_ID,
      userPoolClientId: COGNITO_CLIENT_ID,
      signUpVerificationMethod: 'code',
      loginWith: { email: true },
    },
  },
  // Amplify の使用データ収集を無効化 (オプション)
  ...(REGION ? {} : {}),
});

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
