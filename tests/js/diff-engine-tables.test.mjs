/**
 * Тесты расширенного диффа таблиц (#8 full, table): раньше `_diffTables` ловил
 * только изменения `cell.content`. Теперь дополнительно строится структурный
 * флаг `structure` (прагматично — флаги, НЕ дорогое попиксельное выравнивание
 * сеток):
 *   - colWidths (массив весов ширины колонок);
 *   - атрибуты ячеек isHeader/colSpan/rowSpan (заголовки/объединения);
 *   - изменение размера сетки (число строк/колонок) — флаг gridResized.
 *
 * Подвид таблицы `kind` НЕ диффится здесь: он живёт на узле дерева (node.kind)
 * и ловится _diffTree/_nodeFieldChanges (показывается бейджем на метке узла).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiffEngine } from '../../static/js/portal/acts-manager/diff-engine.js';

function cell(over = {}) {
    return { content: '', isHeader: false, colSpan: 1, rowSpan: 1, ...over };
}

function table(over = {}) {
    return { id: 't1', nodeId: 'n1', grid: [[cell()]], colWidths: [1], ...over };
}

function diffOne(oldT, newT) {
    return DiffEngine._diffTables({ t1: oldT }, { t1: newT }).t1;
}

// --- контент (прежнее поведение сохранено) ---------------------------------

test('изменение content ячейки → modified + cellDiffs', () => {
    const d = diffOne(table({ grid: [[cell({ content: 'A' })]] }), table({ grid: [[cell({ content: 'B' })]] }));
    assert.equal(d.status, 'modified');
    assert.equal(d.cellDiffs.length, 1);
    assert.deepEqual(d.cellDiffs[0], { row: 0, col: 0, old: 'A', new: 'B' });
});

test('идентичная таблица → unchanged, structure.changed=false', () => {
    const d = diffOne(table(), table());
    assert.equal(d.status, 'unchanged');
    assert.equal(d.structure.changed, false);
});

// --- colWidths --------------------------------------------------------------

test('изменение colWidths → modified + structure.colWidths', () => {
    const d = diffOne(table({ colWidths: [1, 1] }), table({ colWidths: [2, 1] }));
    assert.equal(d.status, 'modified');
    assert.equal(d.structure.changed, true);
    assert.deepEqual(d.structure.colWidths, { old: [1, 1], new: [2, 1] });
});

// --- атрибуты ячеек ---------------------------------------------------------

test('изменение isHeader ячейки → modified + structure.cellAttrs.isHeader', () => {
    const d = diffOne(table({ grid: [[cell({ isHeader: false })]] }), table({ grid: [[cell({ isHeader: true })]] }));
    assert.equal(d.status, 'modified');
    assert.equal(d.structure.cellAttrs.length, 1);
    assert.equal(d.structure.cellAttrs[0].row, 0);
    assert.equal(d.structure.cellAttrs[0].col, 0);
    assert.deepEqual(d.structure.cellAttrs[0].isHeader, { old: false, new: true });
});

test('изменение colSpan (объединение) → modified + structure.cellAttrs.colSpan', () => {
    const d = diffOne(
        table({ grid: [[cell({ colSpan: 1 }), cell()]] }),
        table({ grid: [[cell({ colSpan: 2 }), cell()]] }),
    );
    assert.equal(d.status, 'modified');
    assert.deepEqual(d.structure.cellAttrs[0].colSpan, { old: 1, new: 2 });
});

test('изменение rowSpan → modified + structure.cellAttrs.rowSpan', () => {
    const d = diffOne(
        table({ grid: [[cell({ rowSpan: 1 })], [cell()]] }),
        table({ grid: [[cell({ rowSpan: 2 })], [cell()]] }),
    );
    assert.equal(d.status, 'modified');
    assert.deepEqual(d.structure.cellAttrs[0].rowSpan, { old: 1, new: 2 });
});

// --- размер сетки -----------------------------------------------------------

test('добавление строки → modified + structure.gridResized', () => {
    const d = diffOne(table({ grid: [[cell()]] }), table({ grid: [[cell()], [cell()]] }));
    assert.equal(d.status, 'modified');
    assert.equal(d.structure.changed, true);
    assert.deepEqual(d.structure.gridResized, { oldRows: 1, oldCols: 1, newRows: 2, newCols: 1 });
});

test('добавление колонки → modified + structure.gridResized', () => {
    const d = diffOne(table({ grid: [[cell()]] }), table({ grid: [[cell(), cell()]] }));
    assert.equal(d.status, 'modified');
    assert.deepEqual(d.structure.gridResized, { oldRows: 1, oldCols: 1, newRows: 1, newCols: 2 });
});

// --- добавление / удаление таблицы -----------------------------------------

test('новая таблица → added', () => {
    const r = DiffEngine._diffTables({}, { t1: table() }).t1;
    assert.equal(r.status, 'added');
});

test('удалённая таблица → removed', () => {
    const r = DiffEngine._diffTables({ t1: table() }, {}).t1;
    assert.equal(r.status, 'removed');
});
