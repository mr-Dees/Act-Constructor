import { test, expect } from '@playwright/test';

/**
 * Регрессия H-N3-ACTS: список актов на /acts не обновляется в других вкладках
 * после удаления акта. Нет cross-tab sync (BroadcastChannel / storage event).
 *
 * Сейчас test.fail — после агента acts-cross-tab-sync убрать .fail().
 *
 * TODO Phase 1: разведать селектор удалить-акт в context-menu acts-manager.
 * Сейчас тест минимальный — открывает /acts в двух контекстах, но не
 * выполняет удаление (требует доп. разведки UI).
 */
test.describe('Acts list cross-tab sync @smoke', () => {
  test('/acts открывается в двух контекстах без console-ошибок', async ({ browser }) => {
    // Облегчённый smoke: убедиться что страница /acts грузится в изолированных
    // browser-контекстах. Полный сценарий cross-tab sync — см. TODO ниже.
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
      // Базовая страница acts-manager — есть ли вообще тело и грузится без 4xx?
      await expect(pageA.locator('body')).toBeVisible();
      await expect(pageB.locator('body')).toBeVisible();

      expect(errorsA, `pageA pageerrors:\n${errorsA.join('\n')}`).toHaveLength(0);
      expect(errorsB, `pageB pageerrors:\n${errorsB.join('\n')}`).toHaveLength(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('удаление акта в одной вкладке обновляет список в другой ≤ 500ms',
    async () => {
      test.skip(true,
        'TODO: разведка acts-manager context-menu удаления (Phase 1). '
        + 'После — оставить только test.fail для документации H-N3-ACTS.');
      expect(true).toBe(true);
    });
});
