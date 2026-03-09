import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * ログインユーティリティ
 * ロビー画面「会議を開始する」ボタンが現れるまで待機する
 */
export async function login(page: Page, email: string, password: string) {
  // 既存セッション・状態をクリアしてログイン画面から開始する
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('button', { name: '会議を開始する' })).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * 新規登録ユーティリティ
 * 確認コード入力画面が表示されるまで待機する
 */
export async function signup(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '新規登録' }).click();
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel(/パスワード/).fill(password);
  await page.getByRole('button', { name: 'アカウント作成' }).click();
  // 確認コード入力フォームが表示されるまで待つ
  await expect(page.locator('text=確認コード').or(page.locator('text=メールをご確認'))).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * アカウント削除ユーティリティ
 * ログイン済みのロビー画面から「アカウント設定」→ DELETE 入力 → 削除まで実施する
 */
export async function deleteAccount(page: Page) {
  await page.getByRole('button', { name: 'アカウント設定' }).click();
  await expect(page.locator('text=アカウント設定')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'アカウントを削除する' }).click();
  await page.getByPlaceholder('DELETE').fill('DELETE');
  await page.getByRole('button', { name: '完全に削除する' }).click();
  // ログイン画面に戻るまで待機
  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible({ timeout: 20_000 });
}
