import { test, expect } from '@playwright/test';
import { openAct, SEED_ACTS } from '../fixtures';

/**
 * Операции с ячейками таблицы: merge/unmerge/insertRow/insertCol через
 * контекстное меню.
 *
 * TODO Phase 1: разблокировать после разведки context-menu для step2-таблиц.
 * Селекторы и порядок действий (right-click → choose item → re-find cell)
 * требуют итеративной отладки в реальной странице, не подходит для
 * первоначального baseline-набора.
 *
 * Сценарий когда заработает:
 * 1. openAct(SEED_ACTS.withContent) → step2 → найти таблицу tbl-seed-1
 * 2. выделить ячейки [0,0]+[0,1], right-click → "Объединить ячейки"
 * 3. assert: одна ячейка с colspan=2
 * 4. right-click на merged → "Разъединить" → assert: две ячейки снова
 * 5. right-click → "Вставить строку выше" → assert: rows.length+1
 * 6. right-click → "Вставить столбец слева" → assert: cols.length+1
 */
test.describe('Table cell operations @smoke', () => {
  test('merge/unmerge cells через context-menu', async ({ page }) => {
    test.skip(true,
      'TODO: требует разведки context-menu для step2-таблиц (Phase 1)');
    await openAct(page, SEED_ACTS.withContent);
    expect(true).toBe(true);
  });
});
