import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * Регрессия H5-A: при Ctrl+S во время активного редактирования ячейки
 * таблицы (textarea сфокусирован, без blur) изменения теряются —
 * `startEditingCell` коммитит value в `table.grid[r][c].content` ТОЛЬКО на
 * blur/Enter. Save идёт по существующему grid → новое значение не уходит
 * в БД → reload показывает старое.
 *
 * test.fail() — документация регрессии. После агента
 * per-node-rendering-api (Wave 2 H5-A) убрать .fail(), сценарий должен пройти.
 *
 * DOM-flow:
 *  - dblclick на td → `td.classList += 'editing'`, появляется <textarea>.
 *  - typing в textarea → НЕ синхронизируется с grid до finishEditing.
 *  - Ctrl+S обрабатывается App._handleKeyDown на window → DB-save идёт
 *    по AppState.tables (старое значение).
 *  - reload → старое значение в ячейке.
 */
test.describe('Ctrl+S during edit @smoke', () => {
  test('Ctrl+S во время редактирования ячейки сохраняет значение после reload',
    async ({ page }) => {
      test.fail(true,
        'H5-A: Ctrl+S не коммитит pending textarea edit перед save. ' +
        'Закрывается агентом per-node-rendering-api.');
      await openAct(page, SEED_ACTS.withContent);
      await page.locator('.step[data-step="2"]').click();

      const td = page.locator(
        'td[data-table-id="tbl-seed-1"][data-row="1"][data-col="1"]'
      );
      await expect(td).toBeVisible({ timeout: 5000 });
      await expect(td).toHaveText('Значение 2');

      const NEW_VAL = 'H5A_НОВОЕ_БЕЗ_BLUR';

      // Войти в режим редактирования через tableManager (стабильнее dblclick).
      await page.evaluate(() => {
        const cell = document.querySelector(
          'td[data-table-id="tbl-seed-1"][data-row="1"][data-col="1"]'
        ) as HTMLElement;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error tableManager — глобал из table-core.js
        tableManager.cellsOps.selectCell(cell);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error tableManager — глобал из table-core.js
        tableManager.cellsOps.startEditingCell(cell);
      });

      // Подождать рендер textarea.
      const textarea = page.locator(
        'td[data-table-id="tbl-seed-1"][data-row="1"][data-col="1"] textarea'
      );
      await expect(textarea).toBeVisible();

      // Ввести новое значение БЕЗ blur.
      await page.evaluate((v) => {
        const ta = document.querySelector(
          'td[data-table-id="tbl-seed-1"][data-row="1"][data-col="1"] textarea'
        ) as HTMLTextAreaElement;
        ta.focus();
        ta.value = v;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }, NEW_VAL);

      // Эмулируем «Ctrl+S во время edit»: НЕ блюрим textarea, сразу шлём
      // PUT /content по текущему AppState. AppState.tables[...][grid] всё ещё
      // содержит СТАРОЕ "Значение 2" (textarea не закоммичен в grid). Это и
      // есть baseline бага H5-A. Реальный код (app.js) тоже не флёшит
      // textarea перед `forceSaveAsync` → `generateBtn.click()`.
      const saveStatus = await page.evaluate(async (actId) => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error AppState — глобал
        const data = AppState.exportData();
        const r = await fetch(`/api/v1/acts/${actId}/content`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-JupyterHub-User': '22494524',
          },
          body: JSON.stringify(data),
        });
        return r.status;
      }, SEED_ACTS.withContent);
      expect(saveStatus, 'PUT content должен вернуть 2xx').toBeLessThan(300);

      // Reload + проверить. После H5-A → ячейка показывает СТАРОЕ значение,
      // а тест ожидает НОВОЕ → FAIL (что фиксирует баг).
      await page.reload();
      await page.locator('.step[data-step="2"]').click();
      const tdAfter = page.locator(
        'td[data-table-id="tbl-seed-1"][data-row="1"][data-col="1"]'
      );
      await expect(tdAfter).toHaveText(NEW_VAL, { timeout: 10000 });
    });
});
