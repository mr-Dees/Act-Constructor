import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * E2E-тесты отката удаления блоков (Б-4): Ctrl+Z и кнопка «Отменить» в toast.
 *
 * Сценарии:
 *  - удалить пункт с таблицей через контекстное меню → Ctrl+Z →
 *    пункт и таблица на месте, нумерация корректна;
 *  - удалить пункт → клик по кнопке «Отменить» в toast → пункт на месте.
 */

/** Добавляет дочерний item-узел через AppState.addNode; возвращает ID нового узла. */
async function addChildViaAppState(page: import('@playwright/test').Page, parentId: string): Promise<string> {
  const newId = await page.evaluate((pid: string) => {
    // @ts-expect-error AppState — глобал из state-core.js
    const result = AppState.addNode(pid, '', true);
    if (!result.valid) throw new Error('addNode failed: ' + result.message);
    // @ts-expect-error
    const parentNode = AppState.findNodeById(pid);
    return parentNode.children[parentNode.children.length - 1].id;
  }, parentId);
  await page.evaluate(() => {
    // @ts-expect-error treeManager — глобал из tree-core.js
    treeManager.render();
  });
  return newId;
}

/** Добавляет таблицу к узлу через AppState; возвращает {nodeId, tableId} узла таблицы. */
async function addTableViaAppState(
  page: import('@playwright/test').Page,
  parentId: string
): Promise<{ nodeId: string; tableId: string }> {
  const ids = await page.evaluate((pid: string) => {
    // @ts-expect-error
    const result = AppState.addTableToNode(pid);
    if (!result.valid) throw new Error('addTableToNode failed: ' + result.message);
    // @ts-expect-error
    const parent = AppState.findNodeById(pid);
    const tableNode = parent.children[parent.children.length - 1];
    return { nodeId: tableNode.id, tableId: tableNode.tableId };
  }, parentId);
  await page.evaluate(() => {
    // @ts-expect-error
    treeManager.render();
  });
  return ids;
}

/** Удаляет узел через контекстное меню: ПКМ → «Удалить» → подтверждение в диалоге. */
async function deleteNodeViaContextMenu(
  page: import('@playwright/test').Page,
  nodeId: string
): Promise<void> {
  const li = page.locator(`li.tree-item[data-node-id="${nodeId}"]`);
  await li.waitFor({ state: 'visible', timeout: 5000 });
  // ПКМ по СОБСТВЕННОЙ метке узла: клик по центру li у раскрытого пункта
  // попадает в дочерний li (вложенный ul) — меню открылось бы не для того узла.
  await li.locator(':scope > .tree-label').click({ button: 'right' });
  await page.locator('#contextMenu').waitFor({ state: 'visible', timeout: 3000 });

  await page.locator('#contextMenu [data-action="delete"]').click();

  const overlay = page.locator('.custom-dialog-overlay.visible').last();
  await overlay.waitFor({ state: 'visible', timeout: 3000 });
  await overlay.locator('.dialog-confirm').click();
  await overlay.waitFor({ state: 'hidden', timeout: 3000 });
  await page.waitForTimeout(200);
}

/** Возвращает number узла из AppState (или null). */
async function getNodeNumber(page: import('@playwright/test').Page, nodeId: string): Promise<string | null> {
  return page.evaluate((nid: string) => {
    // @ts-expect-error
    const node = AppState.findNodeById(nid);
    return node ? node.number ?? null : null;
  }, nodeId);
}

test.describe('Откат удаления блоков (undo-delete) @smoke', () => {
  test('Ctrl+Z восстанавливает удалённый пункт вместе с таблицей и нумерацией', async ({ page }) => {
    await openAct(page, SEED_ACTS.empty);

    // Пункт 5.1 с таблицей внутри
    const itemId = await addChildViaAppState(page, '5');
    const { nodeId: tableNodeId, tableId } = await addTableViaAppState(page, itemId);

    await expect(page.locator(`li.tree-item[data-node-id="${itemId}"]`)).toBeVisible();
    expect(await getNodeNumber(page, itemId)).toBe('5.1');

    // Удаляем пункт через контекстное меню
    await deleteNodeViaContextMenu(page, itemId);
    await expect(page.locator(`li.tree-item[data-node-id="${itemId}"]`)).toHaveCount(0);

    const deletedState = await page.evaluate(
      (ids: { itemId: string; tableId: string }) => ({
        // @ts-expect-error
        nodeExists: !!AppState.findNodeById(ids.itemId),
        // @ts-expect-error
        tableEntryExists: !!AppState.tables[ids.tableId],
      }),
      { itemId, tableId }
    );
    expect(deletedState.nodeExists).toBe(false);
    expect(deletedState.tableEntryExists).toBe(false);

    // Ctrl+Z вне редакторов — откат удаления
    await page.keyboard.press('Control+z');

    // Пункт и таблица вернулись в дерево
    await expect(page.locator(`li.tree-item[data-node-id="${itemId}"]`)).toBeVisible();
    await expect(page.locator(`li.tree-item[data-node-id="${tableNodeId}"]`)).toBeAttached();

    const restoredState = await page.evaluate(
      (ids: { itemId: string; tableNodeId: string; tableId: string }) => {
        // @ts-expect-error
        const item = AppState.findNodeById(ids.itemId);
        // @ts-expect-error
        const tableNode = AppState.findNodeById(ids.tableNodeId);
        return {
          nodeExists: !!item,
          tableNodeExists: !!tableNode,
          tableNodeNumber: tableNode ? tableNode.number : null,
          // @ts-expect-error
          tableEntryExists: !!AppState.tables[ids.tableId],
          // @ts-expect-error
          parentId: AppState.findParentNode(ids.itemId)?.id ?? null,
        };
      },
      { itemId, tableNodeId, tableId }
    );
    expect(restoredState.nodeExists).toBe(true);
    expect(restoredState.tableNodeExists).toBe(true);
    expect(restoredState.tableEntryExists).toBe(true);
    expect(restoredState.parentId).toBe('5');
    expect(restoredState.tableNodeNumber).toBe('Таблица 1');

    // Нумерация пункта восстановлена
    expect(await getNodeNumber(page, itemId)).toBe('5.1');
  });

  test('кнопка «Отменить» в toast восстанавливает удалённый пункт', async ({ page }) => {
    await openAct(page, SEED_ACTS.empty);

    const itemId = await addChildViaAppState(page, '5');
    await expect(page.locator(`li.tree-item[data-node-id="${itemId}"]`)).toBeVisible();

    await deleteNodeViaContextMenu(page, itemId);
    await expect(page.locator(`li.tree-item[data-node-id="${itemId}"]`)).toHaveCount(0);

    // Toast «Элемент удалён» с кнопкой «Отменить»
    const undoButton = page.locator('.notification .notification-action', { hasText: 'Отменить' });
    await undoButton.waitFor({ state: 'visible', timeout: 3000 });
    await undoButton.click();

    // Пункт вернулся, toast скрыт
    await expect(page.locator(`li.tree-item[data-node-id="${itemId}"]`)).toBeVisible();
    expect(await getNodeNumber(page, itemId)).toBe('5.1');
  });
});
