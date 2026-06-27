import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * Регрессия: размер шрифта × inline-маркеры (ссылки/сноски) в текстблоке.
 *
 * Ловит два live-бага, которые принципиально НЕ ловятся node:test —
 * стабы _browser-stub.mjs не моделируют Range.extractContents,
 * contentEditable=false и Selection API:
 *  - BUG-1: маркер масштабируется лишь ОДНАЖДЫ, потом застывает (завязка на
 *    хрупкий range.intersectsNode + кража фокуса нативным <select>, который
 *    схлопывает выделение в contenteditable).
 *  - BUG-2: при границе выделения ВНУТРИ contentEditable=false маркера
 *    range.extractContents() клонирует его → дубль ссылки в начале строки.
 *
 * Драйвим реальный applyFontSize через window.textBlockManager на настоящем
 * DOM/Selection (page.evaluate) — единственный способ воспроизвести семантику.
 * saveContent/updateToolbarState заглушаем, чтобы изолировать DOM-мутацию.
 */
test.describe('Textblock font-size × markers (regression)', () => {
  test.beforeEach(async ({ page }) => {
    await openAct(page, SEED_ACTS.withContent);
    await page.locator('.step[data-step="2"]').click();
    await page
      .locator('.textblock-editor[data-text-block-id="txt-seed-1"]')
      .waitFor({ state: 'visible', timeout: 5000 });
  });

  test('BUG-2: смена размера с границей внутри ссылки не дублирует маркер', async ({ page }) => {
    const res = await page.evaluate(() => {
      const tbm = (window as any).textBlockManager;
      const editor = document.querySelector(
        '.textblock-editor[data-text-block-id="txt-seed-1"]'
      ) as HTMLElement;
      const origSave = tbm.saveContent;
      const origUpd = tbm.updateToolbarState;
      tbm.saveContent = () => {};
      tbm.updateToolbarState = () => {};
      try {
        tbm.activeEditor = editor;
        editor.innerHTML =
          'Начало <span class="text-link" data-link-id="L1" ' +
          'data-link-url="https://a.ru" contenteditable="false">ссылка</span> середина';
        const link = editor.querySelector('.text-link') as HTMLElement;
        const sel = window.getSelection()!;
        const r = document.createRange();
        r.setStart(link.firstChild!, 2); // граница ВНУТРИ ссылки
        r.setEnd(link.nextSibling!, 5);
        sel.removeAllRanges();
        sel.addRange(r);
        tbm.applyFontSize(20);
        const fc = editor.firstChild as any;
        return {
          linkCount: editor.querySelectorAll('.text-link').length,
          firstChildIsDupLink: !!(
            fc &&
            fc.nodeType === 1 &&
            fc.classList &&
            fc.classList.contains('text-link')
          ),
        };
      } finally {
        tbm.saveContent = origSave;
        tbm.updateToolbarState = origUpd;
      }
    });
    expect(res.linkCount).toBe(1);
    expect(res.firstChildIsDupLink).toBe(false);
  });

  test('BUG-1: маркеры масштабируются на каждой смене размера', async ({ page }) => {
    const res = await page.evaluate(() => {
      const tbm = (window as any).textBlockManager;
      const editor = document.querySelector(
        '.textblock-editor[data-text-block-id="txt-seed-1"]'
      ) as HTMLElement;
      const origSave = tbm.saveContent;
      const origUpd = tbm.updateToolbarState;
      tbm.saveContent = () => {};
      tbm.updateToolbarState = () => {};
      try {
        tbm.activeEditor = editor;
        editor.innerHTML =
          'A <span class="text-link" data-link-id="L1" data-link-url="https://a.ru" ' +
          'contenteditable="false">ссылка</span> B ' +
          '<span class="text-footnote" data-footnote-id="F1" data-footnote-text="прим" ' +
          'contenteditable="false">сноска</span> C';
        const sel = window.getSelection()!;
        const r = document.createRange();
        r.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(r);
        const sizes = () => ({
          link: (editor.querySelector('.text-link') as HTMLElement).style.fontSize,
          fn: (editor.querySelector('.text-footnote') as HTMLElement).style.fontSize,
          links: editor.querySelectorAll('.text-link').length,
        });
        tbm.applyFontSize(20);
        const a = sizes();
        tbm.applyFontSize(28); // selection восстановлен applyFontSize
        const b = sizes();
        tbm.applyFontSize(12);
        const c = sizes();
        return { a, b, c };
      } finally {
        tbm.saveContent = origSave;
        tbm.updateToolbarState = origUpd;
      }
    });
    expect(res.a).toEqual({ link: '20px', fn: '20px', links: 1 });
    expect(res.b).toEqual({ link: '28px', fn: '28px', links: 1 });
    expect(res.c).toEqual({ link: '12px', fn: '12px', links: 1 });
  });

  test('BUG-1: выделение восстанавливается после кражи фокуса <select>', async ({ page }) => {
    const res = await page.evaluate(() => {
      const tbm = (window as any).textBlockManager;
      const editor = document.querySelector(
        '.textblock-editor[data-text-block-id="txt-seed-1"]'
      ) as HTMLElement;
      const origSave = tbm.saveContent;
      const origUpd = tbm.updateToolbarState;
      tbm.saveContent = () => {};
      tbm.updateToolbarState = () => {};
      try {
        tbm.activeEditor = editor;
        const linkSize = () =>
          (editor.querySelector('.text-link') as HTMLElement).style.fontSize;
        const setup = () => {
          editor.innerHTML =
            'Начало <span class="text-link" data-link-id="L1" ' +
            'data-link-url="https://a.ru" contenteditable="false">ссылка</span> конец';
          const sel = window.getSelection()!;
          const r = document.createRange();
          r.selectNodeContents(editor);
          sel.removeAllRanges();
          sel.addRange(r);
        };
        // (A) Без восстановления: collapse имитирует кражу фокуса → застывание.
        setup();
        tbm.applyFontSize(20);
        const noRestore20 = linkSize();
        window.getSelection()!.collapseToEnd();
        tbm.applyFontSize(28);
        const noRestore28 = linkSize();
        // (B) С восстановлением (mousedown→capture, change→restore).
        setup();
        tbm.applyFontSize(20);
        const restore20 = linkSize();
        tbm._captureEditorRange();
        window.getSelection()!.collapseToEnd();
        tbm._restoreEditorRange();
        tbm.applyFontSize(28);
        const restore28 = linkSize();
        return { noRestore20, noRestore28, restore20, restore28 };
      } finally {
        tbm.saveContent = origSave;
        tbm.updateToolbarState = origUpd;
      }
    });
    // Причина бага: без восстановления выделения маркер застывает на первом размере.
    expect(res.noRestore20).toBe('20px');
    expect(res.noRestore28).toBe('20px');
    // С восстановлением — корректно меняется на каждой смене.
    expect(res.restore20).toBe('20px');
    expect(res.restore28).toBe('28px');
  });
});
