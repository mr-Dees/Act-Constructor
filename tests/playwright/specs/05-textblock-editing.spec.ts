import { test, expect, openAct, SEED_ACTS, waitForSaveComplete } from '../fixtures';

/**
 * Редактирование текстового блока на step2.
 *
 * DOM-flow (разведано через MCP):
 *  - Textblock-нода: `.item-block[data-node-id=X]` (type=textblock в дереве).
 *  - Редактор: `.textblock-editor[data-text-block-id=X][contenteditable=true]`.
 *  - Ввод текста через execCommand → StorageManager пишет в localStorage
 *    debounce'ом ~3s → save-indicator класс `local-only` (red).
 *  - Ctrl+S → DB-save → `saved` (white/green).
 *
 * Промежуточный класс `unsaved` (yellow) виден сразу после input — это
 * markAsUnsaved до debounce.
 */
test.describe('Textblock editing @smoke', () => {
  test('правка textblock-редактора меняет save-indicator', async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    await page.locator('.step[data-step="2"]').click();

    const editor = page.locator(
      '.textblock-editor[data-text-block-id="txt-seed-1"]'
    );
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect(editor).toHaveText(/Исходный текст/);

    // StorageManager отключает tracking на 500ms после loadActContent.
    // Ждём чтобы markAsUnsaved сработал на нашем input.
    await page.waitForTimeout(1000);

    // Ввод через клавиатуру (real input-event, в отличие от execCommand
    // через page.evaluate — некоторые версии Chromium не диспатчат input
    // на manual execCommand в isolated context).
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Изменённый текст E2E.');

    const indicator = page.locator('#saveIndicatorBtn');

    // input → handleEditorInput debounce 500ms → AppState mutation
    // → markAsUnsaved (Proxy) → класс 'unsaved' (red). Окно до 3s.
    await expect(indicator).toHaveClass(/\bunsaved\b/, { timeout: 3000 });

    // _debouncedSave 3s → saveState → класс 'local-only' (yellow).
    await expect(indicator).toHaveClass(/\blocal-only\b/, { timeout: 5000 });

    // Ctrl+S → DB-save → 'saved' (white).
    await page.keyboard.press('Control+s');
    await waitForSaveComplete(page);
  });
});
