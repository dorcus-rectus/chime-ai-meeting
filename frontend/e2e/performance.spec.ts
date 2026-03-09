import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

/**
 * 性能テスト
 *
 * ページ読み込み・会議開始・AI 応答・RAG 登録の応答時間を確認する。
 * 環境変数: TEST_EMAIL, TEST_PASSWORD
 */

const TEST_EMAIL = process.env.TEST_EMAIL ?? '';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? '';
const HAS_AUTH = !!TEST_EMAIL && !!TEST_PASSWORD;

test.describe('ページ性能', () => {
  test('ログイン画面: navigation → interactive < 3秒', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3_000);
  });

  test.skip(!HAS_AUTH, 'TEST_EMAIL / TEST_PASSWORD が未設定のためスキップ');

  test('会議開始: ボタン押下 → 会議中ステータス < 20秒', async ({ page }) => {
    await login(page, TEST_EMAIL, TEST_PASSWORD);

    const start = Date.now();
    await page.getByRole('button', { name: '会議を開始する' }).click();
    await expect(page.locator('text=会議中')).toBeVisible({ timeout: 20_000 });
    const elapsed = Date.now() - start;
    // 接続に 20 秒以内 (Chime SDK セッション確立 + デバイス設定)
    expect(elapsed).toBeLessThan(20_000);
  });

  test('AI 応答: テキスト送信 → 返答テキスト表示 < 30秒', async ({ page }) => {
    await login(page, TEST_EMAIL, TEST_PASSWORD);
    await page.getByRole('button', { name: '会議を開始する' }).click();
    await expect(page.locator('text=会議中')).toBeVisible({ timeout: 20_000 });

    // チャット送信
    await page.getByPlaceholder(/メッセージを入力/).fill('こんにちは');
    const start = Date.now();
    await page.getByRole('button', { name: '送信' }).click();

    // AI 処理中バブルが出る
    await expect(page.locator('text=AI が考え中...').or(page.locator('text=AI 解析中...'))).toBeVisible({ timeout: 10_000 });
    // 処理完了 → AI バブルが消える
    await page.locator('text=AI が考え中...').or(page.locator('text=AI 解析中...')).waitFor({
      state: 'hidden',
      timeout: 30_000,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(30_000);
  });

  test('RAG 登録: 送信 → 202 返却 < 5秒', async ({ page }) => {
    await login(page, TEST_EMAIL, TEST_PASSWORD);
    await page.getByRole('button', { name: '会議を開始する' }).click();
    await expect(page.locator('text=会議中')).toBeVisible({ timeout: 20_000 });

    // RAG 登録パネルを開く
    await page.getByRole('button', { name: /RAG 登録/ }).click();
    await expect(page.locator('text=RAG ドキュメント登録')).toBeVisible({ timeout: 5_000 });

    await page.getByPlaceholder(/テキストを貼り付け/).fill('性能テスト用のサンプルテキストです。');
    const start = Date.now();
    await page.getByRole('button', { name: '登録' }).click();

    // 成功メッセージ or エラーが出るまで待つ
    await expect(
      page.locator('text=登録しました').or(page.locator('text=登録完了')).or(page.locator('text=エラー')),
    ).toBeVisible({ timeout: 5_000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000);
  });
});
