import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * Регрессия H-N8-UX: при шторме РАЗНЫХ уведомлений (без cacheKey-совпадения)
 * дедупликация в notifications.js не срабатывает — каждый show() добавляет
 * новый DOM-узел. После 100 разных show() в DOM висит 100 .notification.
 *
 * Ожидаемое поведение после фикса (агент save-and-notifications-guards):
 * глобальный лимит/пул показанных одновременно ≤ 15.
 *
 * test.fail() — документация регрессии; снять после закрытия H-N8-UX.
 */
test.describe('Notifications storm @smoke', () => {
  test('100 РАЗНЫХ notifications.show схлопываются в <=15 DOM-узлов', async ({ page }) => {
    test.fail(true,
      'H-N8-UX: 100 разных Notifications.show создают 100 DOM-нод. ' +
      'Закрывается агентом save-and-notifications-guards.');
    await openAct(page, SEED_ACTS.empty);
    await page.waitForFunction(
      () => typeof (window as unknown as { Notifications?: { show?: unknown } })
        .Notifications?.show === 'function',
      { timeout: 5000 }
    );
    await page.evaluate(() => {
      const N = (window as unknown as {
        Notifications: { show: (m: string, t: string) => void };
      }).Notifications;
      // ВАЖНО: разные message → cacheKey=type:message не совпадают → нет
      // дедупликации через _handleDuplicate. Это и есть реальный H-N8-UX.
      for (let i = 0; i < 100; i++) N.show(`msg ${i}`, 'info');
    });
    await page.waitForTimeout(200);
    const count = await page.locator('.notification').count();
    expect(count, `DOM-нод .notification после 100 разных show: ${count}`)
      .toBeLessThanOrEqual(15);
  });
});
