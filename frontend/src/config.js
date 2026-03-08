export const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? 'http://localhost:4000';
export const REGION = import.meta.env.VITE_REGION ?? 'ap-northeast-1';
export const COGNITO_USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '';
export const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID ?? '';
