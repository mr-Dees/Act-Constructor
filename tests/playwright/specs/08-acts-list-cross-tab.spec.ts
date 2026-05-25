import { test, expect } from '../fixtures';

/**
 * Регрессия H-N3-ACTS: список актов на /acts не обновляется в других
 * вкладках после удаления акта — нет cross-tab sync (BroadcastChannel /
 * storage event на удаление акта отсутствуют, см. acts-manager-page.js
 * — после deleteAct() вызывается только локальный `this.loadActs()`).
 *
 * test.fail() — документация регрессии. После агента acts-cross-tab-sync
 * убрать .fail(), сценарий должен пройти.
 *
 * DOM-flow:
 *  - /acts рендерит `#actsListContainer` с `.act-card` для каждого акта.
 *  - .act-card НЕ имеет data-act-id; идентификация — через текст
 *    `[data-field="inspection_name"]` (название акта).
 *  - Удаление — кнопка `[data-action="delete"]` внутри карточки, после
 *    подтверждения DialogManager → DELETE /api/v1/acts/{id}.
 *  - В этом тесте мы для надёжности зовём DELETE напрямую через fetch
 *    из контекста A (минуя UI-диалог) — проверяем что контекст B НЕ
 *    обновился сам ≤ 500ms.
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

        // Дождаться рендера карточек в обеих вкладках.
        // SEED_ACTS.forDelete (999003) — это "E2E: акт для cross-tab удаления".
        const cardSelector = '.act-card:has([data-field="inspection_name"]:text-is("E2E: акт для cross-tab удаления"))';
        await expect(pageA.locator(cardSelector)).toBeVisible({ timeout: 10000 });
        await expect(pageB.locator(cardSelector)).toBeVisible({ timeout: 10000 });

        // Удаляем акт через прямой DELETE в контексте A (минуем UI-диалог).
        const delStatus = await pageA.evaluate(async () => {
          const r = await fetch('/api/v1/acts/999003', {
            method: 'DELETE',
            headers: { 'X-JupyterHub-User': '22494524' },
          });
          return r.status;
        });
        expect(delStatus, 'DELETE должен вернуть 2xx').toBeLessThan(300);

        // В контексте B ожидаем что карточка исчезнет ≤ 500ms.
        // Без cross-tab sync — карточка остаётся → test.fail() ожидает FAIL.
        await expect(pageB.locator(cardSelector)).toHaveCount(0, {
          timeout: 500,
        });
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    });
});
