import { test, expect } from '@playwright/test';
import { openAct, SEED_ACTS } from '../fixtures';

// Прогоняет validateAndRepairCapsules в браузере на заданном HTML.
async function repair(page, html: string): Promise<string> {
  return await page.evaluate((h) => {
    // Менеджер текстблоков экспонирован на window в textblock-core.js.
    const mgr = (window as any).textBlockManager;
    return mgr.validateAndRepairCapsules(h);
  }, html);
}

// Редактор с сид-текстблоком
const EDITOR_SEL = '.textblock-editor[data-text-block-id="txt-seed-1"]';

/**
 * Переходит на шаг 2 и вставляет в сид-редактор HTML с одной ссылкой-капсулой.
 * activeEditor устанавливается кликом (через handleEditorFocus) и затем явно
 * переподтверждается — на случай если фокус ушёл при setHTML.
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
  });
}

/**
 * Ставит выделение: начало в первом текстовом узле (до капсулы, offset 1),
 * конец — внутри текстового узла капсулы (offset 3). Range пересекает границу
 * contenteditable=false капсулы — именно этот случай провоцирует клонирование
 * при execCommand('bold') / range.deleteContents() без расширения выделения.
 */
async function selectAcrossCapsuleBoundary(page) {
  await page.evaluate(() => {
    const ed = document.querySelector(
      '.textblock-editor[data-text-block-id="txt-seed-1"]',
    ) as HTMLElement;
    const beforeText = ed.firstChild as Text;
    const capsule = ed.querySelector('.text-link')!;
    const capsuleText = capsule.firstChild as Text;
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(beforeText, 1);
    r.setEnd(capsuleText, 3);
    sel.removeAllRanges();
    sel.addRange(r);
  });
}

test.describe('capsule-integrity: validateAndRepairCapsules', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('дубль data-link-id у НЕ-соседних капсул → клону свежий id', async ({ page }) => {
    const html =
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">A</span>' +
      ' текст ' +
      '<span class="text-link" data-link-id="L1" data-link-url="http://b">B</span>';
    const out = await repair(page, html);
    const ids = [...out.matchAll(/data-link-id="([^"]+)"/g)].map(m => m[1]);
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]); // дубль устранён
  });

  test('расщеплённый клон (тот же id, соседи, тот же url) → склейка в одну капсулу', async ({ page }) => {
    const html =
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">Ссы</span>' +
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">лка</span>';
    const out = await repair(page, html);
    const count = (out.match(/text-link/g) || []).length;
    expect(count).toBe(1);
    expect(out).toContain('>Ссылка<');
  });

  test('расщеплённый клон (разделитель — guard-узел U+FEFF) → склейка', async ({ page }) => {
    // _isInsignificantText: guard-char (U+FEFF) пропускается как незначимый;
    // _areAdjacentSplit должна видеть капсулы «соседними» и склеить их.
    const guard = '\uFEFF';
    const html =
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">Час</span>' +
      guard +
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">ть</span>';
    const out = await repair(page, html);
    const count = (out.match(/text-link/g) || []).length;
    expect(count).toBe(1);
    expect(out).toContain('>Часть<');
    // guard-символ вычищен _cleanCapGuards в конце _repairCapsulesInRoot
    expect(out).not.toContain(guard);
  });

  test('тот же id + реальный пробел между капсулами → не сливаются (свежий id)', async ({ page }) => {
    // Обычный пробел — значимый текст; _areAdjacentSplit вернёт false.
    const html =
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">A</span>' +
      ' ' +
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">B</span>';
    const out = await repair(page, html);
    const ids = [...out.matchAll(/data-link-id="([^"]+)"/g)].map(m => m[1]);
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('пустой data-footnote-text → разворот в plain-text', async ({ page }) => {
    const html = '<span class="text-footnote" data-footnote-id="F1" data-footnote-text="">слово</span>';
    const out = await repair(page, html);
    expect(out).not.toContain('text-footnote');
    expect(out).toContain('слово');
  });

  test('пустой data-link-url → разворот в plain-text', async ({ page }) => {
    const html = '<span class="text-link" data-link-id="L1" data-link-url="">слово</span>';
    const out = await repair(page, html);
    expect(out).not.toContain('text-link');
    expect(out).toContain('слово');
  });

  test('идемпотентность: повторный прогон не меняет результат', async ({ page }) => {
    const html =
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">A</span>' +
      '<span class="text-footnote" data-footnote-id="F1" data-footnote-text="прим">x</span>';
    const once = await repair(page, html);
    const twice = await repair(page, once);
    expect(twice).toBe(once);
  });

  test('страховка: guard-символ и contenteditable вычищаются', async ({ page }) => {
    const guardChar = '\uFEFF';
    const html = '<span class="text-link" data-link-id="L1" data-link-url="http://a" contenteditable="false">A' + guardChar + '</span>';
    const out = await repair(page, html);
    expect(out).not.toContain(guardChar);
    expect(out).not.toContain('contenteditable');
  });
});

test.describe('capsule-integrity: beforeinput-перехват', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('Backspace, когда каретка сразу за капсулой → капсула удаляется целиком', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    // каретку ставим сразу справа от капсулы (через клик по правой половине)
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      const cap = ed.querySelector('.text-link, .text-footnote');
      (window as any).__capId = cap.getAttribute('data-link-id') || cap.getAttribute('data-footnote-id');
      const r = document.createRange();
      r.setStartAfter(cap); r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('Backspace');
    const stillThere = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      return !![...ed.querySelectorAll('[data-link-id],[data-footnote-id]')]
        .find(s => (s.getAttribute('data-link-id') || s.getAttribute('data-footnote-id')) === (window as any).__capId);
    });
    expect(stillThere).toBe(false); // капсула удалена целиком, не «надкушена»
  });

  test('выделение через границу + Delete → нет клона, id уникальны, нет осиротевших guard-узлов', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    await selectAcrossCapsuleBoundary(page);
    await page.keyboard.press('Delete');
    const result = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      const ids = [...ed.querySelectorAll('[data-link-id],[data-footnote-id]')]
        .map(s => s.getAttribute('data-link-id') || s.getAttribute('data-footnote-id'));
      // Ищем осиротевшие guard-узлы (U+FEFF без соседней капсулы).
      const GUARD = '\uFEFF';
      let orphanedGuards = 0;
      const walk = (node: Node) => {
        if (node.nodeType === 3 && (node as Text).data === GUARD) {
          const prev = node.previousSibling as Element | null;
          const next = node.nextSibling as Element | null;
          const adjCapsule = (n: Element | null) =>
            n && n.nodeType === 1 &&
            (n.classList.contains('text-link') || n.classList.contains('text-footnote'));
          if (!adjCapsule(prev) && !adjCapsule(next)) orphanedGuards++;
        }
        node.childNodes.forEach(walk);
      };
      walk(ed);
      return { ids, orphanedGuards };
    });
    expect(new Set(result.ids).size).toBe(result.ids.length);
    // Если Chromium обработал Delete нативно (inside-ветка не срабатывает) —
    // orphanedGuards тоже 0, т.к. браузер удаляет весь диапазон корректно.
    expect(result.orphanedGuards).toBe(0);
  });
});

test.describe('capsule-integrity: атомарность при наших операциях', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('bold по выделению через границу капсулы → нет клона, id уникальны', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    await selectAcrossCapsuleBoundary(page);
    await page.keyboard.press('Control+b');
    const ids = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      return [...ed.querySelectorAll('[data-link-id],[data-footnote-id]')]
        .map(s => s.getAttribute('data-link-id') || s.getAttribute('data-footnote-id'));
    });
    expect(new Set(ids).size).toBe(ids.length); // нет дубль-id
  });

  test('paste по выделению через границу капсулы → нет клона', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    await selectAcrossCapsuleBoundary(page);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<p>ВСТАВКА</p>'); // HTML-ветка → проходит через _expandRangeOutOfMarkers
      dt.setData('text/plain', 'ВСТАВКА');
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const ids = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      return [...ed.querySelectorAll('[data-link-id],[data-footnote-id]')]
        .map(s => s.getAttribute('data-link-id') || s.getAttribute('data-footnote-id'));
    });
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Task 4: MutationObserver-страховка
// ---------------------------------------------------------------------------

/**
 * Открывает акт, переходит на шаг 2, ставит ВЕДУЩУЮ капсулу (без текста перед ней),
 * вызывает normalizeMarkers — после этого в редакторе появляется guard U+FEFF
 * перед капсулой. Observer уже установлен (createEditor → installCapsuleObserver).
 */
async function setupLeadingCapsuleWithGuard(page) {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.locator('.step[data-step="2"]').click();
  await page.locator(EDITOR_SEL).waitFor({ state: 'visible', timeout: 5000 });
  await page.evaluate(() => {
    const ed = document.querySelector(
      '.textblock-editor[data-text-block-id="txt-seed-1"]',
    ) as HTMLElement;
    const tbm = (window as any).textBlockManager;
    tbm.activeEditor = ed;
    // Ведущая капсула: перед ней нет текста → _placeCapGuards поставит guard.
    ed.innerHTML =
      '<span class="text-link" data-link-id="cap1" data-link-url="https://a.ru"' +
      ' contenteditable="false">ссылка</span>' +
      ' текст';
    tbm.normalizeMarkers(ed);
  });
}

test.describe('capsule-integrity: observer-самозалечивание', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('программно удалённый guard у ведущей капсулы → восстановлен observer-ом', async ({ page }) => {
    await setupLeadingCapsuleWithGuard(page);
    // Убеждаемся, что guard действительно есть перед удалением.
    const guardPresent = await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      return ed && ed.firstChild && ed.firstChild.nodeType === 3 && (ed.firstChild as Text).data === '\uFEFF';
    });
    expect(guardPresent).toBe(true);

    // Удаляем все guard-узлы (имитация «пользователь стёр невидимый символ»).
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      [...ed.childNodes].forEach(n => {
        if (n.nodeType === 3 && (n as Text).data === '\uFEFF') n.remove();
      });
    });

    // Observer должен восстановить guard в пределах 1 секунды.
    await page.waitForFunction(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      return !!(ed && ed.firstChild && ed.firstChild.nodeType === 3 && (ed.firstChild as Text).data === '\uFEFF');
    }, { timeout: 1000 });
  });

  test('contenteditable, снятый с капсулы, восстановлен observer-ом', async ({ page }) => {
    await focusSeededTextblockWithCapsule(page);
    await page.evaluate(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      const cap = ed.querySelector('.text-link, .text-footnote');
      cap.removeAttribute('contenteditable');
    });
    await page.waitForFunction(() => {
      const ed = document.querySelector('.textblock-editor[data-text-block-id="txt-seed-1"]');
      const cap = ed && ed.querySelector('.text-link, .text-footnote');
      return !!(cap && cap.getAttribute('contenteditable') === 'false');
    }, { timeout: 1000 });
  });
});
