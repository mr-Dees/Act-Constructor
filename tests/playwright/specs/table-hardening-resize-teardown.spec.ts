import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * B6 (table-hardening): слушатели ресайза колонок снимаются при потере фокуса.
 *
 * Если пользователь начал тянуть границу колонки и alt-tab'нул (mouseup так и
 * не пришёл), раньше слушатели mousemove/mouseup утекали на document и
 * следующее взаимодействие вело себя неверно (фантомный ресайз при простом
 * движении мыши). Фикс: window 'blur' (и pointercancel/lostpointercapture)
 * запускают ту же идемпотентную разборку, что и mouseup — фиксируют веса и
 * снимают слушатели.
 *
 * Проверяем: после старта ресайза + blur последующее движение мыши НЕ меняет
 * colWidths (значит mousemove-слушатель снят), и в консоли нет ошибок.
 *
 * SKIP-GUARD: требует поднятого uvicorn + засиженной БД.
 * Включить: RUN_TABLE_HARDENING_E2E=1 npx playwright test table-hardening
 */
const E2E_ENABLED = process.env.RUN_TABLE_HARDENING_E2E === '1';
const TABLE_ID = 'tbl-seed-1';

test.describe('B6 ресайз: разборка слушателей при потере фокуса', () => {
  test.skip(
    !E2E_ENABLED,
    'Требует поднятого uvicorn + засиженной БД; запуск под RUN_TABLE_HARDENING_E2E=1'
  );

  test('blur во время ресайза снимает слушатели и фиксирует веса', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await openAct(page, SEED_ACTS.withContent);
    await page.locator('.step[data-step="2"]').click();

    const tableSection = page.locator(`.table-section[data-table-id="${TABLE_ID}"]`);
    await expect(tableSection).toBeVisible({ timeout: 5000 });

    const readColWidths = () =>
      page.evaluate(
        // @ts-expect-error AppState — глобал
        (id) => window.AppState?.tables?.[id]?.colWidths?.slice() ?? null,
        TABLE_ID
      );

    const handle = page
      .locator(`th[data-table-id="${TABLE_ID}"][data-col="0"] .resize-handle`)
      .first();
    await expect(handle).toBeAttached();
    const box = await handle.boundingBox();
    if (!box) throw new Error('resize-handle без boundingBox');

    // Старт ресайза: mousedown + движение, но БЕЗ mouseup.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 5 });

    // Имитируем alt-tab: window blur → разборка должна снять слушатели и
    // зафиксировать текущие веса (как обычный mouseup).
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));

    // Отпускаем кнопку, чтобы Playwright не висел с зажатой мышью.
    await page.mouse.up();

    const afterBlur = await readColWidths();
    expect(afterBlur).not.toBeNull();

    // Слушатель mousemove снят: дальнейшее движение мыши НЕ меняет веса.
    await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 8 });
    await page.waitForTimeout(100);
    const afterPhantomMove = await readColWidths();
    expect(afterPhantomMove).toEqual(afterBlur);

    // Веса остались целыми и валидными.
    for (const w of afterPhantomMove!) {
      expect(Number.isInteger(w)).toBe(true);
      expect(w).toBeGreaterThan(0);
    }

    expect(errors, `Ошибки в консоли: ${errors.join('\n')}`).toEqual([]);
  });
});
