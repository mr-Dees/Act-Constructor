import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * Drag-and-drop узла дерева между секциями.
 *
 * tree-drag-drop.js использует HTML5 dragstart/drop. Playwright `page.dragAndDrop`
 * не всегда триггерит ListenerOptions{passive}-handler'ы; через MCP проверено
 * что `dispatchEvent(new DragEvent(...))` с общим DataTransfer и реальными
 * clientX/Y координатами **работает** — drop переезжает узел 2.1 в секцию 3.
 *
 * DOM-flow:
 *  - source: `li.tree-item[data-node-id="2.1"]`
 *  - target: `li.tree-item[data-node-id="3"]`
 *  - `_calculateDropPosition`: relativeY от `.tree-label` определяет
 *    before / after / child. Среднее (~50%) → 'child' если canAcceptAsChild.
 *  - После drop: AppState.findParentNode('2.1').id === '3'.
 */
test.describe('Tree drag-and-drop @smoke', () => {
  test('перенос пункта 2.1 в секцию 3', async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    // DnD на step1 (дерево).
    await expect(page.locator('li.tree-item[data-node-id="2.1"]')).toBeVisible();
    await expect(page.locator('li.tree-item[data-node-id="3"]')).toBeVisible();

    // Симулируем DnD через DataTransfer-эвенты внутри page.evaluate.
    // page.dragAndDrop не всегда срабатывает с HTML5-DnD (mouse-based вместо
    // нативного DragEvent), DataTransfer-путь стабильнее.
    await page.evaluate(async () => {
      const src = document.querySelector(
        'li.tree-item[data-node-id="2.1"]'
      ) as HTMLElement;
      const tgt = document.querySelector(
        'li.tree-item[data-node-id="3"]'
      ) as HTMLElement;
      if (!src || !tgt) throw new Error('seed nodes not found');

      const tgtLabel =
        (tgt.querySelector('.tree-label') as HTMLElement) || tgt;
      const tgtRect = tgtLabel.getBoundingClientRect();
      const midX = tgtRect.left + tgtRect.width / 2;
      const midY = tgtRect.top + tgtRect.height / 2;

      const dt = new DataTransfer();
      function fire(el: HTMLElement, type: string, x: number, y: number) {
        el.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
            clientX: x,
            clientY: y,
          })
        );
      }
      const srcRect = src.getBoundingClientRect();
      fire(src, 'dragstart', srcRect.left + 10, srcRect.top + 10);
      // setTimeout(0) в handleDragStart выставляет opacity — даём ему время
      await new Promise((r) => setTimeout(r, 50));
      fire(tgt, 'dragenter', midX, midY);
      fire(tgt, 'dragover', midX, midY);
      await new Promise((r) => setTimeout(r, 50));
      fire(tgt, 'drop', midX, midY);
      fire(src, 'dragend', midX, midY);
      await new Promise((r) => setTimeout(r, 200));
    });

    // Ждём пока AppState обновится (poll-based).
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-expect-error AppState — глобал из state-core.js
              (AppState.findParentNode('2.1') as { id: string } | null)?.id ??
              null
          ),
        { timeout: 5000 }
      )
      .toBe('3');
  });
});
