import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * Task D — «Вся капсула как юнит»: капсула (ссылка/сноска) ведёт себя как единый
 * атом при удалении, выделении и Shift-навигации.
 *
 * Проверяем против РЕАЛЬНОЙ реализации:
 *  - textblock-capsule-integrity.js: handleEditorBeforeInput (ветки (а)/(в)),
 *    _rangeIsWholeCapsule, _deleteCapsuleWhole, _execDeleteRange (undo-стек);
 *  - textblock-editor.js: _handleCapsuleShiftArrow (снаппинг), handleSelectionChange
 *    / _updateNodeSelectedState (.node-selected), handleEditorBlur (снятие класса).
 *
 * Trusted-ввод: наши удаления зовут document.execCommand('delete') ВНУТРИ
 * beforeinput-обработчика — это работает только из настоящего пользовательского
 * жеста, поэтому Backspace/Delete/undo гоняем через page.keyboard.press (реальные,
 * доверенные события), а каретку/выделение выставляем через Range API в evaluate.
 */

const EDITOR_SEL = '.textblock-editor[data-text-block-id="txt-seed-1"]';
const GUARD = '﻿';

/**
 * Шаг 2, сид-редактор активен, в нём капсула-ссылка СРЕДИ текста ('до <cap> после').
 * Капсула не edge-овая → normalizeMarkers guard'ов вокруг неё не ставит.
 * activeEditor проставляем явно (как 16/17), редактор фокусируем.
 */
async function focusSeededTextblockWithCapsule(page) {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.locator('.step[data-step="2"]').click();
  await page.locator(EDITOR_SEL).waitFor({ state: 'visible', timeout: 5000 });
  await page.locator(EDITOR_SEL).click();
  await page.evaluate(() => {
    const ed = document.querySelector(
      '.textblock-editor[data-text-block-id="txt-seed-1"]',
    ) as HTMLElement;
    const tbm = (window as any).textBlockManager;
    tbm.activeEditor = ed;
    ed.innerHTML =
      'до ' +
      '<span class="text-link" data-link-id="cap1" data-link-url="https://a.ru"' +
      ' contenteditable="false">ссылка</span>' +
      ' после';
    tbm.attachLinkFootnoteHandlers();
    ed.focus();
  });
}

/** Снимок капсулы-ссылки txt-seed-1 из живого DOM. */
async function linkState(page) {
  return await page.evaluate(() => {
    const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
    const cap = ed ? ed.querySelector('.text-link') : null;
    return {
      alive: !!cap,
      url: cap ? cap.getAttribute('data-link-url') : null,
      text: ed ? ed.textContent!.replace(/[﻿​]/g, '') : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Behavior 1 (HIGH): примыкающее Backspace/Delete удаляет капсулу ЦЕЛИКОМ,
// удаление остаётся в undo-стеке (execCommand('delete')) → Ctrl+Z восстанавливает.
// ---------------------------------------------------------------------------

test.describe('capsule-whole-unit: примыкающее удаление + undo', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('Backspace вплотную СПРАВА от капсулы удаляет её целиком; Ctrl+Z восстанавливает', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    // Схлопнутая каретка сразу СПРАВА от капсулы (перед « после»).
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const cap = ed.querySelector('.text-link')!;
      const r = document.createRange(); r.setStartAfter(cap); r.collapse(true);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('Backspace');

    const afterDel = await linkState(page);
    expect(afterDel.alive).toBe(false);       // капсула удалена целиком, не «надкушена»
    expect(afterDel.text).toContain('до');    // текст вокруг цел
    expect(afterDel.text).toContain('после');

    // Каретка не покидала редактор — Ctrl+Z уходит в НАТИВНЫЙ undo редактора
    // (глобальный tree-undo пропускает contentEditable-таргет, undo-delete.js).
    const focused = await page.evaluate(() =>
      document.activeElement === document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]'));
    expect(focused).toBe(true);

    await page.keyboard.press('Control+z');
    const afterUndo = await linkState(page);
    expect(afterUndo.alive).toBe(true);            // капсула вернулась
    expect(afterUndo.url).toBe('https://a.ru');    // с тем же data-link-url
  });

  test('Delete вплотную СЛЕВА от капсулы удаляет её целиком; Ctrl+Z восстанавливает', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    // Схлопнутая каретка сразу СЛЕВА от капсулы (после «до »).
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const cap = ed.querySelector('.text-link')!;
      const r = document.createRange(); r.setStartBefore(cap); r.collapse(true);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('Delete');

    const afterDel = await linkState(page);
    expect(afterDel.alive).toBe(false);
    expect(afterDel.text).toContain('до');
    expect(afterDel.text).toContain('после');

    await page.keyboard.press('Control+z');
    const afterUndo = await linkState(page);
    expect(afterUndo.alive).toBe(true);
    expect(afterUndo.url).toBe('https://a.ru');
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: выделение РОВНО одной капсулы + Delete → атомарное удаление одной
// undo-записью (ветка (в) handleEditorBeforeInput / _rangeIsWholeCapsule);
// Ctrl+Z восстанавливает. Плюс покрытие guard-skip-ветки _rangeIsWholeCapsule.
// ---------------------------------------------------------------------------

test.describe('capsule-whole-unit: атомарное удаление выделенной капсулы + undo', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('выделение ровно вокруг капсулы + Delete удаляет её атомарно; Ctrl+Z восстанавливает', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    // Выделяем капсулу целиком (границы ВНЕ её тела: до/после самого span).
    const preIsWhole = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const tbm = (window as any).textBlockManager;
      const cap = ed.querySelector('.text-link')!;
      const r = document.createRange(); r.setStartBefore(cap); r.setEndAfter(cap);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
      // Предусловие: диапазон охватывает РОВНО одну капсулу целиком.
      return !!tbm._rangeIsWholeCapsule(r, ed);
    });
    expect(preIsWhole).toBe(true);

    await page.keyboard.press('Delete');

    const afterDel = await linkState(page);
    expect(afterDel.alive).toBe(false);       // капсула удалена атомарно
    expect(afterDel.text).toContain('до');
    expect(afterDel.text).toContain('после');

    await page.keyboard.press('Control+z');
    const afterUndo = await linkState(page);
    expect(afterUndo.alive).toBe(true);            // одной undo-записью вернулась
    expect(afterUndo.url).toBe('https://a.ru');
  });

  test('_rangeIsWholeCapsule распознаёт ведущий guard как часть юнита (guard-skip)', async ({ page }) => {
    // Ведущая капсула → normalizeMarkers ставит guard U+FEFF ПЕРЕД ней. Диапазон,
    // включающий guard, всё равно «целая капсула» (guard — часть юнита, не узел).
    await focusSeededTextblockWithCapsule(page);
    const res = await page.evaluate((guard) => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const tbm = (window as any).textBlockManager;
      tbm.activeEditor = ed;
      // Ведущая капсула (перед ней нет текста) → появляется leading-guard.
      ed.innerHTML =
        '<span class="text-link" data-link-id="cap1" data-link-url="https://a.ru"' +
        ' contenteditable="false">ссылка</span> хвост';
      tbm.normalizeMarkers(ed);
      const cap = ed.querySelector('.text-link')!;
      const leadingGuard = !!(cap.previousSibling && (cap.previousSibling as Text).data === guard);
      // Диапазон от НАЧАЛА блока (включая guard) до конца капсулы.
      const r = document.createRange();
      r.setStart(ed, 0);
      r.setEndAfter(cap);
      const whole = tbm._rangeIsWholeCapsule(r, ed);
      return { leadingGuard, isWhole: whole === cap };
    }, GUARD);
    expect(res.leadingGuard).toBe(true);  // предусловие: guard действительно есть
    expect(res.isWhole).toBe(true);        // диапазон с guard'ом = ровно эта капсула
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: .node-selected — рантайм-only визуальная отметка «капсула-юнит
// выделена». Появляется при выделении целой капсулы, снимается при схлопывании /
// blur, и НИКОГДА не утекает в сохранённый content (_repairCapsulesInRoot).
// ---------------------------------------------------------------------------

test.describe('capsule-whole-unit: визуальная отметка .node-selected', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('выделение целой капсулы → .node-selected; коллапс снимает; в content не утекает', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    // Каретка вплотную ПЕРЕД капсулой (конец текста «до »).
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const before = ed.firstChild as Text; // «до »
      const r = document.createRange(); r.setStart(before, before.length); r.collapse(true);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    // Реальный Shift+ArrowRight: keydown снаппит выделение за всю капсулу,
    // keyup → handleSelectionChange → _updateNodeSelectedState вешает .node-selected.
    await page.keyboard.press('Shift+ArrowRight');

    // CRITICAL: класс есть в живом DOM, но НЕ утекает в сохранённый content.
    const saved = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const tbm = (window as any).textBlockManager;
      const liveHasSelected = !!ed.querySelector('.text-link.node-selected');
      // Форсим сохранение С node-selected в живом DOM — валидатор обязан его снять.
      tbm.saveContent('txt-seed-1', ed.innerHTML);
      const stored = (window as any).AppState.textBlocks['txt-seed-1'].content || '';
      return { liveHasSelected, stored };
    });
    expect(saved.liveHasSelected).toBe(true);                       // визуально отмечена
    expect(saved.stored).not.toContain('node-selected');           // в content не просочилась
    expect(saved.stored).toContain('data-link-url="https://a.ru"'); // сама капсула сохранена

    // Коллапс выделения (bare ArrowRight) → keyup снимает .node-selected.
    await page.keyboard.press('ArrowRight');
    const afterCollapse = await page.evaluate(() =>
      !!document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"] .node-selected'));
    expect(afterCollapse).toBe(false);
  });

  test('blur редактора снимает .node-selected', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const before = ed.firstChild as Text;
      const r = document.createRange(); r.setStart(before, before.length); r.collapse(true);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('Shift+ArrowRight');
    expect(await page.evaluate(() =>
      !!document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"] .node-selected'))).toBe(true);

    // Уводим фокус из редактора → handleEditorBlur чистит .node-selected.
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      ed.blur();
    });
    await page.waitForFunction(() =>
      !document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"] .node-selected'),
      { timeout: 2000 });
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: Shift+Arrow снаппинг — расширение выделения за ВСЮ капсулу одним
// шагом (_handleCapsuleShiftArrow), а не на один символ внутрь её тела.
// ---------------------------------------------------------------------------

test.describe('capsule-whole-unit: Shift+Arrow снаппинг', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('Shift+ArrowRight у левой границы капсулы накрывает её ЦЕЛИКОМ одним шагом', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const before = ed.firstChild as Text; // «до »
      const r = document.createRange(); r.setStart(before, before.length); r.collapse(true);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('Shift+ArrowRight');

    const res = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const tbm = (window as any).textBlockManager;
      const sel = getSelection()!;
      const range = sel.getRangeAt(0);
      return {
        collapsed: sel.isCollapsed,
        whole: !!tbm._rangeIsWholeCapsule(range, ed),
        selText: range.toString().replace(/[﻿​]/g, ''),
      };
    });
    expect(res.collapsed).toBe(false);
    expect(res.whole).toBe(true);          // выделение = РОВНО капсула (один шаг)
    expect(res.selText).toBe('ссылка');    // накрыто всё тело, не один символ

    // Ещё Shift+ArrowRight — фокус уходит уже ЗА капсулу в « после» (не залипает).
    await page.keyboard.press('Shift+ArrowRight');
    const grew = await page.evaluate(() => {
      const sel = getSelection()!;
      return sel.getRangeAt(0).toString().replace(/[﻿​]/g, '');
    });
    expect(grew.startsWith('ссылка')).toBe(true);
    expect(grew.length).toBeGreaterThan('ссылка'.length); // выделение расширилось за капсулу
  });

  test('Shift+ArrowLeft у правой границы капсулы накрывает её ЦЕЛИКОМ одним шагом', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const after = ed.lastChild as Text; // « после»
      const r = document.createRange(); r.setStart(after, 0); r.collapse(true);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('Shift+ArrowLeft');

    const res = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const tbm = (window as any).textBlockManager;
      const range = getSelection()!.getRangeAt(0);
      return {
        whole: !!tbm._rangeIsWholeCapsule(range, ed),
        selText: range.toString().replace(/[﻿​]/g, ''),
      };
    });
    expect(res.whole).toBe(true);
    expect(res.selText).toBe('ссылка');
  });
});

// ---------------------------------------------------------------------------
// Behavior 5 (CARET-1 non-regression): капсула в inline-правке (dblclick,
// editing-mode) — обычный редактируемый текст, whole-unit логика ОТКЛЮЧЕНА.
// _rangeIsWholeCapsule / _staticRangeTouchesCapsule / _handleCapsuleShiftArrow
// её не трактуют как атом (единый предикат _isEditingCapsule).
// ---------------------------------------------------------------------------

test.describe('capsule-whole-unit: editing-mode гейтит whole-unit логику (CARET-1)', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('editing-mode капсула: _rangeIsWholeCapsule → null, Shift+Arrow не снаппит', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    // Двойной клик → editing-mode + contenteditable=true (реальный жест).
    await page.locator(`${EDITOR_SEL} .text-link`).dblclick();
    await page.waitForFunction(() => {
      const cap = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"] .text-link');
      return !!(cap && cap.classList.contains('editing-mode') &&
        cap.getAttribute('contenteditable') === 'true');
    }, { timeout: 2000 });

    const res = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const tbm = (window as any).textBlockManager;
      const cap = ed.querySelector('.text-link')!;
      // Диапазон, брекетящий капсулу целиком — но она в правке → не атом.
      const r = document.createRange(); r.setStartBefore(cap); r.setEndAfter(cap);
      // Shift+Arrow-снаппинг тоже гейтится: ставим фокус ПЕРЕД капсулой и зовём
      // обработчик — он не должен перехватить (editing-mode).
      const focusRange = document.createRange();
      focusRange.setStartBefore(cap); focusRange.collapse(true);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(focusRange);
      let prevented = false;
      const intercepted = tbm._handleCapsuleShiftArrow(
        { key: 'ArrowRight', preventDefault() { prevented = true; }, shiftKey: true }, ed);
      return {
        editing: tbm._isEditingCapsule(cap),
        whole: tbm._rangeIsWholeCapsule(r, ed), // ожидаем null
        shiftIntercepted: intercepted,
        shiftPrevented: prevented,
      };
    });
    expect(res.editing).toBe(true);          // предусловие: капсула в правке
    expect(res.whole).toBeNull();            // whole-unit логика отключена
    expect(res.shiftIntercepted).toBe(false); // Shift+Arrow не снаппит editing-капсулу
    expect(res.shiftPrevented).toBe(false);
  });

  test('регресс-гейт: обычная (не editing) капсула — _rangeIsWholeCapsule её распознаёт', async ({ page }) => {
    // Симметрия к предыдущему: критерий editing-mode НЕ ослабил обычные капсулы.
    await focusSeededTextblockWithCapsule(page);
    const whole = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const tbm = (window as any).textBlockManager;
      const cap = ed.querySelector('.text-link')!;
      const r = document.createRange(); r.setStartBefore(cap); r.setEndAfter(cap);
      return tbm._rangeIsWholeCapsule(r, ed) === cap;
    });
    expect(whole).toBe(true);
  });
});
