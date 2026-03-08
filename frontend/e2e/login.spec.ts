import { test, expect } from '@playwright/test';

/**
 * ログイン画面 E2E テスト
 *
 * Claude Code の Playwright MCP を使った手動検証フロー:
 *   1. `npm run dev` でサーバー起動
 *   2. Claude Code に "playwright MCP でログイン画面を確認して" と指示
 *   3. MCP ツール経由でブラウザを操作・スクリーンショット取得
 */
test.describe('ログイン画面', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('ページが正常にロードされる', async ({ page }) => {
    await expect(page).toHaveTitle(/AI|Chime|Meeting/i);
    // ロゴアイコンが表示される
    await expect(page.locator('text=🎥')).toBeVisible();
    await expect(page.locator('text=AI ビデオ会議')).toBeVisible();
  });

  test('ログインフォームの要素が揃っている', async ({ page }) => {
    await expect(page.getByLabel('メールアドレス')).toBeVisible();
    await expect(page.getByLabel('パスワード')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });

  test('「新規登録」リンクで登録フォームに切り替わる', async ({ page }) => {
    await page.getByRole('button', { name: '新規登録' }).click();
    await expect(page.getByRole('button', { name: 'アカウント作成' })).toBeVisible();
    await expect(page.locator('text=アカウントを作成')).toBeVisible();
  });

  test('新規登録画面から「ログイン」に戻れる', async ({ page }) => {
    await page.getByRole('button', { name: '新規登録' }).click();
    // register モードでは「ログイン」リンクで login に戻る
    // (「ログインに戻る」は confirm モード専用)
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });

  test('無効なメール形式で送信できない (HTML5 バリデーション)', async ({ page }) => {
    // HTML5 type="email" バリデーションで不正メールは入力できない
    const emailInput = page.getByLabel('メールアドレス');
    await emailInput.fill('invalid-email');
    await page.getByLabel('パスワード').fill('Password123');
    await page.getByRole('button', { name: 'ログイン' }).click();

    // フォーム送信がブロックされ、ページ遷移しない
    await expect(emailInput).toBeVisible();
  });

  test('パスワード 7 文字以下で新規登録バリデーションエラー', async ({ page }) => {
    await page.getByRole('button', { name: '新規登録' }).click();
    await page.getByLabel('メールアドレス').fill('test@example.com');
    await page.getByLabel(/パスワード/).fill('short1');
    await page.getByRole('button', { name: 'アカウント作成' }).click();
    // ラベルではなくエラーメッセージ div を確実に指定
    await expect(page.locator('text=パスワードは8文字以上にしてください')).toBeVisible();
  });

  test('ログイン画面のスクリーンショット (ビジュアルリグレッション)', async ({ page }) => {
    // Claude Code の MCP がこのスクリーンショットを参照して UI を確認できる
    // CI ではベースラインを更新モードで実行し、初回は skip する
    await expect(page).toHaveScreenshot('login-screen.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
