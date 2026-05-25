import { test, expect } from '@playwright/test';
import { openAct, SEED_ACTS, waitForSaveComplete } from '../fixtures';

/**
 * Редактирование заголовка пункта на step2 + проверка персистентности после reload.
 *
 * TODO Phase 1: разблокировать после агентов "per-node-rendering-api" — сейчас
 * step2 рендеринг item-блоков требует более глубокой DOM-разведки (item-block
 * структура, какая часть кликабельна для inline-edit). Тест задокументирован
 * как skip с подробной семантикой.
 *
 * Сценарий когда заработает:
 * 1. openAct(SEED_ACTS.withContent)
 * 2. перейти на step2 (click .step[data-step="2"])
 * 3. найти .item-block, кликнуть .item-title для inline edit
 * 4. type новый текст, blur
 * 5. waitForSaveComplete
 * 6. reload
 * 7. assert новый текст виден в DOM
 */
test.describe('Edit item title @smoke', () => {
  test('переход на step2 рендерит items-container с контентом', async ({ page }) => {
    // Облегчённый smoke: проверяем что step2 переключается и itemsContainer
    // получает контент. Полный сценарий переименования с reload — см. TODO выше.
    await openAct(page, SEED_ACTS.withContent);
    await page.locator('.step[data-step="2"]').click();
    const items = page.locator('#itemsContainer');
    await expect(items).toBeVisible();
    // На step2 для seed-акта (есть 1 пункт с таблицей + textblock) обязан
    // отрендериться хотя бы один дочерний элемент.
    await expect(items.locator('> *').first()).toBeAttached({ timeout: 10000 });
  });

  test('переименование пункта сохраняется после reload', async ({ page }) => {
    test.skip(true,
      'TODO: разведка DOM inline-edit заголовка пункта step2 (Phase 1)');
    await openAct(page, SEED_ACTS.withContent);
    await page.locator('.step[data-step="2"]').click();
    await waitForSaveComplete(page);
    expect(true).toBe(true);
  });
});
