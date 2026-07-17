import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * Регрессионные тесты на focus-management в DialogBase:
 * - role="dialog" + aria-modal="true" автоматически проставлены;
 * - фокус уходит внутрь overlay'а сразу после показа;
 * - Tab циклит по focusable-элементам (focus-trap);
 * - Shift+Tab циклит в обратную сторону;
 * - после закрытия фокус возвращается на ранее активный элемент.
 */
test.describe('Dialog focus trap @smoke', () => {
  test('DialogManager.show: focus уходит внутрь, Tab циклит, фокус восстанавливается', async ({ page }) => {
    await openAct(page, SEED_ACTS.empty);

    // Передаём фокус на известный enabled-элемент в шапке (actsMenuBtn) —
    // стабильный триггер, не зависящий от статуса сохранности акта.
    const trigger = page.locator('#actsMenuBtn');
    await trigger.focus();
    await expect(trigger).toBeFocused();

    // Открываем диалог через глобальный DialogManager. Резолв await'им снаружи —
    // нам нужно состояние пока диалог открыт, поэтому Promise сохраняем в window.
    await page.evaluate(() => {
      // @ts-ignore — DialogManager публикуется в window.
      (window as any).__dialogResultPromise = window.DialogManager.show({
        title: 'Focus-trap тест',
        message: 'Проверка trap'
      });
    });

    // Ждём появления overlay'а в DOM и анимации (.visible выставляется в _showDialog).
    const overlay = page.locator('.custom-dialog-overlay.visible').last();
    await overlay.waitFor({ state: 'visible', timeout: 2000 });

    // ARIA-маркеры модального диалога.
    await expect(overlay).toHaveAttribute('role', 'dialog');
    await expect(overlay).toHaveAttribute('aria-modal', 'true');
    await expect(overlay).toHaveAttribute('aria-labelledby', /dialog-title-/);

    // Фокус — на первом focusable внутри overlay'а (обычно «Отмена»).
    // _showDialog отдаёт фокус через setTimeout(0), даём микротакту отработать.
    await page.waitForFunction(() => {
      const ov = document.querySelector('.custom-dialog-overlay.visible');
      return ov && ov.contains(document.activeElement);
    }, undefined, { timeout: 2000 });

    const cancelBtn = overlay.locator('.dialog-cancel');
    const confirmBtn = overlay.locator('.dialog-confirm');
    await expect(cancelBtn).toBeFocused();

    // Tab — переход на следующий focusable (confirm).
    await page.keyboard.press('Tab');
    await expect(confirmBtn).toBeFocused();

    // Tab на последнем focusable должен зациклить на первый (focus-trap).
    await page.keyboard.press('Tab');
    await expect(cancelBtn).toBeFocused();

    // Shift+Tab на первом — на последний.
    await page.keyboard.press('Shift+Tab');
    await expect(confirmBtn).toBeFocused();

    // Закрываем диалог Esc — ожидаем, что фокус вернётся на исходный триггер (actsMenuBtn).
    await page.keyboard.press('Escape');

    // Дожидаемся резолва промиса (закрытие диалога завершено).
    await page.evaluate(async () => {
      // @ts-ignore
      await (window as any).__dialogResultPromise;
    });

    // _hideDialog возвращает фокус через setTimeout(closeDelay ~300ms) — ждём.
    await expect(trigger).toBeFocused({ timeout: 2000 });
  });
});
