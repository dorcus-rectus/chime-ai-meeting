import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E テスト設定
 *
 * MCP 連携: Claude Code から @playwright/mcp 経由でブラウザを操作し、
 * 不具合の早期発見・ビジュアルリグレッションに活用する。
 * .mcp.json の "playwright" エントリで MCP サーバーを設定済み。
 *
 * テスト実行:
 *   npm run test:e2e          # ヘッドレス実行
 *   npm run test:e2e:ui       # Playwright UI モード
 *   npm run test:e2e:report   # HTML レポートを開く
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,   // Chime SDK / マイクアクセスの競合を避ける
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // マイク・カメラの権限を自動許可 (ブラウザダイアログを抑制)
    permissions: ['camera', 'microphone'],
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // getUserMedia をモックするため Chrome の偽デバイスを使用
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--allow-file-access-from-files',
          ],
        },
      },
    },
  ],

  // テスト実行前に Vite dev server を自動起動
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
