import { test, expect, openAct, SEED_ACTS } from '../fixtures';
import type { Page } from '@playwright/test';

/**
 * Task B — поиск/замена по текстблокам акта (FindBar + ActSearchEngine +
 * ActSearchHighlight + ActSearchReplace).
 *
 * Проверяем поведение сквозь живой DOM: реальный Ctrl+F (перехват браузерного
 * поиска), реальный ввод в поля, реальные клики по кнопкам панели и по
 * подтверждению «Заменить всё». Подсветку читаем через CSS Custom Highlight API
 * (`CSS.highlights.get('act-find')`), счётчик — через текст `data-role="counter"`.
 *
 * Флагман — капсулы (ссылки/сноски contenteditable="false"): их тело исключено
 * из пробегов движка, поэтому поиск не заходит внутрь капсулы, а замена не может
 * её разрезать (см. act-search-engine.js::collectRuns / replaceRange).
 *
 * Сидинг: ставим innerHTML редактора txt-seed-1 и вызываем
 * textBlockManager.finalizeEdit(ed) — он синкает AppState.textBlocks[id].content
 * (нужно для снимков undo «Заменить всё»). collectRuns читает ЖИВОЙ DOM, поэтому
 * поиск видит сид сразу.
 */

const EDITOR_SEL = '.textblock-editor[data-text-block-id="txt-seed-1"]';
const BAR = '#actFindBar';

/** Переходит на шаг 2 и дожидается сид-редактора. */
async function openStep2(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.locator('.step[data-step="2"]').click();
  await page.locator(EDITOR_SEL).waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Кладёт HTML в сид-редактор и фиксирует правку (finalizeEdit → саморегистрация
 * в AppState). Возвращает нормализованный content из AppState (эталон для
 * проверок undo). Снимает выделение, чтобы Ctrl+F-префилл не подхватил его.
 */
async function seed(page: Page, html: string): Promise<string> {
  return await page.evaluate((h) => {
    const ed = document.querySelector(
      '.textblock-editor[data-text-block-id="txt-seed-1"]',
    ) as HTMLElement;
    const tbm = (window as any).textBlockManager;
    tbm.activeEditor = ed;
    ed.innerHTML = h;
    // Капсулам нужны интерактивные обработчики; для plain-текста безвредно.
    if (typeof tbm.attachLinkFootnoteHandlers === 'function') {
      tbm.attachLinkFootnoteHandlers();
    }
    tbm.finalizeEdit(ed);
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    return (window as any).AppState.textBlocks['txt-seed-1'].content as string;
  }, html);
}

/** Открывает панель поиска программно (детерминированно, без хоткея). */
async function openBar(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).FindBar.open());
  await expect(page.locator(BAR)).not.toHaveClass(/\bhidden\b/);
}

/** Размер именованной подсветки (число диапазонов); null — API недоступен. */
async function highlightSize(page: Page, name: string): Promise<number | null> {
  return await page.evaluate((n) => {
    if (typeof CSS === 'undefined' || !CSS.highlights) return null;
    const hl = CSS.highlights.get(n);
    return hl ? hl.size : 0;
  }, name);
}

/** Текст live-содержимого редактора без невидимых guard/anchor-символов. */
async function editorText(page: Page): Promise<string> {
  return await page.evaluate((sel) => {
    const ed = document.querySelector(sel) as HTMLElement;
    return (ed.textContent || '').replace(/[﻿​]/g, '');
  }, EDITOR_SEL);
}

/** Текущее содержимое блока из AppState. */
async function stateContent(page: Page): Promise<string> {
  return await page.evaluate(
    () => (window as any).AppState.textBlocks['txt-seed-1'].content as string,
  );
}

const counter = (page: Page) => page.locator(`${BAR} [data-role="counter"]`);
const findInput = (page: Page) => page.locator(`${BAR} [data-role="find"]`);
const replaceInput = (page: Page) => page.locator(`${BAR} [data-role="replace"]`);

test.describe('Find/Replace (Task B): поиск, навигация, замена', () => {
  test.beforeEach(async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    await openStep2(page);
  });

  // 1. Реальный Ctrl+F + подсветка совпадений + счётчик.
  test('Ctrl+F открывает панель; поиск подсвечивает совпадения и заполняет счётчик', async ({ page }) => {
    await seed(page, 'кот кот кот');

    // Реальный хоткей: перехватывает браузерный поиск и открывает панель.
    await page.keyboard.press('Control+f');
    await expect(page.locator(BAR)).toBeVisible();
    await expect(page.locator(BAR)).not.toHaveClass(/\bhidden\b/);

    await findInput(page).fill('кот');
    await expect(counter(page)).toHaveText('1 / 3');

    expect(await highlightSize(page, 'act-find')).toBe(3);
    expect(await highlightSize(page, 'act-find-current')).toBe(1);
  });

  // 2. Навигация next/prev двигает текущее совпадение и заворачивает счётчик.
  test('next/prev циклически двигают текущее совпадение (счётчик k заворачивается)', async ({ page }) => {
    await seed(page, 'кот кот кот');
    await openBar(page);
    await findInput(page).fill('кот');
    await expect(counter(page)).toHaveText('1 / 3');
    expect(await highlightSize(page, 'act-find-current')).toBe(1);

    const next = page.locator(`${BAR} [data-role="next"]`);
    const prev = page.locator(`${BAR} [data-role="prev"]`);

    await next.click();
    await expect(counter(page)).toHaveText('2 / 3');
    await next.click();
    await expect(counter(page)).toHaveText('3 / 3');
    await next.click(); // заворот вперёд
    await expect(counter(page)).toHaveText('1 / 3');
    await prev.click(); // заворот назад
    await expect(counter(page)).toHaveText('3 / 3');

    // Текущее совпадение всегда ровно одно, всего — по-прежнему 3.
    expect(await highlightSize(page, 'act-find-current')).toBe(1);
    expect(await highlightSize(page, 'act-find')).toBe(3);
  });

  // 3. «Заменить» заменяет ТЕКУЩЕЕ совпадение и уменьшает счётчик.
  test('«Заменить» заменяет одно совпадение и уменьшает счётчик', async ({ page }) => {
    await seed(page, 'кот кот кот');
    await openBar(page);
    await findInput(page).fill('кот');
    await expect(counter(page)).toHaveText('1 / 3');

    await replaceInput(page).fill('X');
    await page.locator(`${BAR} [data-role="replaceOne"]`).click();

    // Пересобранный список: заменено первое, осталось 2 совпадения.
    await expect(counter(page)).toHaveText('1 / 2');
    expect(await highlightSize(page, 'act-find')).toBe(2);

    const txt = (await editorText(page)).replace(/\s+/g, ' ').trim();
    expect(txt).toBe('X кот кот');
    expect(await stateContent(page)).toContain('X');
  });

  // 4. «Заменить всё» + подтверждение + custom-undo.
  //
  // ВАЖНО: совпадения разнесены по РАЗНЫМ текстовым узлам (через <b>) намеренно —
  // этот тест про round-trip replace-all + undo. Случай нескольких совпадений в
  // ОДНОМ текстовом узле проверяет отдельный регресс-тест 4b (replaceData).
  test('«Заменить всё» заменяет все совпадения; «Отменить замену» восстанавливает', async ({ page }) => {
    const original = await seed(page, 'кот <b>кот</b> кот');
    await openBar(page);
    await findInput(page).fill('кот');
    await expect(counter(page)).toHaveText('1 / 3');

    await replaceInput(page).fill('пёс');
    await page.locator(`${BAR} [data-role="replaceAll"]`).click();

    // Подтверждение — in-page диалог DialogManager.
    const confirmBtn = page.locator('.custom-dialog .dialog-confirm');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Все три заменены → 0 совпадений «кот».
    await expect(counter(page)).toHaveText('0 / 0');
    const afterAll = await stateContent(page);
    expect(afterAll).not.toContain('кот');
    expect((afterAll.match(/пёс/g) || []).length).toBe(3);

    // Кнопка «Отменить замену» появилась.
    const undoBtn = page.locator(`${BAR} [data-role="undo"]`);
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // Восстановлен исходный (нормализованный) content блока.
    expect(await stateContent(page)).toBe(original);
  });

  // 4b. Регресс на пойманный live-тестом баг движка (ПОФИКШЕН): «Заменить всё»
  // при нескольких совпадениях в ОДНОМ текстовом узле раньше недозаменял и портил
  // текст. Корень: ActSearchEngine.replaceRange в быстром пути одного текст-узла
  // писал `sc.nodeValue = slice+repl+slice` — присваивание nodeValue есть DOM
  // «replace data» по ВСЕМУ узлу (offset 0), схлопывающее ВСЕ прочие живые Range
  // узла к 0, из-за чего back-to-front FindBar._replaceAll ломался
  // ('кот кот кот' → 'пёспёскот кот пёс'). Фикс: sc.replaceData(s, e-s, repl)
  // правит только [s, e), сохраняя более ранние диапазоны.
  test('«Заменить всё» в одном текст-узле заменяет ВСЕ совпадения (регресс replaceData)', async ({ page }) => {
    await seed(page, 'кот кот кот'); // единый текстовый узел — прежде ломался
    await openBar(page);
    await findInput(page).fill('кот');
    await expect(counter(page)).toHaveText('1 / 3');

    await replaceInput(page).fill('пёс');
    await page.locator(`${BAR} [data-role="replaceAll"]`).click();
    await page.locator('.custom-dialog .dialog-confirm').click();

    await expect(counter(page)).toHaveText('0 / 0');
    const after = await stateContent(page);
    expect(after).not.toContain('кот');
    expect((after.match(/пёс/g) || []).length).toBe(3); // все три заменены, без порчи
  });
});

test.describe('Find/Replace (Task B): флагман — капсулы', () => {
  test.beforeEach(async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    await openStep2(page);
  });

  const CAPSULE_HTML =
    'слово ' +
    '<span class="text-link" data-link-id="cap1" data-link-url="https://a.ru"' +
    ' contenteditable="false">слово-ссылка</span>' +
    ' слово';

  // 5. Поиск находит и собственный видимый текст капсулы (капсула-ссылка -search),
  //    но замена всё равно не разрезает её.
  test('поиск матчит и внешний текст, и видимый текст капсулы; «Заменить всё» правит только внешний текст', async ({ page }) => {
    await seed(page, CAPSULE_HTML);
    await openBar(page);

    // (a) «слово» встречается 3 раза визуально (два снаружи + начало тела капсулы
    //     «слово-ссылка») — капсула-ссылка-search находит и её собственный текст,
    //     поэтому ровно 3 совпадения (не 2, как было до расширения поиска на
    //     видимый текст капсул).
    await findInput(page).fill('слово');
    await expect(counter(page)).toHaveText('1 / 3');
    expect(await highlightSize(page, 'act-find')).toBe(3);

    // (b) Заменить всё «слово» → «X». Два ВНЕШНИХ совпадения заменяются; совпадение
    //     ВНУТРИ капсулы отклоняется replaceRange (_hasCapsuleAncestor) — капсула
    //     остаётся неразрезанной, поэтому после пакета остаётся ровно 1 совпадение
    //     (само «слово-ссылка»), а не 0.
    await replaceInput(page).fill('X');
    await page.locator(`${BAR} [data-role="replaceAll"]`).click();
    await page.locator('.custom-dialog .dialog-confirm').click();
    await expect(counter(page)).toHaveText('1 / 1');
    await expect(page.locator('.notification-container .notification.warning .notification-message'))
      .toContainText('пропущено 1');

    const state = await page.evaluate(() => {
      const ed = document.querySelector(
        '.textblock-editor[data-text-block-id="txt-seed-1"]',
      ) as HTMLElement;
      const cap = ed.querySelector('.text-link') as HTMLElement | null;
      // Внешний текст — всё, кроме тела капсулы.
      let outer = '';
      ed.childNodes.forEach((n) => {
        if (!(n.nodeType === 1 && (n as HTMLElement).classList.contains('text-link'))) {
          outer += n.textContent || '';
        }
      });
      outer = outer.replace(/[﻿​]/g, '');
      return {
        capAlive: !!cap,
        capId: cap?.getAttribute('data-link-id') ?? null,
        capUrl: cap?.getAttribute('data-link-url') ?? null,
        capText: cap?.textContent ?? null,
        outer,
        content: (window as any).AppState.textBlocks['txt-seed-1'].content as string,
      };
    });

    // Капсула байт-в-байт цела.
    expect(state.capAlive).toBe(true);
    expect(state.capId).toBe('cap1');
    expect(state.capUrl).toBe('https://a.ru');
    expect(state.capText).toBe('слово-ссылка');
    expect(state.content).toContain('data-link-id="cap1"');
    expect(state.content).toContain('data-link-url="https://a.ru"');
    expect(state.content).toContain('слово-ссылка');

    // Два ВНЕШНИХ «слово» стали «X»; снаружи капсулы «слово» не осталось.
    expect(state.outer).not.toContain('слово');
    expect((state.outer.match(/X/g) || []).length).toBe(2);
  });
});

test.describe('Find/Replace (Task B): капсула-ссылка — собственный видимый текст', () => {
  test.beforeEach(async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    await openStep2(page);
  });

  const LINK_TEXT_HTML =
    'текст ' +
    '<span class="text-link" data-link-id="cap1" data-link-url="https://a.ru"' +
    ' contenteditable="false">важное слово</span>' +
    ' текст';

  // 8. Поиск находит СОБСТВЕННЫЙ видимый текст капсулы-ссылки (capsuleText-пробег,
  // act-search-engine.js::_collectCapsuleTextRun) — у него есть реальный DOM Range,
  // поэтому он попадает и в подсветку.
  test('поиск находит видимый текст капсулы-ссылки; подсветка его включает', async ({ page }) => {
    await seed(page, LINK_TEXT_HTML);
    await openBar(page);

    await findInput(page).fill('важное');
    await expect(counter(page)).toHaveText('1 / 1');
    expect(await highlightSize(page, 'act-find')).toBe(1);
  });

  // 9. Замена совпадения, целиком лежащего ВНУТРИ текста капсулы, отклоняется
  // движком (replaceRange._hasCapsuleAncestor) — «Заменить всё» ловит исключение,
  // считает его как «пропущено», капсула остаётся байт-в-байт цела.
  test('«Заменить всё» на совпадении внутри капсулы отклоняется; капсула цела', async ({ page }) => {
    await seed(page, LINK_TEXT_HTML);
    await openBar(page);

    await findInput(page).fill('важное');
    await expect(counter(page)).toHaveText('1 / 1');

    await replaceInput(page).fill('X');
    await page.locator(`${BAR} [data-role="replaceAll"]`).click();
    await page.locator('.custom-dialog .dialog-confirm').click();

    // Замена отклонена (диапазон пересекает капсулу) → совпадение никуда не делось.
    await expect(counter(page)).toHaveText('1 / 1');

    const warn = page.locator('.notification-container .notification.warning .notification-message');
    await expect(warn).toContainText('пропущено 1');

    const state = await page.evaluate(() => {
      const ed = document.querySelector(
        '.textblock-editor[data-text-block-id="txt-seed-1"]',
      ) as HTMLElement;
      const cap = ed.querySelector('.text-link') as HTMLElement | null;
      return {
        capId: cap?.getAttribute('data-link-id') ?? null,
        capUrl: cap?.getAttribute('data-link-url') ?? null,
        capText: cap?.textContent ?? null,
        content: (window as any).AppState.textBlocks['txt-seed-1'].content as string,
      };
    });

    expect(state.capId).toBe('cap1');
    expect(state.capUrl).toBe('https://a.ru');
    expect(state.capText).toBe('важное слово');
    expect(state.content).toContain('data-link-id="cap1"');
    expect(state.content).toContain('важное слово');
    expect(state.content).not.toContain('X'); // замена нигде не применилась
  });
});

test.describe('Find/Replace (Task B): тело сноски (data-footnote-text)', () => {
  test.beforeEach(async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    await openStep2(page);
  });

  const FOOTNOTE_HTML =
    'текст ' +
    '<span class="text-footnote" data-footnote-id="fn1" data-footnote-text="тайное послание сноски"' +
    ' contenteditable="false">якорь</span>' +
    ' текст';

  // 10. Поиск находит текст ТЕЛА сноски (FootnoteBodySearchTarget, act-search-
  // engine.js) — невидимая в DOM поверхность, у совпадения range:null, поэтому оно
  // не входит в CSS Custom Highlight, но входит в счётчик. Навигация next/prev к
  // такому совпадению открывает форсированный tooltip и не должна ронять страницу.
  test('поиск находит текст в теле сноски; навигация к нему не бросает ошибок', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await seed(page, FOOTNOTE_HTML);
    await openBar(page);

    await findInput(page).fill('тайное');
    await expect(counter(page)).toHaveText('1 / 1');
    // Нет DOM Range (текст сидит в атрибуте, не в узле) — в 'act-find' не входит.
    expect(await highlightSize(page, 'act-find')).toBe(0);

    // Форсированный tooltip тела сноски с <mark> вокруг найденной подстроки.
    const tooltip = page.locator('.link-footnote-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('mark')).toHaveText('тайное');

    const next = page.locator(`${BAR} [data-role="next"]`);
    const prev = page.locator(`${BAR} [data-role="prev"]`);
    await next.click();
    await expect(counter(page)).toHaveText('1 / 1');
    await prev.click();
    await expect(counter(page)).toHaveText('1 / 1');

    expect(errors).toEqual([]);
  });

  // 11. «Заменить» правит ТЕЛО сноски сплайсом строки атрибута
  // (FindBar._spliceFootnoteBodyText), не Range API, и персистится через
  // finalizeEdit в AppState.textBlocks[id].content; видимый якорь не затрагивается.
  test('«Заменить» правит тело сноски и персистится в AppState', async ({ page }) => {
    await seed(page, FOOTNOTE_HTML);
    await openBar(page);

    await findInput(page).fill('тайное');
    await expect(counter(page)).toHaveText('1 / 1');

    await replaceInput(page).fill('секретное');
    await page.locator(`${BAR} [data-role="replaceOne"]`).click();

    // Единственное совпадение заменено — «тайное» больше не встречается.
    await expect(counter(page)).toHaveText('0 / 0');

    const state = await page.evaluate(() => {
      const ed = document.querySelector(
        '.textblock-editor[data-text-block-id="txt-seed-1"]',
      ) as HTMLElement;
      const fn = ed.querySelector('.text-footnote') as HTMLElement | null;
      return {
        footnoteText: fn?.getAttribute('data-footnote-text') ?? null,
        anchorText: fn?.textContent ?? null,
      };
    });
    expect(state.footnoteText).toBe('секретное послание сноски');
    expect(state.anchorText).toBe('якорь'); // видимый якорь не затронут

    const content = await stateContent(page);
    expect(content).toContain('data-footnote-text="секретное послание сноски"');
  });

  // 12. «Заменить всё» с совпадениями И во внешнем тексте, И в теле сноски ОДНОГО
  // блока — регресс на дедуп persist(): TextBlockSearchTarget и
  // FootnoteBodySearchTarget одной сноски делят один editor/blockId; persist()
  // (finalizeEdit) должен зваться РОВНО ОДИН раз на блок, ПОСЛЕ того как обе мутации
  // (текст + атрибут сноски) применены — иначе ранний finalizeEdit прочитал бы
  // editor.innerHTML до того, как в него попала более поздняя по циклу правка.
  test('«Заменить всё» правит и внешний текст, и тело сноски одного блока — обе правки персистятся', async ({ page }) => {
    const html =
      'слово в тексте ' +
      '<span class="text-footnote" data-footnote-id="fn1" data-footnote-text="слово в сноске"' +
      ' contenteditable="false">якорь</span>';
    await seed(page, html);
    await openBar(page);

    await findInput(page).fill('слово');
    await expect(counter(page)).toHaveText('1 / 2'); // 1 во внешнем тексте + 1 в теле сноски

    await replaceInput(page).fill('X');
    await page.locator(`${BAR} [data-role="replaceAll"]`).click();
    await page.locator('.custom-dialog .dialog-confirm').click();
    await expect(counter(page)).toHaveText('0 / 0');

    const state = await page.evaluate(() => {
      const ed = document.querySelector(
        '.textblock-editor[data-text-block-id="txt-seed-1"]',
      ) as HTMLElement;
      const fn = ed.querySelector('.text-footnote') as HTMLElement | null;
      return {
        footnoteText: fn?.getAttribute('data-footnote-text') ?? null,
        content: (window as any).AppState.textBlocks['txt-seed-1'].content as string,
      };
    });
    // Обе правки видны в ОДНОМ финальном content — не потеряны более ранним persist().
    expect(state.footnoteText).toBe('X в сноске');
    expect(state.content).toContain('X в тексте');
    expect(state.content).toContain('data-footnote-text="X в сноске"');
  });
});

test.describe('Find/Replace (Task B): regex, слово целиком, ошибки', () => {
  test.beforeEach(async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    await openStep2(page);
  });

  // 6a. Регулярное выражение.
  test('regex-режим применяет шаблон (char-class матчит все «акт»)', async ({ page }) => {
    await seed(page, 'акт первый характеристика акт второй');
    await openBar(page);
    await page.locator(`${BAR} [data-toggle="regex"]`).click();
    // «а<любая кир.буква>т» → матчит «акт» (в т.ч. внутри «характеристика»).
    await findInput(page).fill('а[а-я]т');
    await expect(counter(page)).toHaveText('1 / 3');
    expect(await highlightSize(page, 'act-find')).toBe(3);
  });

  // 6b. Слово целиком — граница по Unicode-буквам (кириллица).
  test('«слово целиком»: «акт» не матчится внутри «характеристика»', async ({ page }) => {
    await seed(page, 'акт первый характеристика акт второй');
    await openBar(page);

    // Без опции: 3 совпадения (включая подстроку в «характеристика»).
    await findInput(page).fill('акт');
    await expect(counter(page)).toHaveText('1 / 3');

    // Слово целиком: только 2 отдельных «акт».
    await page.locator(`${BAR} [data-toggle="wholeWord"]`).click();
    await expect(counter(page)).toHaveText('1 / 2');
    expect(await highlightSize(page, 'act-find')).toBe(2);
  });

  // 6c. Невалидный regex → ошибка без падения; панель остаётся рабочей.
  test('невалидный regex показывает ошибку, не роняет страницу, панель остаётся рабочей', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await seed(page, 'кот кот');
    await openBar(page);
    await page.locator(`${BAR} [data-toggle="regex"]`).click();

    await findInput(page).fill('['); // незакрытый класс — SyntaxError при компиляции
    await expect(findInput(page)).toHaveClass(/act-find-input-error/);
    await expect(counter(page)).toHaveText('0 / 0');

    // Панель осталась рабочей: валидный запрос снимает ошибку и находит совпадения.
    await findInput(page).fill('кот');
    await expect(findInput(page)).not.toHaveClass(/act-find-input-error/);
    await expect(counter(page)).toHaveText('1 / 2');

    expect(errors).toEqual([]); // ни одного необработанного исключения
  });
});

test.describe('Find/Replace (Task B): read-only', () => {
  test.beforeEach(async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    await openStep2(page);
  });

  // 7. Read-only акт: строка замены скрыта, поиск доступен.
  test('read-only скрывает строку замены, поле поиска доступно', async ({ page }) => {
    await seed(page, 'кот кот кот');
    // Форсим read-only ДО открытия панели — _applyReadOnly читает флаг на open().
    await page.evaluate(() => {
      (window as any).AppConfig.readOnlyMode.isReadOnly = true;
    });
    await openBar(page);

    await expect(page.locator(`${BAR} [data-role="replaceRow"]`)).toBeHidden();
    await expect(findInput(page)).toBeVisible();

    // Поиск в read-only по-прежнему работает.
    await findInput(page).fill('кот');
    await expect(counter(page)).toHaveText('1 / 3');
    expect(await highlightSize(page, 'act-find')).toBe(3);
  });
});

test.describe('Find/Replace (Task B): кнопка во всплывающем тулбаре редактора', () => {
  test.beforeEach(async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    await openStep2(page);
  });

  // 13. Кнопка 🔍 (data-command="findReplace") в #globalTextBlockToolbar
  // (тот же тулбар, что жирный/курсив/размер/ссылка/сноска) открывает панель
  // поиска. В отличие от прочих команд тулбара, редактор НЕ перефокусируется
  // после клика (иначе activeEditor.focus() увёл бы фокус от поля поиска) —
  // тулбар вместо этого явно скрывается (textblock-toolbar.js).
  test('кнопка поиска в тулбаре открывает панель и скрывает сам тулбар', async ({ page }) => {
    await seed(page, 'кот кот');

    const editor = page.locator(EDITOR_SEL);
    await editor.click(); // фокус → показывает #globalTextBlockToolbar

    const toolbarBtn = page.locator(
      '#globalTextBlockToolbar .toolbar-btn[data-command="findReplace"]',
    );
    await expect(toolbarBtn).toBeVisible();
    await toolbarBtn.click();

    await expect(page.locator(BAR)).not.toHaveClass(/\bhidden\b/);
    await expect(findInput(page)).toBeFocused();
    await expect(page.locator('#globalTextBlockToolbar')).toHaveClass(/\bhidden\b/);

    // Панель рабочая: поиск находит совпадения.
    await findInput(page).fill('кот');
    await expect(counter(page)).toHaveText('1 / 2');
  });
});
