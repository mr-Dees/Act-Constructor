import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * E2E-тесты на удаление таблиц рисков и каскадное поведение сводных таблиц.
 *
 * Предусловия для всех тестов:
 *  - Акт SEED_ACTS.empty — процессная проверка, 5 пустых защищённых секций.
 *  - Все взаимодействия с деревом идут через контекстное меню (`contextmenu` на li.tree-item).
 *  - Узлы добавляются через AppState, дерево перерисовывается; проверяем
 *    появление/исчезновение узлов по `data-node-id`.
 *
 * Вспомогательные операции:
 *  - addChildViaAppState(page, parentId) — добавляет item-подпункт через AppState.addNode.
 *  - addRiskTableViaContextMenu(page, nodeId, action) — ПКМ на узле → выбрать пункт меню.
 *  - deleteNodeViaContextMenu(page, nodeId) — ПКМ → «Удалить» → подтвердить диалог.
 */

/** Добавляет дочерний item-узел через AppState.addNode; возвращает ID нового узла. */
async function addChildViaAppState(page: import('@playwright/test').Page, parentId: string): Promise<string> {
  const newId = await page.evaluate((pid: string) => {
    // @ts-expect-error AppState — глобал из state-core.js
    const result = AppState.addNode(pid, '', true);
    if (!result.valid) throw new Error('addNode failed: ' + result.message);
    // @ts-expect-error
    const parentNode = AppState.findNodeById(pid);
    if (!parentNode || !parentNode.children || parentNode.children.length === 0) {
      throw new Error('addNode: у родителя нет детей после добавления');
    }
    return parentNode.children[parentNode.children.length - 1].id;
  }, parentId);
  // Перерисовываем дерево после изменения AppState
  await page.evaluate(() => {
    // @ts-expect-error treeManager — глобал из app.js
    treeManager.render();
  });
  return newId;
}

/** Открывает контекстное меню узла по data-node-id. */
async function openContextMenu(page: import('@playwright/test').Page, nodeId: string) {
  const li = page.locator(`li.tree-item[data-node-id="${nodeId}"]`);
  await li.waitFor({ state: 'visible', timeout: 5000 });
  await li.click({ button: 'right' });
  await page.locator('#contextMenu').waitFor({ state: 'visible', timeout: 3000 });
}

/** Нажимает пункт контекстного меню по data-action. */
async function clickContextMenuItem(page: import('@playwright/test').Page, action: string) {
  const item = page.locator(`#contextMenu [data-action="${action}"]`);
  await expect(item).toBeVisible({ timeout: 2000 });
  await item.click();
}

/**
 * Добавляет риск-таблицу через контекстное меню узла.
 * action — один из: add-regular-risk-table, add-operational-risk-table,
 * add-tax-risk-table, add-other-risk-table.
 */
async function addRiskTableViaContextMenu(
  page: import('@playwright/test').Page,
  nodeId: string,
  action: string
): Promise<void> {
  await openContextMenu(page, nodeId);
  await clickContextMenuItem(page, action);
  // Даём дереву отрисоваться
  await page.waitForTimeout(200);
}

/**
 * Удаляет узел через контекстное меню: ПКМ → «Удалить» → подтверждение в диалоге.
 * Возвращает текст сообщения диалога, чтобы сценарии могли его проверить.
 */
async function deleteNodeViaContextMenu(
  page: import('@playwright/test').Page,
  nodeId: string
): Promise<string> {
  await openContextMenu(page, nodeId);
  await clickContextMenuItem(page, 'delete');

  // Диалог подтверждения появился
  const overlay = page.locator('.custom-dialog-overlay.visible').last();
  await overlay.waitFor({ state: 'visible', timeout: 3000 });

  // Читаем текст сообщения перед подтверждением
  const messageText = await overlay.locator('.dialog-message').innerText();

  // Нажимаем «Удалить» (confirmText = 'Удалить' в handleDelete)
  await overlay.locator('.dialog-confirm').click();

  // Ждём закрытия диалога
  await overlay.waitFor({ state: 'hidden', timeout: 3000 });
  await page.waitForTimeout(200);

  return messageText;
}

/**
 * Находит ID первого риск-таблицного дочернего узла у заданного parentId.
 * Возвращает null если риск-таблицы нет.
 */
async function findRiskTableChildId(
  page: import('@playwright/test').Page,
  parentId: string
): Promise<string | null> {
  return page.evaluate((pid: string) => {
    // @ts-expect-error AppState — глобал
    const parent = AppState.findNodeById(pid);
    if (!parent?.children) return null;
    // @ts-expect-error AppConfig — глобал
    const tableType = AppConfig.nodeTypes.TABLE;
    const riskChild = parent.children.find((c: any) =>
      c.type === tableType &&
      (c.isRegularRiskTable || c.isOperationalRiskTable || c.isTaxRiskTable || c.isOtherRiskTable)
    );
    return riskChild ? riskChild.id : null;
  }, parentId);
}

/**
 * Возвращает количество risk-таблиц в поддереве §5 через AppState.
 */
async function countRiskTablesInSection5(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    // @ts-expect-error
    const node5 = AppState.findNodeById('5');
    if (!node5) return 0;
    // @ts-expect-error
    return AppState._findRiskTablesInSubtree(node5).length;
  });
}

/**
 * Проверяет, есть ли в §5 главная сводная таблица (isMainMetricsTable).
 */
async function hasMainSvod(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    // @ts-expect-error
    const node5 = AppState.findNodeById('5');
    if (!node5?.children) return false;
    // @ts-expect-error
    const tableType = AppConfig.nodeTypes.TABLE;
    return node5.children.some((c: any) => c.type === tableType && c.isMainMetricsTable === true);
  });
}

/**
 * Проверяет, есть ли per-point сводная таблица (isMetricsTable) среди детей узла с данным id.
 */
async function hasPerPointSvod(page: import('@playwright/test').Page, nodeId: string): Promise<boolean> {
  return page.evaluate((nid: string) => {
    // @ts-expect-error
    const node = AppState.findNodeById(nid);
    if (!node?.children) return false;
    // @ts-expect-error
    const tableType = AppConfig.nodeTypes.TABLE;
    return node.children.some((c: any) => c.type === tableType && c.isMetricsTable === true);
  }, nodeId);
}

test.describe('Удаление таблиц рисков @smoke', () => {
  // ----- Сценарий 1: каждый из 4 типов можно удалить -----

  const riskTypeTests: Array<{title: string; action: string}> = [
    {title: 'регуляторный риск (regular)',   action: 'add-regular-risk-table'},
    {title: 'операционный риск (operational)', action: 'add-operational-risk-table'},
    {title: 'налоговый риск (tax)',           action: 'add-tax-risk-table'},
    {title: 'прочий риск (other)',             action: 'add-other-risk-table'},
  ];

  for (const {title, action} of riskTypeTests) {
    test(`удаление таблицы: ${title}`, async ({ page }) => {
      await openAct(page, SEED_ACTS.empty);

      // Создаём пункт 5.1 под §5
      const item51Id = await addChildViaAppState(page, '5');
      // Дождаться рендера li
      await page.locator(`li.tree-item[data-node-id="${item51Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

      // Добавляем риск-таблицу через контекстное меню
      await addRiskTableViaContextMenu(page, item51Id, action);

      // Убеждаемся, что риск-таблица появилась в AppState
      const riskId = await findRiskTableChildId(page, item51Id);
      expect(riskId, `риск-таблица (${title}) должна появиться как дочерний узел`).not.toBeNull();
      expect(riskId).toBeTruthy();

      // li риск-таблицы должен быть в DOM
      await expect(page.locator(`li.tree-item[data-node-id="${riskId}"]`)).toBeVisible();

      // Удаляем через контекстное меню → диалог → подтверждение
      await deleteNodeViaContextMenu(page, riskId!);

      // После удаления узел исчез из DOM
      await expect(page.locator(`li.tree-item[data-node-id="${riskId}"]`)).toHaveCount(0);

      // И из AppState
      const remaining = await countRiskTablesInSection5(page);
      expect(remaining).toBe(0);
    });
  }

  // ----- Сценарий 2: свод остаётся пока на уровне есть другой риск -----

  test('свод остаётся при наличии второй риск-таблицы на уровне', async ({ page }) => {
    await openAct(page, SEED_ACTS.empty);

    // Добавляем пункт 5.1 и два подпункта 5.1.1, 5.1.2
    const item51Id = await addChildViaAppState(page, '5');
    await page.locator(`li.tree-item[data-node-id="${item51Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    const item511Id = await addChildViaAppState(page, item51Id);
    await page.locator(`li.tree-item[data-node-id="${item511Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    const item512Id = await addChildViaAppState(page, item51Id);
    await page.locator(`li.tree-item[data-node-id="${item512Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    // Добавляем риск-таблицы на оба подпункта
    await addRiskTableViaContextMenu(page, item511Id, 'add-regular-risk-table');
    await addRiskTableViaContextMenu(page, item512Id, 'add-regular-risk-table');

    // После добавления двух рисков — должны появиться per-point и главная сводная
    const perPointBefore = await hasPerPointSvod(page, item51Id);
    const mainBefore = await hasMainSvod(page);
    expect(perPointBefore, 'per-point свод должен появиться после добавления рисков').toBe(true);
    expect(mainBefore, 'главная сводная должна появиться после добавления рисков').toBe(true);

    // Удаляем ОДИН из двух рисков
    const riskId511 = await findRiskTableChildId(page, item511Id);
    expect(riskId511).toBeTruthy();
    await deleteNodeViaContextMenu(page, riskId511!);

    // Свод не исчез, потому что 5.1.2 ещё содержит риск
    const perPointAfter = await hasPerPointSvod(page, item51Id);
    const mainAfter = await hasMainSvod(page);
    expect(perPointAfter, 'per-point свод должен остаться — остался риск на 5.1.2').toBe(true);
    expect(mainAfter, 'главная сводная должна остаться — остался риск в §5').toBe(true);
  });

  // ----- Сценарий 3: свод исчезает при удалении последнего риска -----

  test('свод исчезает при удалении последнего риска на уровне', async ({ page }) => {
    await openAct(page, SEED_ACTS.empty);

    // Добавляем пункт 5.1 и подпункт 5.1.1
    const item51Id = await addChildViaAppState(page, '5');
    await page.locator(`li.tree-item[data-node-id="${item51Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    const item511Id = await addChildViaAppState(page, item51Id);
    await page.locator(`li.tree-item[data-node-id="${item511Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    // Добавляем единственную риск-таблицу
    await addRiskTableViaContextMenu(page, item511Id, 'add-regular-risk-table');

    // Сводные таблицы появились
    expect(await hasPerPointSvod(page, item51Id), 'per-point свод должен появиться').toBe(true);
    expect(await hasMainSvod(page), 'главная сводная должна появиться').toBe(true);

    // Удаляем единственный риск
    const riskId = await findRiskTableChildId(page, item511Id);
    expect(riskId).toBeTruthy();
    await deleteNodeViaContextMenu(page, riskId!);

    // Оба свода исчезли
    expect(await hasPerPointSvod(page, item51Id), 'per-point свод должен исчезнуть').toBe(false);
    expect(await hasMainSvod(page), 'главная сводная должна исчезнуть').toBe(false);

    // В §5 не осталось ни одной риск-таблицы
    expect(await countRiskTablesInSection5(page)).toBe(0);
  });

  // ----- Сценарий 4: прочий риск создаёт и держит свод -----

  test('прочий риск создаёт свод и его удаление убирает свод', async ({ page }) => {
    await openAct(page, SEED_ACTS.empty);

    const item51Id = await addChildViaAppState(page, '5');
    await page.locator(`li.tree-item[data-node-id="${item51Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    const item511Id = await addChildViaAppState(page, item51Id);
    await page.locator(`li.tree-item[data-node-id="${item511Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    // Добавляем «прочий» риск — единственный на уровне
    await addRiskTableViaContextMenu(page, item511Id, 'add-other-risk-table');

    // Свод создан
    expect(await hasPerPointSvod(page, item51Id), 'per-point свод должен появиться для прочего риска').toBe(true);
    expect(await hasMainSvod(page), 'главная сводная должна появиться для прочего риска').toBe(true);

    // Удаляем единственный «прочий» риск
    const riskId = await findRiskTableChildId(page, item511Id);
    expect(riskId).toBeTruthy();
    await deleteNodeViaContextMenu(page, riskId!);

    // Свод исчез
    expect(await hasPerPointSvod(page, item51Id), 'per-point свод должен исчезнуть').toBe(false);
    expect(await hasMainSvod(page), 'главная сводная должна исчезнуть').toBe(false);
  });

  // ----- Сценарий 5: перетаскивание риск-таблицы заблокировано -----

  test('перетаскивание риск-таблицы не перемещает узел', async ({ page }) => {
    await openAct(page, SEED_ACTS.empty);

    const item51Id = await addChildViaAppState(page, '5');
    await page.locator(`li.tree-item[data-node-id="${item51Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    // Добавляем второй пункт 5.2
    const item52Id = await addChildViaAppState(page, '5');
    await page.locator(`li.tree-item[data-node-id="${item52Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    // Добавляем риск-таблицу на 5.1
    await addRiskTableViaContextMenu(page, item51Id, 'add-regular-risk-table');
    const riskId = await findRiskTableChildId(page, item51Id);
    expect(riskId).toBeTruthy();

    await page.locator(`li.tree-item[data-node-id="${riskId}"]`).waitFor({ state: 'visible', timeout: 5000 });

    // Симулируем DnD риск-таблицы на 5.2 — должно быть заблокировано
    await page.evaluate(async (ids: {riskId: string; tgtId: string}) => {
      const src = document.querySelector(
        `li.tree-item[data-node-id="${ids.riskId}"]`
      ) as HTMLElement;
      const tgt = document.querySelector(
        `li.tree-item[data-node-id="${ids.tgtId}"]`
      ) as HTMLElement;
      if (!src || !tgt) throw new Error('узлы не найдены');

      const tgtLabel = (tgt.querySelector('.tree-label') as HTMLElement) || tgt;
      const tgtRect = tgtLabel.getBoundingClientRect();
      const midX = tgtRect.left + tgtRect.width / 2;
      const midY = tgtRect.top + tgtRect.height / 2;

      const dt = new DataTransfer();
      function fire(el: HTMLElement, type: string, x: number, y: number) {
        el.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
        }));
      }
      const srcRect = src.getBoundingClientRect();
      fire(src, 'dragstart', srcRect.left + 10, srcRect.top + 10);
      await new Promise(r => setTimeout(r, 50));
      fire(tgt, 'dragenter', midX, midY);
      fire(tgt, 'dragover', midX, midY);
      await new Promise(r => setTimeout(r, 50));
      fire(tgt, 'drop', midX, midY);
      fire(src, 'dragend', midX, midY);
      await new Promise(r => setTimeout(r, 200));
    }, {riskId: riskId!, tgtId: item52Id});

    // Риск-таблица по-прежнему является дочерней для item51 — не переехала
    const parentAfterDnd = await page.evaluate((rid: string) => {
      // @ts-expect-error
      const parent = AppState.findParentNode(rid);
      return parent ? parent.id : null;
    }, riskId!);
    expect(parentAfterDnd, 'риск-таблица не должна переехать при DnD').toBe(item51Id);
  });

  // ----- Сценарий 6: структура ячеек риск-таблицы залочена -----

  test('контекстное меню ячейки риск-таблицы: insert-col и merge заблокированы', async ({ page }) => {
    await openAct(page, SEED_ACTS.empty);
    // Переходим на step2 (редактор содержимого) — там доступны ячейки таблицы
    // Step1 → step2: нажать на step2 в nav (или кликнуть пункт дерева с table-узлом)
    const item51Id = await addChildViaAppState(page, '5');
    await page.locator(`li.tree-item[data-node-id="${item51Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    await addRiskTableViaContextMenu(page, item51Id, 'add-regular-risk-table');
    const riskId = await findRiskTableChildId(page, item51Id);
    expect(riskId).toBeTruthy();

    // Получаем tableId для риск-таблицы
    const tableId = await page.evaluate((nid: string) => {
      // @ts-expect-error
      const node = AppState.findNodeById(nid);
      return node?.tableId ?? null;
    }, riskId!);
    expect(tableId).toBeTruthy();

    // Переходим на step2, кликая по item51 в шаге 1
    await page.locator('.step[data-step="2"]').click();

    // Ждём, пока table-section с этим tableId появится
    const tableSection = page.locator(`.table-section[data-table-id="${tableId}"]`);
    await tableSection.waitFor({ state: 'visible', timeout: 5000 });

    // Кликаем по первой ячейке таблицы
    const firstCell = tableSection.locator('td, th').first();
    await firstCell.click();

    // ПКМ на той же ячейке → cellContextMenu
    await firstCell.click({ button: 'right' });
    const cellMenu = page.locator('#cellContextMenu');
    await cellMenu.waitFor({ state: 'visible', timeout: 3000 });

    // Проверяем что insert-col и merge заблокированы (класс disabled)
    await expect(cellMenu.locator('[data-action="insert-col-left"]')).toHaveClass(/\bdisabled\b/);
    await expect(cellMenu.locator('[data-action="insert-col-right"]')).toHaveClass(/\bdisabled\b/);
    await expect(cellMenu.locator('[data-action="delete-col"]')).toHaveClass(/\bdisabled\b/);
    await expect(cellMenu.locator('[data-action="merge-cells"]')).toHaveClass(/\bdisabled\b/);
  });

  // ----- Сценарий 7: диалог удаления последнего риска содержит предупреждение о своде -----

  test('диалог удаления последнего риска содержит упоминание сводной таблицы', async ({ page }) => {
    await openAct(page, SEED_ACTS.empty);

    const item51Id = await addChildViaAppState(page, '5');
    await page.locator(`li.tree-item[data-node-id="${item51Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    const item511Id = await addChildViaAppState(page, item51Id);
    await page.locator(`li.tree-item[data-node-id="${item511Id}"]`).waitFor({ state: 'visible', timeout: 5000 });

    // Добавляем единственную риск-таблицу (последний риск → диалог должен предупредить)
    await addRiskTableViaContextMenu(page, item511Id, 'add-regular-risk-table');
    const riskId = await findRiskTableChildId(page, item511Id);
    expect(riskId).toBeTruthy();

    // Открываем контекстное меню и «Удалить»
    await openContextMenu(page, riskId!);
    await clickContextMenuItem(page, 'delete');

    // Диалог появился
    const overlay = page.locator('.custom-dialog-overlay.visible').last();
    await overlay.waitFor({ state: 'visible', timeout: 3000 });

    const messageText = await overlay.locator('.dialog-message').innerText();
    expect(
      messageText.toLowerCase(),
      'диалог должен содержать слова «сводная таблица»'
    ).toContain('сводная таблица');

    // Отменяем удаление (не подтверждаем)
    await overlay.locator('.dialog-cancel').click();
    await overlay.waitFor({ state: 'hidden', timeout: 3000 });

    // Риск-таблица всё ещё на месте
    await expect(page.locator(`li.tree-item[data-node-id="${riskId}"]`)).toBeVisible();
  });
});
