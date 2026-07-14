/**
 * Golden-тест полноты ПРЕВЬЮ (зеркало tests/domains/acts/golden/, Б-2.3).
 *
 * Та же фикстура-эталон (компактная JS-форма с теми же GOLDEN_-маркерами,
 * что в tests/domains/acts/golden/fixture_act.py) прогоняется через ЧИСТЫЕ
 * функции превью: collectViolationLines + imagePresentationStyle
 * (preview-violation-renderer) и iterateVisibleCells (grid-merges).
 *
 * Политика — как у бэкового golden: presence данных, не равенство подписей
 * (Д.3). Полный DOM-рендер (PreviewTableRenderer/PreviewTextBlockRenderer/
 * preview.js) в node без DOM невозможен — что не покрыто, перечислено в
 * README golden-пакета и отчёте ветки.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    collectViolationLines,
    imagePresentationStyle,
} from '../../static/js/constructor/preview/preview-violation-renderer.js';
import { iterateVisibleCells } from '../../static/js/constructor/table/grid-merges.js';

// --- Фикстура: зеркало fixture_act.py (нарушение + обычная таблица) ---

const GOLDEN_PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
    'AAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const goldenViolation = {
    id: 'v1',
    nodeId: 'n_v',
    violated: 'GOLDEN_V_VIOLATED',
    established: 'GOLDEN_V_ESTABLISHED',
    descriptionList: {
        enabled: true,
        items: ['GOLDEN_V_DESC_1', 'GOLDEN_V_DESC_2', 'GOLDEN_V_DESC_3'],
    },
    additionalContent: {
        enabled: true,
        items: [
            { id: 'ac1', type: 'case', content: 'GOLDEN_V_CASE_1', order: 0 },
            { id: 'ac2', type: 'case', content: 'GOLDEN_V_CASE_2', order: 1 },
            { id: 'ac3', type: 'freeText', content: 'GOLDEN_V_FREETEXT', order: 2 },
            {
                id: 'ac4',
                type: 'image',
                url: GOLDEN_PNG_DATA_URL,
                caption: 'GOLDEN_V_IMG_CAPTION',
                filename: 'golden_image.png',
                order: 3,
                width: 50,
            },
        ],
    },
    reasons: { enabled: true, content: 'GOLDEN_V_REASONS' },
    consequences: { enabled: true, content: 'GOLDEN_V_CONSEQUENCES' },
    responsible: { enabled: true, content: 'GOLDEN_V_RESPONSIBLE' },
    recommendations: { enabled: true, content: 'GOLDEN_V_RECOMMENDATIONS' },
};

// Обычная таблица фикстуры: шапка + merge по горизонтали и вертикали + спецсимволы.
const goldenRegularGrid = [
    [
        { content: 'GOLDEN_RTBL_H0', isHeader: true, colSpan: 1, rowSpan: 1 },
        { content: 'GOLDEN_RTBL_H1', isHeader: true, colSpan: 1, rowSpan: 1 },
        { content: 'GOLDEN_RTBL_H2', isHeader: true, colSpan: 1, rowSpan: 1 },
    ],
    [
        { content: 'GOLDEN_RTBL_MERGED', colSpan: 2, rowSpan: 1 },
        { content: '', colSpan: 1, rowSpan: 1, isSpanned: true, spanOrigin: { row: 1, col: 0 } },
        { content: 'GOLDEN_RTBL_TALL', colSpan: 1, rowSpan: 2 },
    ],
    [
        { content: 'GOLDEN_RTBL_R2C0', colSpan: 1, rowSpan: 1 },
        { content: 'GOLDEN_RTBL_SPECIALS спец x<y & "z"', colSpan: 1, rowSpan: 1 },
        { content: '', colSpan: 1, rowSpan: 1, isSpanned: true, spanOrigin: { row: 1, col: 2 } },
    ],
];

// --- Нарушение: presence всех данных в чистой модели строк превью ---

test('golden: все текстовые поля нарушения присутствуют в модели строк превью', () => {
    const lines = collectViolationLines(goldenViolation);
    const textDump = lines
        .map(l => `${l.label || ''}: ${l.text || ''} ${(l.items || []).join(' ')}`)
        .join('\n');

    const markers = [
        'GOLDEN_V_VIOLATED',
        'GOLDEN_V_ESTABLISHED',
        'GOLDEN_V_DESC_1',
        'GOLDEN_V_DESC_2',
        'GOLDEN_V_DESC_3',
        'GOLDEN_V_CASE_1',
        'GOLDEN_V_CASE_2',
        'GOLDEN_V_FREETEXT',
        'GOLDEN_V_REASONS',
        'GOLDEN_V_CONSEQUENCES',
        'GOLDEN_V_RESPONSIBLE',
        'GOLDEN_V_RECOMMENDATIONS',
    ];
    const missing = markers.filter(m => !textDump.includes(m));
    assert.deepEqual(missing, [], `превью потеряло маркеры: ${missing}`);
});

test('golden: descriptionList — все 3 пункта целиком, отдельным списком, без заголовка «В том числе» (#12)', () => {
    const list = collectViolationLines(goldenViolation).find(l => l.type === 'list');
    assert.ok(list, 'list-строка отсутствует');
    assert.deepEqual(list.items, ['GOLDEN_V_DESC_1', 'GOLDEN_V_DESC_2', 'GOLDEN_V_DESC_3']);
    assert.equal(list.label, '', 'заголовок «В том числе» убран (#12)');
});

test('golden: кейсы нумеруются «Кейс 1»/«Кейс 2» (паритет DOCX/MD/TXT)', () => {
    const lines = collectViolationLines(goldenViolation);
    assert.equal(lines.find(l => l.label === 'Кейс 1').text, 'GOLDEN_V_CASE_1');
    assert.equal(lines.find(l => l.label === 'Кейс 2').text, 'GOLDEN_V_CASE_2');
});

test('golden: свободный текст рендерится без подписи «Текст N» (#10)', () => {
    const lines = collectViolationLines(goldenViolation);
    const freeTextLine = lines.find(l => l.type === 'line' && l.text === 'GOLDEN_V_FREETEXT');
    assert.ok(freeTextLine, 'строка свободного текста отсутствует');
    assert.equal(freeTextLine.label, '');
    assert.ok(!lines.some(l => /^Текст \d+$/.test(l.label || '')), 'подписи «Текст N» не должно быть');
});

test('golden: подпись поля responsible — «Ответственные», не «Ответственный за решение проблем» (#11)', () => {
    const lines = collectViolationLines(goldenViolation);
    const line = lines.find(l => l.text === 'GOLDEN_V_RESPONSIBLE');
    assert.ok(line, 'строка responsible отсутствует');
    assert.equal(line.label, 'Ответственные');
});

test('golden: image-элемент попадает в модель строк целиком (url/caption/filename/width)', () => {
    const image = collectViolationLines(goldenViolation).find(l => l.type === 'image');
    assert.ok(image, 'image-строка отсутствует');
    assert.equal(image.item.url, GOLDEN_PNG_DATA_URL);
    assert.equal(image.item.caption, 'GOLDEN_V_IMG_CAPTION');
    assert.equal(image.item.filename, 'golden_image.png');
    assert.equal(image.item.width, 50);
});

test('golden: width=50 картинки → CSS width:50% (как DOCX: 50% полезной ширины)', () => {
    const style = imagePresentationStyle(
        goldenViolation.additionalContent.items[3], 40,
    );
    assert.equal(style.width, '50%');
    assert.ok(style.maxHeight.endsWith('mm'));
});

// --- Таблица: обход видимых ячеек (тот же helper, что у PreviewTableRenderer) ---

test('golden: iterateVisibleCells отдаёт все ячейки с данными (merge не теряет контент)', () => {
    const visible = [];
    iterateVisibleCells(goldenRegularGrid, (cell) => visible.push(cell.content));
    const dump = visible.join('|');

    const markers = [
        'GOLDEN_RTBL_H0',
        'GOLDEN_RTBL_H1',
        'GOLDEN_RTBL_H2',
        'GOLDEN_RTBL_MERGED',
        'GOLDEN_RTBL_TALL',
        'GOLDEN_RTBL_R2C0',
        'GOLDEN_RTBL_SPECIALS',
        'спец x<y & "z"',
    ];
    const missing = markers.filter(m => !dump.includes(m));
    assert.deepEqual(missing, [], `обход таблицы потерял маркеры: ${missing}`);
});

test('golden: поглощённые ячейки пропускаются и не несут данных (нет тихой потери)', () => {
    const skipped = [];
    for (const row of goldenRegularGrid) {
        for (const cell of row) {
            if (cell.isSpanned) skipped.push(cell.content);
        }
    }
    // Инвариант фикстуры и модели: контент живёт только в видимых ячейках.
    assert.deepEqual(skipped, ['', '']);
});
