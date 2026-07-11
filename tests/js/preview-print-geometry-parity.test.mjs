/**
 * Паритет геометрии печатного листа: превью ↔ DOCX (Task C, супersedes B-22).
 *
 * DOM-рендер CSS в node недоступен (нет браузера), поэтому — как и прочие
 * *-parity.test.mjs — тест читает CSS-файлы ТЕКСТОМ и пинит golden-значения
 * из app/domains/acts/formatters/docx/styles.py::Spacing/Sizes:
 *   - line_single (w:line=240, «одинарный» Word-интервал) ⇔ CSS line-height
 *     ~1.15 для Times New Roman 12pt;
 *   - after_pt = 3 (Normal-спейсинг после абзаца) ⇔ margin-bottom: 3pt после
 *     текстблока целиком (_render_textblock зануляет space_after у ВСЕХ
 *     промежуточных w:p, 3pt остаётся только у последнего сегмента);
 *   - blank_line_pt = 6 (add_blank_line после таблицы) ⇔ margin: 6pt у
 *     .preview-table-wrapper на листе.
 *
 * Инвариант: превью текстблока рисует РОВНО то, что уйдёт в Word, а не
 * поверхность правки (.textblock-editor остаётся на 1.75 — отдельно
 * пином, что редактор НЕ задет).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const previewPageCss = readFileSync(
    fileURLToPath(new URL('../../static/css/constructor/preview/preview-page.css', import.meta.url)),
    'utf8',
);
const previewTypographyCss = readFileSync(
    fileURLToPath(new URL('../../static/css/constructor/preview/preview-typography.css', import.meta.url)),
    'utf8',
);
const editorContentCss = readFileSync(
    fileURLToPath(new URL('../../static/css/constructor/textblock/textblock-content.css', import.meta.url)),
    'utf8',
);

// Golden-числа из styles.py — держим их в тесте буквально, чтобы разъезд
// значений (кто-то поправит styles.py и забудет CSS) падал явным диффом.
const DOCX_LINE_SINGLE_CSS = '1.15'; // Word «одинарный» для TNR 12pt
const DOCX_SPACING_AFTER_PT = 3; // Spacing.after_pt
const DOCX_BLANK_LINE_PT = 6; // Sizes.blank_line_pt (add_blank_line после таблицы)
const EDITOR_LINE_HEIGHT_FALLBACK = '1.75'; // --textblock-line-height, редактор-only

test('preview-page.css: токен --preview-print-line-height задан как Word-одинарный (1.15)', () => {
    const match = previewPageCss.match(/--preview-print-line-height:\s*([\d.]+)/);
    assert.ok(match, 'токен --preview-print-line-height не найден в preview-page.css');
    assert.equal(match[1], DOCX_LINE_SINGLE_CSS);
});

test('preview-page.css: .preview-sheet использует токен --preview-print-line-height (не хардкод)', () => {
    assert.match(
        previewPageCss,
        /\.preview-sheet\s*\{[^}]*line-height:\s*var\(--preview-print-line-height\)/s,
        '.preview-sheet должен читать line-height из токена',
    );
});

test('preview-typography.css: .preview-sheet .preview-textblock-content — line-height печатного листа', () => {
    const rule = previewTypographyCss.match(
        /\.preview-sheet \.preview-textblock-content\s*\{([^}]*)\}/s,
    );
    assert.ok(rule, 'правило .preview-sheet .preview-textblock-content не найдено');
    assert.match(
        rule[1],
        /line-height:\s*var\(--preview-print-line-height,\s*1\.15\)/,
        `line-height блока на листе не пинит Word-single: ${rule[1]}`,
    );
});

test('preview-typography.css: 3pt после текстблока целиком (Spacing.after_pt)', () => {
    const rule = previewTypographyCss.match(
        /\.preview-sheet \.preview-textblock-content\s*\{([^}]*)\}/s,
    );
    assert.ok(rule, 'правило .preview-sheet .preview-textblock-content не найдено');
    assert.match(
        rule[1],
        new RegExp(`margin-bottom:\\s*${DOCX_SPACING_AFTER_PT}pt`),
        `margin-bottom текстблока ≠ ${DOCX_SPACING_AFTER_PT}pt: ${rule[1]}`,
    );
});

test('preview-typography.css: сегменты текстблока БЕЗ зазора между собой (обнулённый space_after)', () => {
    const rule = previewTypographyCss.match(
        /\.preview-sheet \.preview-textblock-content > \*\s*\{([^}]*)\}/s,
    );
    assert.ok(rule, 'правило сброса margin у сегментов текстблока не найдено');
    assert.match(rule[1], /margin-top:\s*0/);
    assert.match(rule[1], /margin-bottom:\s*0/);
});

test('preview-page.css: .preview-table-wrapper на листе — 6pt (add_blank_line после таблицы)', () => {
    const rule = previewPageCss.match(
        /\.preview-sheet \.preview-table-wrapper\s*\{([^}]*)\}/s,
    );
    assert.ok(rule, 'правило .preview-sheet .preview-table-wrapper не найдено');
    assert.match(
        rule[1],
        new RegExp(`margin:\\s*${DOCX_BLANK_LINE_PT}pt`),
        `margin таблицы ≠ ${DOCX_BLANK_LINE_PT}pt: ${rule[1]}`,
    );
});

test('B-22 НЕ регрессирует: редактор текстблока остаётся на 1.75, токен не менялся', () => {
    const rule = editorContentCss.match(/\.textblock-editor\s*\{([^}]*)\}/s);
    assert.ok(rule, 'правило .textblock-editor не найдено');
    assert.match(
        rule[1],
        new RegExp(`line-height:\\s*var\\(--textblock-line-height,\\s*${EDITOR_LINE_HEIGHT_FALLBACK}\\)`),
        `.textblock-editor line-height изменился (должен остаться ${EDITOR_LINE_HEIGHT_FALLBACK}): ${rule[1]}`,
    );
});

test('печатный line-height (1.15) и редакторский фолбэк (1.75) — разные значения (превью больше не зеркалит редактор)', () => {
    assert.notEqual(DOCX_LINE_SINGLE_CSS, EDITOR_LINE_HEIGHT_FALLBACK);
});
