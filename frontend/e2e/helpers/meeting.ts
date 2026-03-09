import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { login } from './auth';

/**
 * ログイン → 会議開始 → 「会議中」ステータスが表示されるまで待機する
 */
export async function enterMeetingRoom(page: Page, email: string, password: string) {
  await login(page, email, password);
  await page.getByRole('button', { name: '会議を開始する' }).click();
  await expect(page.locator('text=会議中')).toBeVisible({ timeout: 25_000 });
}

/**
 * AI の返答が来て「待機中」ステータスになるまで待機する
 * (isSpeaking=false かつ isProcessing=false の状態)
 */
export async function waitForAIResponse(page: Page, timeout = 30_000) {
  // AI 処理中バブルが消えるまで待つ
  await page.locator('text=AI が考え中...').or(page.locator('text=AI 解析中...')).waitFor({
    state: 'hidden',
    timeout,
  });
}

/**
 * RAG テキスト登録ユーティリティ
 * 会議室のサイドバー「RAG 登録」フォームにテキストを入力して送信する
 */
export async function uploadRAGText(
  page: Page,
  text: string,
  source: string,
) {
  // RAG 登録パネルを開く
  const ragToggle = page.getByRole('button', { name: /RAG 登録/ });
  if (await ragToggle.isVisible()) {
    const isOpen = await page.locator('text=RAG ドキュメント登録').isVisible();
    if (!isOpen) await ragToggle.click();
  }
  await expect(page.locator('text=RAG ドキュメント登録')).toBeVisible({ timeout: 5_000 });

  await page.getByPlaceholder(/テキストを貼り付け/).fill(text);
  const sourceInput = page.getByPlaceholder(/出典名/).or(page.getByLabel(/出典/));
  if (await sourceInput.isVisible()) await sourceInput.fill(source);

  await page.getByRole('button', { name: '登録' }).click();
}
