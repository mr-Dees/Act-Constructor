import { test, expect } from '@playwright/test';
import { openAct, SEED_ACTS } from '../fixtures';

/**
 * Drag-and-drop узла дерева между секциями.
 *
 * TODO Phase 1: разблокировать после стабилизации фикстур DnD.
 * tree-drag-drop.js использует HTML5 dragstart/drop, но Playwright DnD требует
 * специальной симуляции (page.dragAndDrop ставит точку начала на center и
 * имитирует mousedown/move/up — этого может не хватать для нативного DnD,
 * нужно через DataTransfer).
 *
 * Сценарий когда заработает:
 * 1. openAct(SEED_ACTS.withContent) (есть пункт 2.1 в секции 2)
 * 2. dragAndDrop('[data-node-id="2.1"]', 'li[data-node-id="3"]')
 * 3. assert: пункт 2.1 теперь в дереве как ребёнок секции 3
 * 4. waitForSaveComplete
 */
test.describe('Tree drag-and-drop @smoke', () => {
  test('перенос пункта из секции 2 в секцию 3', async ({ page }) => {
    test.skip(true,
      'TODO: стабилизация HTML5 DnD под Playwright (Phase 1)');
    await openAct(page, SEED_ACTS.withContent);
    expect(page.locator('li.tree-item[data-node-id="2"]')).toBeDefined();
  });
});
