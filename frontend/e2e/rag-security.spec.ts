import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { enterMeetingRoom } from './helpers/meeting';

/**
 * ユーザー間 RAG 分離テスト
 *
 * User A が登録した RAG ドキュメントが User B に漏洩しないことを確認する。
 * 環境変数: TEST_EMAIL, TEST_PASSWORD, TEST_EMAIL_2, TEST_PASSWORD_2
 */

const TEST_EMAIL = process.env.TEST_EMAIL ?? '';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? '';
const TEST_EMAIL_2 = process.env.TEST_EMAIL_2 ?? '';
const TEST_PASSWORD_2 = process.env.TEST_PASSWORD_2 ?? '';
const HAS_BOTH_USERS = !!TEST_EMAIL && !!TEST_PASSWORD && !!TEST_EMAIL_2 && !!TEST_PASSWORD_2;

const SECRET_SOURCE = `secret_doc_${Date.now()}`;
const SECRET_CONTENT = `極秘情報: ${SECRET_SOURCE} — これはユーザーAだけが持つ秘密の文書です`;

test.describe('RAG ユーザー間分離', () => {
  test.skip(!HAS_BOTH_USERS, 'TEST_EMAIL / TEST_PASSWORD / TEST_EMAIL_2 / TEST_PASSWORD_2 が未設定のためスキップ');

  test('User A の RAG ドキュメントが User B に見えない', async ({ browser }) => {
    test.setTimeout(120_000);

    // ─── User A: RAG 登録 ────────────────────────────────────────
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await enterMeetingRoom(pageA, TEST_EMAIL, TEST_PASSWORD);

    // RAG 登録フォームを開く
    const ragToggleA = pageA.getByRole('button', { name: /RAG 登録/ });
    await ragToggleA.click();
    await expect(pageA.locator('text=RAG ドキュメント登録')).toBeVisible({ timeout: 5_000 });

    await pageA.getByPlaceholder(/テキストを貼り付け/).fill(SECRET_CONTENT);
    const sourceInputA = pageA.getByPlaceholder(/出典名/).or(pageA.getByLabel(/出典/));
    if (await sourceInputA.isVisible()) await sourceInputA.fill(SECRET_SOURCE);
    await pageA.getByRole('button', { name: 'インデックス登録' }).click();
    // SQS 受付 → 成功メッセージを待機
    await expect(
      pageA.locator('text=登録リクエストを受け付けました').or(pageA.locator('text=登録完了')),
    ).toBeVisible({ timeout: 10_000 });

    // User A の RAG 管理画面で secret_doc が存在することを確認
    // SQS ワーカーが非同期処理するため「更新」ボタンを繰り返しクリックしながら最大 60 秒待機
    await pageA.getByRole('button', { name: 'RAG管理' }).click();
    await expect(pageA.locator('text=RAG ドキュメント管理')).toBeVisible({ timeout: 10_000 });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await pageA.locator(`text=${SECRET_SOURCE}`).isVisible()) break;
      await pageA.getByRole('button', { name: '更新' }).click();
      await pageA.waitForTimeout(5_000);
    }
    await expect(pageA.locator(`text=${SECRET_SOURCE}`)).toBeVisible({ timeout: 5_000 });
    await ctxA.close();

    // ─── User B: RAG 参照確認 ────────────────────────────────────
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();

    // User B の RAG 管理画面で secret_doc が表示されないことを確認
    await login(pageB, TEST_EMAIL_2, TEST_PASSWORD_2);
    await pageB.getByRole('button', { name: 'RAG管理' }).click();
    await expect(pageB.locator('text=RAG ドキュメント管理')).toBeVisible({ timeout: 10_000 });
    await expect(pageB.locator(`text=${SECRET_SOURCE}`)).toBeHidden();

    await ctxB.close();
  });

  test('User B の AI 応答に User A の秘密情報が含まれない', async ({ browser }) => {
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await enterMeetingRoom(pageB, TEST_EMAIL_2, TEST_PASSWORD_2);

    // チャットで secret_doc について質問
    await pageB.getByPlaceholder(/メッセージを入力/).fill(`${SECRET_SOURCE}について教えてください`);
    await pageB.getByRole('button', { name: '送信' }).click();

    // AI 応答を待つ
    await pageB.locator('text=AI が考え中...').waitFor({ state: 'hidden', timeout: 30_000 });
    await pageB.waitForTimeout(2_000);

    // AI の返答に secret content が含まれていないことを確認
    const messages = await pageB.locator('.chat-bubble, [data-testid="ai-message"]').allTextContents();
    const combined = messages.join(' ');
    expect(combined).not.toContain('極秘情報');
    expect(combined).not.toContain(SECRET_SOURCE);

    await ctxB.close();
  });
});
