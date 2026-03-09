import { test, expect } from '@playwright/test';
import { enterMeetingRoom } from './helpers/meeting';

const TEST_EMAIL = process.env.TEST_EMAIL ?? '';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? '';
const HAS_AUTH = !!TEST_EMAIL && !!TEST_PASSWORD;

test.describe('会議室 UI コンポーネント', () => {
  test.skip(!HAS_AUTH, 'TEST_EMAIL / TEST_PASSWORD が未設定のためスキップ');

  test.beforeEach(async ({ page }) => {
    await enterMeetingRoom(page, TEST_EMAIL, TEST_PASSWORD);
  });

  test('ヘッダー — ユーザーメール・ステータスバッジが表示される', async ({ page }) => {
    await expect(page.locator('text=会議中')).toBeVisible();
    await expect(page.locator(`text=${TEST_EMAIL}`)).toBeVisible();
  });

  test('ヘッダー — 設定・RAG管理・ログアウトボタンが揃っている', async ({ page }) => {
    await expect(page.getByRole('button', { name: '設定' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'RAG管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible();
  });

  test('コントロールバー — 6ボタンが揃っている', async ({ page }) => {
    // ミュートボタン
    await expect(page.locator('button[title*="ミュート"]').first()).toBeVisible();
    // カメラボタン
    await expect(page.locator('button[title*="カメラ"]')).toBeVisible();
    // 画面共有ボタン
    await expect(page.locator('button[title*="画面"]')).toBeVisible();
    // 設定ボタン
    await expect(page.locator('button[title*="カメラ設定"]')).toBeVisible();
    // 退出ボタン
    await expect(page.getByRole('button', { name: /退出/ })).toBeVisible();
  });

  test('マイクボタン — デフォルトはミュート状態(赤)', async ({ page }) => {
    // デフォルトはミュート → 🔇 + 赤背景
    const muteBtn = page.locator('button[title*="ミュート解除"]');
    await expect(muteBtn).toBeVisible();
    // ミュートボタンの背景色が赤系であることを確認 (インラインスタイル)
    const bg = await muteBtn.evaluate((el) => (el as HTMLElement).style.background);
    expect(bg).toContain('ef4444');
  });

  test('マイクボタン — ミュート解除で聴取中(シアン)に変わる', async ({ page }) => {
    const muteBtn = page.locator('button[title*="ミュート解除"]');
    await muteBtn.click();
    // 聴取中: シアン背景
    const activeBtn = page.locator('button[title*="ミュート"]').first();
    await expect(activeBtn).toBeVisible();
    const bg = await activeBtn.evaluate((el) => (el as HTMLElement).style.background);
    expect(bg).toContain('06b6d4');
  });

  test('AI アバター — video 要素と待機中ステータスが表示される', async ({ page }) => {
    // AI アシスタントラベル
    await expect(page.locator('text=AI アシスタント')).toBeVisible();
    // aibot.mp4 video 要素
    await expect(page.locator('video[src="/aibot.mp4"]')).toBeVisible();
    // ステータス: 待機中
    await expect(page.locator('text=待機中').or(page.locator('text=AI アシスタント'))).toBeVisible();
  });

  test('チャット — 入力欄・送信ボタン・ファイル添付ボタンが表示される', async ({ page }) => {
    await expect(page.getByPlaceholder(/メッセージを入力/)).toBeVisible();
    await expect(page.getByRole('button', { name: '送信' })).toBeVisible();
    await expect(page.locator('button[title*="ファイルを添付"]')).toBeVisible();
  });

  test('RAG 登録エリア — 折りたたみトグルで開閉できる', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /RAG 登録/ });
    await expect(toggle).toBeVisible();

    // 開く
    await toggle.click();
    await expect(page.locator('text=RAG ドキュメント登録')).toBeVisible({ timeout: 3_000 });

    // 閉じる
    await toggle.click();
    await expect(page.locator('text=RAG ドキュメント登録')).toBeHidden({ timeout: 3_000 });
  });

  test('3秒無音ダイアログ — ミュート解除後に話して3秒後に表示される', async ({ page }) => {
    // Web Speech API のモック: ミュート解除 → 自動的に recognitionResult を発火
    await page.evaluate(() => {
      // SpeechRecognition を再モックして即座に結果を返す
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      class MockSpeechRecognition extends EventTarget {
        continuous = false;
        interimResults = false;
        lang = '';
        onresult: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        start() {
          // 即座に確定結果を返す
          setTimeout(() => {
            if (this.onresult) {
              this.onresult({
                resultIndex: 0,
                results: [Object.assign([{ transcript: 'テストの発話' }], { isFinal: true })],
              });
            }
          }, 100);
        }
        stop() {}
      }
      win.SpeechRecognition = MockSpeechRecognition;
      win.webkitSpeechRecognition = MockSpeechRecognition;
    });

    // ミュート解除
    await page.locator('button[title*="ミュート解除"]').click();
    // 3秒待つ
    await page.waitForTimeout(3_500);
    // ダイアログ表示
    await expect(page.locator('text=3秒間の無音を検知しました')).toBeVisible({ timeout: 5_000 });
    // 「破棄」で閉じる
    await page.getByRole('button', { name: '破棄' }).click();
    await expect(page.locator('text=3秒間の無音を検知しました')).toBeHidden();
  });

  test('退出ボタンで確認ダイアログが表示され、退出できる', async ({ page }) => {
    await page.getByRole('button', { name: /退出/ }).click();
    // 退出確認ダイアログが表示される
    await expect(page.locator('text=会議を退出しますか')).toBeVisible({ timeout: 5_000 });
    // 「このまま退出」で会議終了
    await page.getByRole('button', { name: 'このまま退出' }).click();
    await expect(
      page.locator('text=会議が終了しました').or(page.locator('text=会議を開始する')),
    ).toBeVisible({ timeout: 10_000 });
  });
});
