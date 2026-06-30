import { test, expect } from '@playwright/test';
import { openAct, SEED_ACTS } from '../fixtures';

// Сид-редактор и guard-символ (U+FEFF).
const EDITOR_SEL = '.textblock-editor[data-text-block-id="txt-seed-1"]';
const GUARD = '\uFEFF';

/**
 * Переходит на шаг 2, фокусирует сид-редактор и задаёт его innerHTML.
 * activeEditor проставляется явно (как в 16-capsule-integrity).
 */
async function setupEditor(page, html: string) {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.locator('.step[data-step="2"]').click();
  await page.locator(EDITOR_SEL).waitFor({ state: 'visible', timeout: 5000 });
  await page.locator(EDITOR_SEL).click();
  await page.evaluate((h) => {
    const ed = document.querySelector(
      '.textblock-editor[data-text-block-id="txt-seed-1"]',
    ) as HTMLElement;
    const tbm = (window as any).textBlockManager;
    tbm.activeEditor = ed;
    ed.innerHTML = h;
    ed.focus();
  }, html);
}

const FOOTNOTE = (text = 'сноска') =>
  `<span class="text-footnote" data-footnote-id="F1" data-footnote-text="прим"` +
  ` contenteditable="false">${text}</span>`;

test.describe('caret-guards у границ визуальных строк (_placeCapGuards)', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('капсула на отдельной строке (br с обеих сторон) → guard слева И справа', async ({ page }) => {
    await setupEditor(page, 'строка1<br>' + FOOTNOTE() + '<br>строка3');
    const r = await page.evaluate((guard) => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      (window as any).textBlockManager.normalizeMarkers(ed);
      const cap = ed.querySelector('.text-footnote')!;
      const prev = cap.previousSibling, next = cap.nextSibling;
      const isGuard = (n: any) => !!(n && n.nodeType === 3 && n.data === guard);
      return { leading: isGuard(prev), trailing: isGuard(next) };
    }, GUARD);
    expect(r.leading).toBe(true);   // ведущий guard у капсулы-в-начале-строки
    expect(r.trailing).toBe(true);  // хвостовой guard у капсулы-в-конце-строки
  });

  test('капсула среди обычного текста → guard НЕ ставится (без овергарда)', async ({ page }) => {
    await setupEditor(page, 'текст ' + FOOTNOTE() + ' хвост');
    const r = await page.evaluate((guard) => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      (window as any).textBlockManager.normalizeMarkers(ed);
      const cap = ed.querySelector('.text-footnote')!;
      const isGuard = (n: any) => !!(n && n.nodeType === 3 && n.data === guard);
      return { leading: isGuard(cap.previousSibling), trailing: isGuard(cap.nextSibling) };
    }, GUARD);
    // Слева/справа обычный текст — каретка встаёт штатно, guard не нужен.
    expect(r.leading).toBe(false);
    expect(r.trailing).toBe(false);
  });

  test('капсула сразу после <br> (начало визуальной строки) → ведущий guard', async ({ page }) => {
    await setupEditor(page, 'текст<br>' + FOOTNOTE() + ' хвост');
    const r = await page.evaluate((guard) => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      (window as any).textBlockManager.normalizeMarkers(ed);
      const cap = ed.querySelector('.text-footnote')!;
      const isGuard = (n: any) => !!(n && n.nodeType === 3 && n.data === guard);
      return { leading: isGuard(cap.previousSibling), prevIsBr:
        !!(cap.previousSibling && cap.previousSibling.previousSibling &&
           (cap.previousSibling.previousSibling as Element).tagName === 'BR') };
    }, GUARD);
    expect(r.leading).toBe(true);
    expect(r.prevIsBr).toBe(true); // guard стоит МЕЖДУ <br> и капсулой
  });
});

test.describe('Issue 3: Enter перед капсулой', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('Enter перед капсулой → стойкий guard и каретка ВПЛОТНУЮ перед капсулой', async ({ page }) => {
    await setupEditor(page, 'текст' + FOOTNOTE());
    // Каретка между «текст» и капсулой (в конце первого текстового узла).
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const t = ed.firstChild as Text;            // «текст»
      const r = document.createRange();
      r.setStart(t, t.length); r.collapse(true);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('Enter');
    const r = await page.evaluate((guard) => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const cap = ed.querySelector('.text-footnote')!;
      const prev = cap.previousSibling as any;        // ожидаем guard
      const sel = getSelection()!;
      const isGuard = (n: any) => !!(n && n.nodeType === 3 && n.data === guard);
      const isEmpty = (n: any) => n && n.nodeType === 3 && (n.data === '' || n.data === guard);
      // <br> перед капсулой, пропуская guard'ы и пустые текст-узлы (range.insertNode
      // при split в конце текста оставляет пустой узел между <br> и guard'ом).
      let n: any = cap.previousSibling, brBefore = false;
      while (n) {
        if (n.nodeType === 1 && n.tagName === 'BR') { brBefore = true; break; }
        if (!isEmpty(n)) break;
        n = n.previousSibling;
      }
      return {
        guardBeforeCap: isGuard(prev),
        brBeforeCap: brBefore,
        caretInGuard: sel.isCollapsed && sel.anchorNode === prev,
      };
    }, GUARD);
    expect(r.brBeforeCap).toBe(true);     // капсула ушла на новую строку (<br>)
    expect(r.guardBeforeCap).toBe(true);  // перед ней появился стойкий guard
    expect(r.caretInGuard).toBe(true);    // каретка приземлилась перед капсулой
  });
});

test.describe('Issue 2: вертикальная навигация через строку-капсулу', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('ArrowDown со строки 1 заходит на строку-сноску, не перескакивает на строку 3', async ({ page }) => {
    await setupEditor(page, 'строка1<br>' + FOOTNOTE() + '<br>строка3');
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      (window as any).textBlockManager.normalizeMarkers(ed);
      // Каретка в начало «строка1».
      const t = ed.firstChild as Text;
      const r = document.createRange();
      r.setStart(t, 0); r.collapse(true);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
      ed.focus();
    });
    await page.keyboard.press('ArrowDown');
    const landing = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const cap = ed.querySelector('.text-footnote')!;
      const sel = getSelection()!;
      const a = sel.anchorNode;
      if (a === cap.previousSibling) return 'leading-guard';
      if (a === cap || (a && cap.contains(a))) return 'capsule';
      if (a === cap.nextSibling) return 'trailing-guard';
      if (a === ed.lastChild) return 'line3';
      if (a === ed.firstChild) return 'line1';
      return 'other:' + (a && a.nodeType === 3 ? JSON.stringify((a as Text).data) : (a as any)?.nodeName);
    });
    // Главное: каретка НЕ проскочила на строку 3 и не осталась на строке 1.
    expect(landing).not.toBe('line3');
    expect(landing).not.toBe('line1');
  });
});

test.describe('observer-самозалечивание ведущего guard у строки-капсулы', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('удаление guard паттерном «empty-then-remove» (реальный Backspace) → observer восстанавливает', async ({ page }) => {
    await setupEditor(page, 'строка1<br>' + FOOTNOTE() + '<br>строка3');
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      (window as any).textBlockManager.normalizeMarkers(ed);
    });
    // Ведущий guard перед капсулой действительно есть.
    const before = await page.evaluate((guard) => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const cap = ed.querySelector('.text-footnote')!;
      return !!(cap.previousSibling && (cap.previousSibling as Text).data === guard);
    }, GUARD);
    expect(before).toBe(true);

    // Имитация РЕАЛЬНОГО Backspace по zero-width guard'у: браузер сперва
    // опустошает текст-узел (characterData U+FEFF→''), затем удаляет уже пустой
    // узел (childList) — в одном батче мутаций. Этот паттерн раньше observer
    // не лечил (removedNode.data==='' ≠ guard, а characterData-узел уже отвязан).
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const cap = ed.querySelector('.text-footnote')!;
      const g = cap.previousSibling as Text;
      g.data = '';
      g.remove();
    });

    // Observer должен вернуть guard перед капсулой в пределах 1 секунды.
    await page.waitForFunction((guard) => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      const cap = ed && ed.querySelector('.text-footnote');
      return !!(cap && cap.previousSibling && cap.previousSibling.nodeType === 3 &&
        (cap.previousSibling as Text).data === guard);
    }, GUARD, { timeout: 1000 });
  });
});

test.describe('смена размера шрифта не ломает caret-guard у капсулы', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('размер на каретке перед капсулой → ведущий guard сохраняется (U+200B-якорь не блокирует)', async ({ page }) => {
    await setupEditor(page, 'строка1<br>' + FOOTNOTE() + '<br>строка3');
    const r = await page.evaluate((guard) => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const tbm = (window as any).textBlockManager;
      tbm.normalizeMarkers(ed);
      // Каретка в ведущий guard перед капсулой, затем меняем размер.
      const cap = ed.querySelector('.text-footnote')!;
      const g = cap.previousSibling as Text;
      const rng = document.createRange(); rng.setStart(g, g.length); rng.collapse(true);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(rng);
      tbm.applyFontSize(20);   // вставит <span style="font-size"><U+200B></span> перед капсулой
      const cap2 = ed.querySelector('.text-footnote')!;
      return {
        leading: !!(cap2.previousSibling && cap2.previousSibling.nodeType === 3 &&
          (cap2.previousSibling as Text).data === guard),
        hasZwsp: ed.innerHTML.indexOf('\u200B') !== -1,   // якорь размера на месте
      };
    }, GUARD);
    expect(r.leading).toBe(true);  // guard поставлен НЕСМОТРЯ на U+200B-span рядом
    expect(r.hasZwsp).toBe(true);  // якорь размера не выпилен
  });

  test('после смены размера (с U+200B в сохранённом контенте) reload восстанавливает guard', async ({ page }) => {
    const reloadedLeading = await page.evaluate((guard) => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const tbm = (window as any).textBlockManager;
      // Сохранённый контент с U+200B-якорем размера ВПЛОТНУЮ к капсуле (U+FEFF
      // стрипается при save, U+200B — нет), как после смены размера + reload.
      ed.innerHTML = 'строка1<br><span style="font-size: 20px;">\u200B</span>' +
        '<span class="text-footnote" data-footnote-id="F1" data-footnote-text="прим">сноска</span>' +
        '<br>строка3';
      tbm.normalizeMarkers(ed);   // именно это выполняется на createEditor (reload)
      const cap = ed.querySelector('.text-footnote')!;
      return !!(cap.previousSibling && cap.previousSibling.nodeType === 3 &&
        (cap.previousSibling as Text).data === guard);
    }, GUARD);
    expect(reloadedLeading).toBe(true);  // раньше reload НЕ чинил — теперь чинит
  });

  test('размер по выделению капсулы → guard с обеих сторон сохраняется', async ({ page }) => {
    await setupEditor(page, 'строка1<br>' + FOOTNOTE() + '<br>строка3');
    const r = await page.evaluate((guard) => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]') as HTMLElement;
      const tbm = (window as any).textBlockManager;
      tbm.normalizeMarkers(ed);
      const cap = ed.querySelector('.text-footnote')!;
      const rng = document.createRange(); rng.selectNode(cap);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(rng);
      tbm.applyFontSize(20);   // обернёт капсулу в <span style="font-size">
      const cap2 = ed.querySelector('.text-footnote')!;
      const isG = (n: any) => !!(n && n.nodeType === 3 && n.data === guard);
      return { leading: isG(cap2.previousSibling), trailing: isG(cap2.nextSibling) };
    }, GUARD);
    expect(r.leading).toBe(true);
    expect(r.trailing).toBe(true);
  });
});
