import { test, expect } from '../fixtures';

/**
 * Регрессия H-N3-ACTS: список актов на /acts не обновляется в других
 * вкладках после удаления акта. После `deleteAct()` в `acts-manager-page.js`
 * вызывается только локальный `this.loadActs()` — нет BroadcastChannel /
 * storage-event, контекст B не получает invalidation.
 *
 * test.fail() — документация регрессии. После агента acts-cross-tab-sync
 * (добавит broadcast в `deleteAct` и listener в `loadActs`/init) убрать
 * `.fail()`, сценарий должен пройти.
 *
 * DOM-flow (разведано через MCP):
 *  - /acts рендерит `#actsListContainer` с `.act-card` для каждого акта.
 *  - .act-card НЕ имеет `data-act-id`; идентификация — по тексту
 *    `[data-field="inspection_name"]` (название акта).
 *  - Кнопка удаления: `.act-card [data-action="delete"]`.
 *  - После click → DialogManager.show() добавляет в body
 *    `.custom-dialog-overlay.visible > .custom-dialog`. Кнопки:
 *      `.btn.btn-primary.dialog-confirm` (текст «Удалить»),
 *      `.btn.btn-secondary.dialog-cancel` (текст «Отмена»).
 *  - После confirm → DELETE /api/v1/acts/{id} → reload локального списка.
 *    Cross-tab уведомления НЕТ.
 */
test.describe('Acts list cross-tab sync @smoke', () => {
  test('/acts открывается в двух контекстах без console-ошибок', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const errorsA: string[] = [];
      const errorsB: string[] = [];
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      pageA.on('pageerror', (e) => errorsA.push(e.message));
      pageB.on('pageerror', (e) => errorsB.push(e.message));

      await Promise.all([pageA.goto('/acts'), pageB.goto('/acts')]);
      await expect(pageA.locator('body')).toBeVisible();
      await expect(pageB.locator('body')).toBeVisible();
      await expect(pageA.locator('#actsListContainer')).toBeVisible();
      await expect(pageB.locator('#actsListContainer')).toBeVisible();

      expect(errorsA, `pageA pageerrors:\n${errorsA.join('\n')}`).toHaveLength(0);
      expect(errorsB, `pageB pageerrors:\n${errorsB.join('\n')}`).toHaveLength(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('удаление акта в одной вкладке обновляет список в другой ≤ 500ms',
    async ({ browser }) => {
      test.fail(true,
        'H-N3-ACTS: нет cross-tab инвалидации списка актов после DELETE. ' +
        'Закрывается агентом acts-cross-tab-sync.');

      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      try {
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        await Promise.all([pageA.goto('/acts'), pageB.goto('/acts')]);

        // Дождаться рендера карточек в обеих вкладках. SEED_ACTS.forDelete
        // (999003) — это "E2E: акт для cross-tab удаления".
        const cardSelector =
          '.act-card:has([data-field="inspection_name"]:text-is("E2E: акт для cross-tab удаления"))';
        await expect(pageA.locator(cardSelector)).toBeVisible({ timeout: 10000 });
        await expect(pageB.locator(cardSelector)).toBeVisible({ timeout: 10000 });

        // Real-flow: click кнопки [data-action="delete"] на карточке в ctxA.
        await pageA.locator(`${cardSelector} [data-action="delete"]`).click();

        // Появляется DialogManager confirm-диалог. Жмём «Удалить»
        // — это запустит safeClick → deleteAct() → DELETE /api/v1/acts/999003
        // → loadActs() (только в ctxA).
        const confirmBtn = pageA.locator('.btn.btn-primary.dialog-confirm');
        await expect(confirmBtn).toBeVisible({ timeout: 3000 });
        await confirmBtn.click();

        // Дождаться что в ctxA карточка действительно ушла из DOM
        // (валидация что real-flow доделал работу до конца).
        await expect(pageA.locator(cardSelector)).toHaveCount(0, {
          timeout: 5000,
        });

        // В ctxB ожидаем что карточка исчезнет ≤ 500ms. Без cross-tab
        // sync — карточка остаётся → expect валится → test.fail() = pass.
        await expect(pageB.locator(cardSelector)).toHaveCount(0, {
          timeout: 500,
        });
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    });
});
