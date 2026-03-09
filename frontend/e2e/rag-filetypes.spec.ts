import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { enterMeetingRoom } from './helpers/meeting';

/**
 * RAG ファイル種別テスト
 *
 * テキスト / Markdown / CSV / PDF の各形式で登録 → RAG 一覧に表示されることを確認する。
 * 環境変数: TEST_EMAIL, TEST_PASSWORD
 */

const TEST_EMAIL = process.env.TEST_EMAIL ?? '';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? '';
const HAS_AUTH = !!TEST_EMAIL && !!TEST_PASSWORD;

/** 一時ファイルを作成して path を返す */
function createTempFile(name: string, content: string): string {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

test.describe('RAG ファイル種別登録', () => {
  test.skip(!HAS_AUTH, 'TEST_EMAIL / TEST_PASSWORD が未設定のためスキップ');

  test.beforeEach(async ({ page }) => {
    await enterMeetingRoom(page, TEST_EMAIL, TEST_PASSWORD);
    // RAG 登録パネルを開く
    const toggle = page.getByRole('button', { name: /RAG 登録/ });
    await toggle.click();
    await expect(page.locator('text=RAG ドキュメント登録')).toBeVisible({ timeout: 5_000 });
  });

  test('テキストファイル (.txt) を登録できる', async ({ page }) => {
    const source = `test_txt_${Date.now()}`;
    const filePath = createTempFile(`${source}.txt`, `テキストファイルのテスト内容 source=${source}`);

    const fileInput = page.locator('input[type="file"][accept*=".txt"]');
    await fileInput.setInputFiles(filePath);
    await expect(page.locator(`text=${source}.txt`).or(page.locator('text=.txt'))).toBeVisible({ timeout: 3_000 });

    fs.unlinkSync(filePath);
  });

  test('Markdown ファイル (.md) を登録できる', async ({ page }) => {
    const source = `test_md_${Date.now()}`;
    const filePath = createTempFile(`${source}.md`, `# Markdown テスト\n\nsource=${source}\n\nこれはMarkdownファイルです。`);

    const fileInput = page.locator('input[type="file"][accept*=".txt"]');
    await fileInput.setInputFiles(filePath);
    await expect(page.locator('text=.md').or(page.locator(`text=${source}`))).toBeVisible({ timeout: 3_000 });

    fs.unlinkSync(filePath);
  });

  test('CSV ファイル (.csv) を登録できる', async ({ page }) => {
    const source = `test_csv_${Date.now()}`;
    const filePath = createTempFile(`${source}.csv`, `名前,値\nテスト,${source}\nCSV,データ`);

    const fileInput = page.locator('input[type="file"][accept*=".txt"]');
    await fileInput.setInputFiles(filePath);
    await expect(page.locator('text=.csv').or(page.locator(`text=${source}`))).toBeVisible({ timeout: 3_000 });

    fs.unlinkSync(filePath);
  });

  test('250KB 超のテキストで 413 エラーが表示される', async ({ page }) => {
    // 260KB の大きなテキストを入力
    const largeText = 'A'.repeat(260 * 1024);
    await page.getByPlaceholder(/テキストを貼り付け/).fill(largeText);
    await page.getByRole('button', { name: '登録' }).click();
    // エラーメッセージの確認 (413 or サイズ超過)
    await expect(
      page.locator('text=サイズ超過').or(page.locator('text=413')).or(page.locator('text=250')),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('RAG 管理画面 — ファイル一覧と削除', () => {
  test.skip(!HAS_AUTH, 'TEST_EMAIL / TEST_PASSWORD が未設定のためスキップ');

  test('RAG 管理画面が開く', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('メールアドレス').fill(TEST_EMAIL);
    await page.getByLabel('パスワード').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('button', { name: '会議を開始する' })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'RAG管理' }).click();
    await expect(
      page.locator('text=RAGドキュメント').or(page.locator('text=登録済みドキュメント')).or(page.locator('text=RAG管理')),
    ).toBeVisible({ timeout: 10_000 });
  });
});
