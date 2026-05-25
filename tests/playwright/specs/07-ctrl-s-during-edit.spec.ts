import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * Регрессия H5-A: при Ctrl+S во время активного редактирования ячейки
 * таблицы (textarea сфокусирован, без blur) изменения теряются —
 * `startEditingCell` коммитит `textarea.value` в `table.grid[r][c].content`
 * ТОЛЬКО на blur/Enter. Real-flow App.js Ctrl+S handler:
 *   forceSaveAsync() → generateBtn.click() → PUT /content
 * — pending textarea НЕ флёшится перед `AppState.exportData()` →
 * сохраняется старое (либо пустое — `startEditingCell` зачищает
 * `cellEl.textContent = ''` при входе в edit, и без commit'а пусто и
 * улетит в БД).
 *
 * test.fail() — документация регрессии. После фикса агентом
 * `per-node-rendering-api` (добавит `commitPendingEdit` в App._handleKeyDown
 * перед save) — снять `.fail()`, сценарий должен пройти.
 *
 * DOM-flow (разведано через MCP):
 *  - dblclick на td → handler в table-core.js слушает событие 'dblclick'
 *    (НЕ 2x click, как у item-title!) → `startEditingCell` → td.editing,
 *    `<textarea>` внутри, `cellEl.textContent = ''`.
 *  - typing в textarea → НЕ синхронизируется с grid до finishEditing.
 *  - page.keyboard.press('Control+s') → keydown на document (window):
 *    App._handleKeyDown (app.js:149) → forceSaveAsync + generateBtn.click()
 *    → navigation-manager.js → PUT /content с AppState.exportData().
 *  - reload → старое/пустое значение в ячейке.
 */
test.describe('Ctrl+S during edit @smoke', () => {
  test('Ctrl+S во время редактирования ячейки сохраняет значение после reload',
    async ({ page }) => {
      // Регрессия H5-A закрыта: Ctrl+S теперь коммитит pending textarea edit
      // через tableManager.cellsOps.commitPendingEdit() перед forceSaveAsync.
      await openAct(page, SEED_ACTS.withContent);
      await page.locator('.step[data-step="2"]').click();

      const td = page.locator(
        'td[data-table-id="tbl-seed-1"][data-row="1"][data-col="1"]'
      );
      await expect(td).toBeVisible({ timeout: 5000 });
      await expect(td).toHaveText('Значение 2');

      const NEW_VAL = 'H5A_НОВОЕ_БЕЗ_BLUR';

      // Войти в edit-mode через нативный dblclick event. table-core.js
      // слушает именно 'dblclick' (не 2x click). Playwright .dblclick()
      // диспатчит mousedown/up × 2 + 'dblclick' — handler срабатывает.
      await td.dblclick();
      const textarea = page.locator(
        'td[data-table-id="tbl-seed-1"][data-row="1"][data-col="1"] textarea'
      );
      await expect(textarea).toBeVisible({ timeout: 3000 });

      // Ввести новое значение БЕЗ blur. Используем прямое value+input —
      // page.keyboard.type на textarea внутри ячейки может перехватываться
      // table.core.js's keydown handler (Enter→finishEditing).
      await page.evaluate((v) => {
        const ta = document.querySelector(
          'td[data-table-id="tbl-seed-1"][data-row="1"][data-col="1"] textarea'
        ) as HTMLTextAreaElement;
        ta.focus();
        ta.value = v;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }, NEW_VAL);
      await expect(textarea).toHaveValue(NEW_VAL);

      // Real-flow Ctrl+S: OS-level через page.keyboard.press. App.js
      // document.keydown handler перехватит и запустит save-pipeline
      // БЕЗ flush pending textarea.
      await page.keyboard.press('Control+s');

      // Дать save'у отработать: forceSaveAsync (rAF + 100ms) +
      // generateBtn.click() → PUT (network round-trip).
      await page.waitForTimeout(3000);

      // Reload + проверить.
      // Сейчас (H5-A): textarea не закоммичен → AppState содержит ""
      // → reload → ячейка пустая → expect(NEW_VAL) валится → test.fail()=pass.
      // После фикса агента: commitPendingEdit перед save → AppState содержит
      // NEW_VAL → reload → ячейка с NEW_VAL → expect проходит.
      await page.reload();
      await page.locator('.step[data-step="2"]').click();
      const tdAfter = page.locator(
        'td[data-table-id="tbl-seed-1"][data-row="1"][data-col="1"]'
      );
      await expect(tdAfter).toHaveText(NEW_VAL, { timeout: 10000 });
    });
});
