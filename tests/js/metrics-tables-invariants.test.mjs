/**
 * Инварианты сводных таблиц метрик (tree-10 / state-7).
 *
 *  - tree-10: updateMetricsTableLabel обновляет только АВТОгенерируемую метку
 *    (пустую или с каноническим префиксом «Объем выявленных отклонений
 *    (В метриках) по …»). Пользовательский customLabel перенумерация не затирает.
 *  - state-7: объект сводной таблицы зеркалит флаг узла deletable=false —
 *    раньше узел был deletable:false, а table-объект deletable:true, и
 *    рассинхрон уезжал в сериализацию.
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import '../../static/js/constructor/state/state-tree.js';
import '../../static/js/constructor/state/state-content.js';
import { KIND_METRICS, KIND_MAIN_METRICS } from '../../static/js/constructor/table/table-kind.js';

beforeEach(() => {
    // Разделы 1-4 нужны, чтобы generateNumbering дал разделу 5 номер «5»
    // (а пункту n51 — «5.1») — иначе ветка updateMetricsTableLabel не зовётся.
    AppState.treeData = {
        id: 'root',
        label: 'Акт',
        children: [
            { id: '1', label: 'Раздел 1', number: '1', protected: true, children: [] },
            { id: '2', label: 'Раздел 2', number: '2', protected: true, children: [] },
            { id: '3', label: 'Раздел 3', number: '3', protected: true, children: [] },
            { id: '4', label: 'Раздел 4', number: '4', protected: true, children: [] },
            {
                id: '5',
                label: 'Раздел 5',
                number: '5',
                protected: true,
                deletable: false,
                children: [
                    { id: 'n51', type: 'item', number: '5.1', label: 'Пункт', children: [] },
                ],
            },
        ],
    };
    AppState.tables = {};
    AppState.textBlocks = {};
    AppState.violations = {};
    AppState._rebuildNodeIndex();
});

// ──────────────────────────────────────────────────────────────────────────
// tree-10: guard пользовательского customLabel
// ──────────────────────────────────────────────────────────────────────────

test('updateMetricsTableLabel: автогенерируемая метка обновляется под новый номер', () => {
    const node = AppState.findNodeById('n51');
    node.children.push({
        id: 'mt1',
        type: 'table',
        kind: KIND_METRICS,
        tableId: 't1',
        label: 'Объем выявленных отклонений (В метриках) по 5.2',
        customLabel: 'Объем выявленных отклонений (В метриках) по 5.2',
    });
    AppState._rebuildNodeIndex();

    AppState.updateMetricsTableLabel('n51');

    const mt = AppState.findNodeById('mt1');
    assert.equal(mt.label, 'Объем выявленных отклонений (В метриках) по 5.1');
    assert.equal(mt.customLabel, 'Объем выявленных отклонений (В метриках) по 5.1');
});

test('updateMetricsTableLabel: пустой customLabel считается автогенерируемым и обновляется', () => {
    const node = AppState.findNodeById('n51');
    node.children.push({
        id: 'mt1',
        type: 'table',
        kind: KIND_METRICS,
        tableId: 't1',
        label: 'Таблица',
        customLabel: '',
    });
    AppState._rebuildNodeIndex();

    AppState.updateMetricsTableLabel('n51');

    const mt = AppState.findNodeById('mt1');
    assert.equal(mt.customLabel, 'Объем выявленных отклонений (В метриках) по 5.1');
});

test('updateMetricsTableLabel: пользовательский customLabel НЕ затирается', () => {
    const node = AppState.findNodeById('n51');
    node.children.push({
        id: 'mt1',
        type: 'table',
        kind: KIND_METRICS,
        tableId: 't1',
        label: 'Моя сводная',
        customLabel: 'Моя сводная',
    });
    AppState._rebuildNodeIndex();

    AppState.updateMetricsTableLabel('n51');

    const mt = AppState.findNodeById('mt1');
    assert.equal(mt.customLabel, 'Моя сводная', 'пользовательскую метку нельзя перезаписывать');
    assert.equal(mt.label, 'Моя сводная');
});

test('generateNumbering: перенумерация не затирает пользовательскую метку сводной', () => {
    const node = AppState.findNodeById('n51');
    node.children.push({
        id: 'mt1',
        type: 'table',
        kind: KIND_METRICS,
        tableId: 't1',
        label: 'Моя сводная',
        customLabel: 'Моя сводная',
    });
    AppState._rebuildNodeIndex();

    AppState.generateNumbering();

    const mt = AppState.findNodeById('mt1');
    assert.equal(mt.customLabel, 'Моя сводная');
});

// ──────────────────────────────────────────────────────────────────────────
// state-7: deletable table-объекта зеркалит узел
// ──────────────────────────────────────────────────────────────────────────

test('_createMetricsTable: узел и table-объект согласованы (deletable=false)', () => {
    const result = AppState._createMetricsTable('n51', '5.1');
    assert.equal(result.valid, true);

    const node = AppState.findNodeById('n51');
    const tableNode = node.children.find(c => c.kind === KIND_METRICS);
    assert.ok(tableNode, 'узел сводной таблицы создан');
    assert.equal(tableNode.deletable, false, 'узел сводной неудаляем вручную');

    const table = AppState.tables[tableNode.tableId];
    assert.equal(table.deletable, false, 'table-объект обязан зеркалить deletable узла');
    assert.equal(table.protected, true);
    assert.equal(table.kind, KIND_METRICS);
});

test('_createMainMetricsTable: узел и table-объект согласованы (deletable=false)', () => {
    const result = AppState._createMainMetricsTable();
    assert.equal(result.valid, true);

    const node5 = AppState.findNodeById('5');
    const tableNode = node5.children.find(c => c.kind === KIND_MAIN_METRICS);
    assert.ok(tableNode, 'узел главной сводной создан');
    assert.equal(tableNode.deletable, false);

    const table = AppState.tables[tableNode.tableId];
    assert.equal(table.deletable, false, 'table-объект обязан зеркалить deletable узла');
    assert.equal(table.kind, KIND_MAIN_METRICS);
});

test('сериализация сводной таблицы сохраняет deletable=false (round-trip)', () => {
    AppState._createMetricsTable('n51', '5.1');
    const exported = AppState.exportData();

    const tableIds = Object.keys(exported.tables);
    assert.equal(tableIds.length, 1);
    assert.equal(exported.tables[tableIds[0]].deletable, false);
    assert.equal(exported.tables[tableIds[0]].kind, KIND_METRICS);
});
