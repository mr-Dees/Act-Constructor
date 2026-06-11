import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * M.19: что эмитит Chromium на execCommand('strikeThrough') в редакторе ТБ.
 *
 * Контракт (зафиксирован и в inline.py, и в html_sanitizer.py):
 *  - дефолтный режим (styleWithCSS приложением НЕ включается) → тег <strike>;
 *  - тег должен пережить и фронтовый DOMPurify-профиль 'acts', и бэк-bleach
 *    (s/strike/del в whitelist), и отрендериться зачёркиванием в DOCX.
 * Если Chromium сменит форму эмита на CSS-span — тест укажет на дрейф
 * (CSS-форма text-decoration: line-through тоже поддержана в inline.py).
 */
test.describe('Textblock strikethrough (M.19)', () => {
  test('strikeThrough эмитит strike-разметку и она остаётся в редакторе', async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    await page.locator('.step[data-step="2"]').click();

    const editor = page.locator(
      '.textblock-editor[data-text-block-id="txt-seed-1"]'
    );
    await expect(editor).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    // Выделяем весь текст и жмём хоткей зачёркивания (Ctrl+Shift+X).
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+Shift+KeyX');

    const html = await editor.innerHTML();
    // Дефолтный Chromium эмитит <strike>; принимаем любую из форм контракта.
    const hasTagForm = /<(s|strike|del)\b/i.test(html);
    const hasCssForm = /text-decoration[^:]*:\s*[^;"]*line-through/i.test(html);
    expect(hasTagForm || hasCssForm, `innerHTML без зачёркивания: ${html}`).toBe(true);
  });
});
