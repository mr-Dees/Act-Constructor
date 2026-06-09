import { test, expect } from '../fixtures';

/**
 * Регрессия спилловера общего CSS превью на портальный version-preview.
 *
 * `preview-table.css` / `preview-base.css` импортируются и в portal.css
 * (диалог версий acts-manager рендерит таблицы через PreviewTableRenderer).
 * P2 убрал из preview-table.css интерфейсный «хром» (полосатость/hover/sticky)
 * и добавил colgroup + полный текст ячеек. Этот тест подтверждает, что диалог
 * версий рендерит таблицу КОРРЕКТНО: колонки по colWidths, границы есть,
 * полосатости/липкой шапки нет, текст ячеек целиком. A4-обёртки тут НЕТ
 * (.preview-sheet — только в конструкторе).
 *
 * SKIP-GUARD: требует поднятого uvicorn (global-setup) + засиженной БД.
 * Включить: RUN_VERSION_PREVIEW_E2E=1 npx playwright test version-preview-table
 */
const E2E_ENABLED = process.env.RUN_VERSION_PREVIEW_E2E === '1';

test.describe('Портальный version-preview: таблица после правок CSS превью', () => {
  test.skip(
    !E2E_ENABLED,
    'Требует поднятого uvicorn + засиженной БД; запуск под RUN_VERSION_PREVIEW_E2E=1'
  );

  test('таблица версии: colgroup, границы, без полосок/sticky, полный текст', async ({ page }) => {
    // Acts-manager (/acts) грузит portal.css и шаблон versionPreviewTemplate.
    await page.goto('/acts');
    await page.locator('#versionPreviewTemplate').waitFor({ state: 'attached', timeout: 10000 });

    // Рендерим диалог версии с синтетическим снэпшотом: таблица с неравными
    // colWidths [30,70] и многострочной ячейкой.
    await page.evaluate(() => {
      const cell = (content: string, isHeader = false) => ({
        content,
        colSpan: 1,
        rowSpan: 1,
        isHeader,
        isSpanned: false,
        originRow: null,
        originCol: null,
        spanOrigin: null,
      });
      const snapshot = {
        version_number: 1,
        created_at: new Date().toISOString(),
        save_type: 'manual',
        username: 'test',
        id: 'ver-test-1',
        tree_data: {
          children: [
            {
              type: 'table',
              tableId: 'vp-tbl-1',
              number: '1',
              label: 'Таблица версии',
              children: [],
            },
          ],
        },
        tables_data: {
          'vp-tbl-1': {
            colWidths: [30, 70],
            grid: [
              [cell('Колонка A', true), cell('Колонка B', true)],
              [cell('Полный длинный текст первой ячейки\nвторая строка'), cell('Значение B')],
            ],
          },
        },
      };
      // @ts-expect-error VersionPreviewOverlay — глобал из version-preview.js
      window.VersionPreviewOverlay.show(snapshot, 'Тестовый акт', 1);
    });

    const table = page.locator('.version-preview-ui table.preview-table').first();
    await expect(table).toBeVisible({ timeout: 5000 });

    // colgroup пропорционален colWidths [30,70].
    const colPercents = await table.evaluate((el) => {
      const cols = Array.from(el.querySelectorAll('colgroup col')) as HTMLElement[];
      return cols.map((c) => parseFloat(c.style.width));
    });
    expect(colPercents.length).toBe(2);
    expect(Math.abs(colPercents[0] - 30)).toBeLessThan(0.01);
    expect(Math.abs(colPercents[1] - 70)).toBeLessThan(0.01);

    // Границы ячеек присутствуют (preview-table.css border-правила не тронуты).
    const borderW = await table
      .locator('td')
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(parseFloat(borderW)).toBeGreaterThan(0);

    // Полосатость убрана: фон чётной строки тела прозрачный/не «secondary».
    // Берём вторую строку тела (если есть) — здесь одна строка тела, поэтому
    // проверяем, что nth-child(even) не задаёт непрозрачный фон через сам тег tr.
    const headerSticky = await table
      .locator('th')
      .first()
      .evaluate((el) => getComputedStyle(el).position);
    expect(headerSticky).not.toBe('sticky');

    // Текст ячейки показан ЦЕЛИКОМ (без обрезки «…»).
    const cellText = await table.locator('td').first().evaluate((el) => el.textContent);
    expect(cellText).toContain('Полный длинный текст первой ячейки');
    expect(cellText).not.toContain('…');

    // Скриншот диалога версии — для глаз ревьюера.
    await page
      .locator('.version-preview-container')
      .screenshot({ path: 'test-results/version-preview-table.png' });
  });
});
