import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * Регрессия H-N8-UX: при шторме РАЗНЫХ уведомлений (без cacheKey-совпадения)
 * дедупликация в notifications.js не срабатывает — каждый show() добавляет
 * новый DOM-узел. После фикса работает глобальный cap
 * AppConfig.notifications.maxConcurrent (FIFO-вытеснение самых старых).
 */
test.describe('Notifications storm @smoke', () => {
  test('100 РАЗНЫХ notifications.show схлопываются в <=15 DOM-узлов', async ({ page }) => {
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
