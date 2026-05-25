import { test, expect } from '@playwright/test';
import { openAct, SEED_ACTS } from '../fixtures';

/**
 * Редактирование текстового блока на step2.
 *
 * TODO Phase 1: разблокировать после разведки textblock-editor DOM.
 *
 * Сценарий когда заработает:
 * 1. openAct(SEED_ACTS.withContent) → step2
 * 2. найти textblock txt-seed-1, кликнуть в его contenteditable area
 * 3. type "Изменённый текст"
 * 4. assert: save-indicator получает класс unsaved (yellow) или local-only
 *    в течение 200ms
 * 5. подождать debounce ~3s
 * 6. assert: save-indicator класс saved
 * 7. assert: preview panel содержит новый текст (если открыт)
 */
test.describe('Textblock editing @smoke', () => {
  test('правка текстблока меняет save-indicator', async ({ page }) => {
    test.skip(true,
      'TODO: разведка contenteditable textblock-editor (Phase 1)');
    await openAct(page, SEED_ACTS.withContent);
    expect(true).toBe(true);
  });
});
