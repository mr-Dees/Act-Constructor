import { test, expect, openAct, SEED_ACTS } from '../fixtures';

test.describe('Process Mining @smoke', () => {
  test('меню 0 уровня предлагает «Добавить пункт: Process Mining»', async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    const section = page.locator('li.tree-item[data-node-id="4"]');
    await expect(section).toBeVisible();
    await section.click({ button: 'right' });
    const item = page.locator('#contextMenu [data-action="add-sibling"]');
    await expect(item).toContainText('Добавить пункт: Process Mining');
  });

  test('добавление пункта Process Mining создаёт пункт 6', async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    await page.locator('li.tree-item[data-node-id="5"]').click({ button: 'right' });
    await page.locator('#contextMenu [data-action="add-sibling"]').click();
    await expect.poll(() =>
      page.evaluate(() => AppState.treeData.children.some(c => c.special === 'process_mining'))
    ).toBe(true);
  });
});
