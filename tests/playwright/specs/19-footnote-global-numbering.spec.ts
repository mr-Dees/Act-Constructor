import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * Task 7 (TREE-1/CORE-3): сквозная нумерация сносок по всему листу единым
 * проходом на рендере — номера видны сразу после загрузки (без клика в блок),
 * правка сносок в раннем блоке обновляет номера в поздних, а в read-only номера
 * тоже проставляются (раньше — никогда, т.к. нумерация шла только при фокусе).
 */

const SEED_EDITOR = '.textblock-editor[data-text-block-id="txt-seed-1"]';

/** Переходит на шаг 2 и дожидается сид-редактора. */
async function gotoStep2(page) {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.locator('.step[data-step="2"]').click();
  await page.locator(SEED_EDITOR).waitFor({ state: 'visible', timeout: 5000 });
}

test.describe('footnote global numbering (Task 7)', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('номер сноски виден сразу после рендера шага 2, без клика в редактор', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1000 });
    // На шаге 1 внедряем сноску в контент блока — ДО перехода на шаг 2.
    await page.evaluate(() => {
      const tb = (window as any).AppState.textBlocks['txt-seed-1'];
      tb.content =
        'Текст <span class="text-footnote" data-footnote-id="F1"' +
        ' data-footnote-text="прим 1" contenteditable="false">сн</span>.';
    });
    await page.locator('.step[data-step="2"]').click();
    await page.locator(`${SEED_EDITOR} .text-footnote`).waitFor({ state: 'visible', timeout: 5000 });
    // Ни одного клика в редактор — номер уже проставлен глобальным проходом на renderAll.
    const num = await page
      .locator(`${SEED_EDITOR} .text-footnote`)
      .getAttribute('data-footnote-number');
    expect(num).toBe('1');
  });

  test('2 блока: сквозные номера 1 и 2; правка первого блока обновляет номер во втором', async ({ page }) => {
    await gotoStep2(page);
    const res = await page.evaluate(() => {
      const tbm = (window as any).textBlockManager;
      const container = document.getElementById('itemsContainer')!;
      container.innerHTML = ''; // детерминированный порядок: только наши два блока

      const mk = (id: string, body: string) => {
        const tb = { id, nodeId: id, content:
          'X<span class="text-footnote" data-footnote-id="' + id + 'F"' +
          ' data-footnote-text="' + body + '" contenteditable="false">сн</span>' };
        (window as any).AppState.textBlocks[id] = tb;
        const el = tbm.createTextBlockElement(tb, { id });
        container.appendChild(el);
        return el.querySelector('.textblock-editor') as any;
      };

      const edA = mk('tb-a', 'A');
      const edB = mk('tb-b', 'B');

      tbm.renumberAllFootnotes();
      const before = {
        a: edA.querySelector('.text-footnote')!.getAttribute('data-footnote-number'),
        b: edB.querySelector('.text-footnote')!.getAttribute('data-footnote-number'),
        aCache: edA.__lastFootnoteCount,
        bCache: edB.__lastFootnoteCount,
      };

      // Добавляем ВТОРУЮ сноску в начало блока A и гоним единый сток (как create-поток).
      const extra = tbm.createFootnoteMarker('сн0', 'A0');
      edA.insertBefore(extra, edA.firstChild);
      tbm.finalizeEdit(edA, { renumber: true });

      const fA = edA.querySelectorAll('.text-footnote');
      const after = {
        a0: fA[0].getAttribute('data-footnote-number'),
        a1: fA[1].getAttribute('data-footnote-number'),
        b: edB.querySelector('.text-footnote')!.getAttribute('data-footnote-number'),
        aCache: edA.__lastFootnoteCount,
      };
      return { before, after };
    });

    expect(res.before.a).toBe('1');
    expect(res.before.b).toBe('2');
    expect(res.before.aCache).toBe(1);
    expect(res.before.bCache).toBe(1);
    // Блок A теперь с 2 сносками → номер во ВТОРОМ блоке сдвинулся на 3.
    expect(res.after.a0).toBe('1');
    expect(res.after.a1).toBe('2');
    expect(res.after.b).toBe('3');
    expect(res.after.aCache).toBe(2);
  });

  test('read-only: сноски в RO-редакторах получают сквозные номера', async ({ page }) => {
    await gotoStep2(page);
    const res = await page.evaluate(() => {
      const tbm = (window as any).textBlockManager;
      const AppConfig = (window as any).AppConfig;
      const container = document.getElementById('itemsContainer')!;
      container.innerHTML = '';

      const mk = (id: string, body: string) => {
        const tb = { id, nodeId: id, content:
          'Y<span class="text-footnote" data-footnote-id="' + id + 'F"' +
          ' data-footnote-text="' + body + '" contenteditable="false">сн</span>' };
        (window as any).AppState.textBlocks[id] = tb;
        const el = tbm.createTextBlockElement(tb, { id });
        container.appendChild(el);
        return el.querySelector('.textblock-editor') as any;
      };

      AppConfig.readOnlyMode = AppConfig.readOnlyMode || {};
      const prev = AppConfig.readOnlyMode.isReadOnly;
      AppConfig.readOnlyMode.isReadOnly = true; // createEditor построит RO-редакторы
      const edA = mk('ro-a', 'A');
      const edB = mk('ro-b', 'B');
      AppConfig.readOnlyMode.isReadOnly = prev;

      tbm.renumberAllFootnotes();
      return {
        roA: edA.getAttribute('contenteditable'),
        roB: edB.getAttribute('contenteditable'),
        numA: edA.querySelector('.text-footnote')!.getAttribute('data-footnote-number'),
        numB: edB.querySelector('.text-footnote')!.getAttribute('data-footnote-number'),
      };
    });

    expect(res.roA).toBe('false'); // редакторы действительно read-only
    expect(res.roB).toBe('false');
    expect(res.numA).toBe('1'); // номера проставлены В read-only (раньше — никогда)
    expect(res.numB).toBe('2');
  });
});
