import { test, expect, type Page } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL ?? '';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? '';
const HAS_AUTH_CREDENTIALS = !!TEST_EMAIL && !!TEST_PASSWORD;

async function enterMeetingRoom(page: Page) {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(TEST_EMAIL);
  await page.getByLabel('パスワード').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('button', { name: '会議を開始する' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '会議を開始する' }).click();
  await expect(page.locator('text=会議中')).toBeVisible({ timeout: 20_000 });
}

test.describe('RAG ドキュメント登録', () => {
  test.skip(!HAS_AUTH_CREDENTIALS, 'TEST_EMAIL / TEST_PASSWORD が未設定のためスキップ');

  test.beforeEach(async ({ page }) => {
    await enterMeetingRoom(page);
  });

  test('ドキュメント登録フォームが表示される', async ({ page }) => {
    await expect(page.locator('text=📄 RAG ドキュメント登録')).toBeVisible();
    await expect(page.getByPlaceholderText(/出典名/)).toBeVisible();
    await expect(page.getByPlaceholderText(/テキストを貼り付け/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'インデックス登録' })).toBeDisabled();
  });

  test('テキスト入力で登録ボタンが有効になる', async ({ page }) => {
    await page.getByPlaceholderText(/テキストを貼り付け/).fill(
      'この会議のアジェンダです。プロジェクトの進捗を報告します。',
    );
    await expect(page.getByRole('button', { name: 'インデックス登録' })).toBeEnabled();
  });

  test('ドキュメント登録が成功する (SQS 非同期)', async ({ page }) => {
    await page.getByPlaceholderText(/出典名/).fill('テスト文書');
    await page.getByPlaceholderText(/テキストを貼り付け/).fill(
      'これはテスト用のドキュメントです。AI が会議中に参照できるようになります。' +
        '製品の仕様書や FAQ をここに登録することで、より正確な回答が得られます。',
    );
    await page.getByRole('button', { name: 'インデックス登録' }).click();

    // 202 非同期レスポンス → 受け付けメッセージ
    await expect(
      page.locator('text=/登録リクエストを受け付けました/'),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('登録成功後にフォームがクリアされる', async ({ page }) => {
    const textarea = page.getByPlaceholderText(/テキストを貼り付け/);
    await textarea.fill('登録後にクリアされるテキスト');
    await page.getByRole('button', { name: 'インデックス登録' }).click();

    await expect(page.locator('text=/登録リクエストを受け付けました/')).toBeVisible({
      timeout: 15_000,
    });
    await expect(textarea).toHaveValue('');
  });
});
