import { test, expect } from '@playwright/test';
import { openAct, SEED_ACTS, trackConsoleErrors } from '../fixtures';

test.describe('Open existing act @smoke', () => {
  test('загружает конструктор без console-ошибок и рендерит ключевые селекторы', async ({ page }) => {
    const { errors } = trackConsoleErrors(page);

    await openAct(page, SEED_ACTS.empty);

    // step1 (структура акта) — дерево + preview всегда видны.
    // tree-container — класс, не id (см. tree_panel.html); id — у #tree (ul внутри).
    await expect(page.locator('.tree-container')).toBeVisible();
    await expect(page.locator('#tree')).toBeVisible();
    await expect(page.locator('#preview')).toBeVisible();

    // header — <header class="header"> в header.html.
    await expect(page.locator('header.header')).toBeVisible();

    // save-indicator всегда есть; начинает с класса saved.
    const saveBtn = page.locator('#saveIndicatorBtn');
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toHaveClass(/\bsaved\b/);

    // step2 контейнер существует, но скрыт по умолчанию (.hidden).
    await expect(page.locator('#itemsContainer')).toBeAttached();

    // Никаких console.error за время загрузки.
    expect(
      errors,
      `Найдены console.error при загрузке акта:\n${errors.join('\n')}`
    ).toHaveLength(0);
  });
});
