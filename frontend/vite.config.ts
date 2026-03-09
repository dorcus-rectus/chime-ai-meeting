import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // amazon-chime-sdk-js が参照する Node.js グローバル `global` をブラウザ環境で定義
  define: {
    global: 'globalThis',
  },
  server: {
    port: 3000,
    // 開発時は localhost でマイクアクセスが可能
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Chime SDK を分割してビルドサイズを最適化
          'chime-sdk': ['amazon-chime-sdk-js'],
        },
      },
    },
  },
  // amazon-chime-sdk-js が必要とする Node.js ポリフィル
  optimizeDeps: {
    include: ['amazon-chime-sdk-js'],
  },
});
