import { test, expect } from '@playwright/test';
import { openAct, SEED_ACTS } from '../fixtures';

/**
 * Регрессия H5-A: при Ctrl+S во время редактирования ячейки (с активным
 * фокусом, без blur) изменения теряются — flush на blur не успевает
 * сериализоваться до начала сохранения.
 *
 * Сейчас test.fail — фиксируем поведение БАГА. После агента
 * per-node-rendering-api убрать .fail() и сценарий должен пройти.
 *
 * TODO Phase 1: разведать как корректно сфокусироваться в ячейке таблицы
 * step2 для inline-edit. Сейчас скелет — после разведки DOM наполнить шаги.
 */
test.describe('Ctrl+S during edit @smoke', () => {
  test('Ctrl+S во время редактирования ячейки сохраняет значение после reload',
    async ({ page }) => {
      test.skip(true,
        'TODO: разведка inline-edit ячейки таблицы (Phase 1). После — снять '
        + 'skip и оставить только test.fail для документации H5-A.');
      await openAct(page, SEED_ACTS.withContent);
      expect(true).toBe(true);
    });
});
