import { test, expect } from '@playwright/test';
import { openAct, SEED_ACTS } from '../fixtures';

/**
 * Регрессия H-N8-UX (закрыта): при шторме одинаковых уведомлений ожидался
 * срыв в 100 DOM-нод. На фактическом коде дедупликация через
 * .notification-counter уже работает — тест проходит. Оставлен как
 * страховка от регрессии (если кто-то отключит counter-схлопывание).
 *
 * Если в Phase 1 агент save-and-notifications-guards меняет порог сжатия —
 * только обновить максимум; сценарий должен остаться зелёным.
 */
test.describe('Notifications storm @smoke', () => {
  test('100 одинаковых notifications.show схлопываются в <=15 DOM-узлов', async ({ page }) => {
    await openAct(page, SEED_ACTS.empty);
    // Notifications загружены глобально через shared/notifications.js на каждой
    // странице портала/конструктора.
    await page.waitForFunction(
      () => typeof (window as unknown as { Notifications?: { show?: unknown } })
        .Notifications?.show === 'function',
      { timeout: 5000 }
    );
    await page.evaluate(() => {
      const N = (window as unknown as {
        Notifications: { show: (m: string, t: string) => void };
      }).Notifications;
      for (let i = 0; i < 100; i++) N.show('Тестовое сообщение', 'info');
    });
    // Даём рендеру стабилизироваться.
    await page.waitForTimeout(200);
    const count = await page.locator('.notification').count();
    expect(count, `DOM-нод .notification после 100 одинаковых show: ${count}`)
      .toBeLessThanOrEqual(15);
  });
});
