import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * E2E: копирование и вставка таблиц рисков через NodeClipboard.
 *
 * Проверяем два ключевых правила:
 *  1. Вставка risk-узла в другой пункт §5 сохраняет kind-несущего потомка.
 *  2. Вставка risk-узла в секцию вне §5 (например «4») отбрасывается.
 *
 * Вся логика — через page.evaluate (AppState / NodeClipboard глобалы),
 * по образцу 04-tree-dnd.spec.ts. Сервер и seed (SEED_ACTS.withContent)
 * должны быть доступны; при отсутствии соединения тест упадёт с ошибкой
 * навигации, а не с assertion — это ожидаемо (deliverable = spec-файл).
 */
test.describe('Risk paste @smoke', () => {
  test('риск сохраняется в §5 и отбрасывается вне §5', async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);

    const result = await page.evaluate(() => {
      // Добавляем пункт 5.1 под §5 и создаём на нём риск-таблицу.
      // @ts-expect-error AppState — глобал из state-core.js
      AppState.addNode('5', 'П1', true);
      // @ts-expect-error
      const p1 = AppState.findNodeById('5').children.at(-1);
      // @ts-expect-error
      AppState._createRegularRiskTable(p1.id);
      // @ts-expect-error
      MetricsRiskCoordinator.onRiskTableAdded(p1.id);
      // @ts-expect-error
      AppState.generateNumbering();

      // Находим созданный risk-узел (первый потомок с .kind).
      // @ts-expect-error
      const risk = AppState.findNodeById(p1.id).children.find((c: any) => c.kind);
      if (!risk) return { error: 'no risk node found' };

      // Копируем риск-узел в буфер.
      // @ts-expect-error
      const copied = NodeClipboard.copyNode(risk.id);
      if (!copied) return { error: 'copyNode returned false' };

      // ── Кейс 1: вставка в другой пункт §5 ──
      // @ts-expect-error
      AppState.addNode('5', 'П2', true);
      // @ts-expect-error
      const p2 = AppState.findNodeById('5').children.at(-1);
      // @ts-expect-error
      const into5 = NodeClipboard.pasteInto(p2.id);
      // @ts-expect-error
      const keptIn5 = AppState.findNodeById(p2.id).children.some(
        (c: any) => c.kind && c.kind.endsWith('Risk')
      );

      // ── Кейс 2: вставка вне §5 (в секцию 4) ──
      // @ts-expect-error
      const before4 = AppState.findNodeById('4').children.length;
      // @ts-expect-error
      const into4 = NodeClipboard.pasteInto('4');
      // @ts-expect-error
      const after4 = AppState.findNodeById('4').children.length;

      return { into5, keptIn5, into4, grew4: after4 - before4 };
    });

    // copyNode должен успешно скопировать, иначе тест не имеет смысла.
    if (typeof result === 'object' && result !== null && 'error' in result) {
      throw new Error(`page.evaluate error: ${(result as any).error}`);
    }

    const r = result as { into5: boolean; keptIn5: boolean; into4: boolean; grew4: number };

    // Вставка в §5 должна вернуть true и сохранить risk-потомка.
    expect(r.into5, 'pasteInto §5 должен вернуть true').toBe(true);
    expect(r.keptIn5, 'risk-таблица должна остаться в §5-пункте после вставки').toBe(true);

    // Вставка вне §5 должна быть отклонена.
    expect(r.into4, 'pasteInto §4 должен вернуть false').toBe(false);
    expect(r.grew4, 'дочерний счётчик §4 не должен вырасти').toBe(0);
  });
});
