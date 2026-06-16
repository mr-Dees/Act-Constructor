/**
 * Горячие read-пути по raw (перф-волна, M.9 / 5.1.5).
 *
 * exportData/generateNumbering/индекс узлов ходят по raw-данным мимо
 * Proxy get-трапов. Инвариант безопасности: после любых raw-чтений
 * dirty-tracking ПОСЛЕДУЮЩИХ записей через публичный API (findNodeById →
 * мутация узла, AppState.tables[...] → мутация ячейки) обязан работать —
 * наружу raw-узлы не отдаются.
 *
 * Файл изолирован: _initStateTracking() переопределяет свойства AppState
 * на весь процесс (node --test исполняет каждый файл отдельным процессом).
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppState, _initStateTracking, _unwrap } from '../../static/js/constructor/state/state-core.js';
import '../../static/js/constructor/state/state-tree.js';
import '../../static/js/constructor/state/state-content.js';
import { StorageManager } from '../../static/js/constructor/storage-manager.js';

// Шпион markAsUnsaved — единственная точка dirty-уведомлений Proxy-трекинга.
let dirtyCalls = 0;
StorageManager.markAsUnsaved = () => { dirtyCalls++; };

// Активируем deep-tracking ОДИН раз (как entries/constructor.js в проде).
AppState.treeData = { id: 'root', label: 'Акт', children: [] };
_initStateTracking();

beforeEach(() => {
    AppState.treeData = {
        id: 'root',
        label: 'Акт',
        children: [
            { id: 'n1', label: 'Пункт', type: 'item', children: [
                { id: 'n1t', label: 'Таблица', type: 'table', tableId: 't1' },
            ] },
        ],
    };
    AppState.tables = {
        t1: {
            id: 't1', nodeId: 'n1t', colWidths: [100], protected: false, deletable: true,
            grid: [[{ content: 'x', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 }]],
        },
    };
    AppState.textBlocks = {};
    AppState.violations = {};
    AppState._rebuildNodeIndex();
    dirtyCalls = 0;
});

test('raw-чтения (exportData, generateNumbering, индекс) не дёргают markAsUnsaved', () => {
    AppState.exportData();
    AppState._findNodeRaw('n1');
    AppState._findParentRaw('n1t');
    assert.equal(dirtyCalls, 0, 'read-only пути не должны помечать состояние dirty');
});

test('после raw-чтений запись через findNodeById ловится трекингом', () => {
    AppState.exportData();
    AppState.generateNumbering();
    dirtyCalls = 0;

    const node = AppState.findNodeById('n1');
    node.label = 'Переименован';

    assert.ok(dirtyCalls > 0, 'мутация узла из findNodeById обязана пометить dirty');
    // Запись дошла до raw-данных (одни и те же объекты).
    assert.equal(AppState._findNodeRaw('n1').label, 'Переименован');
});

test('после raw-чтений запись в ячейку через AppState.tables ловится трекингом', () => {
    AppState.exportData();
    dirtyCalls = 0;

    AppState.tables.t1.grid[0][0].content = 'новое значение';

    assert.ok(dirtyCalls > 0, 'мутация ячейки через AppState.tables обязана пометить dirty');
    assert.equal(_unwrap(AppState.tables).t1.grid[0][0].content, 'новое значение');
});

test('exportData отдаёт plain-копию: мутация результата не задевает состояние', () => {
    const exported = AppState.exportData();
    dirtyCalls = 0;

    exported.tree.label = 'испорчено';
    exported.tables.t1.grid[0][0].content = 'испорчено';

    assert.equal(dirtyCalls, 0, 'мутация экспортированной копии не должна помечать dirty');
    assert.equal(_unwrap(AppState.treeData).label, 'Акт');
    assert.equal(_unwrap(AppState.tables).t1.grid[0][0].content, 'x');
});

test('findNodeById при активном трекинге не отдаёт raw-узел', () => {
    const node = AppState.findNodeById('n1');
    assert.notEqual(node, AppState._findNodeRaw('n1'), 'наружу должен уходить tracking-Proxy, не raw');
    assert.equal(_unwrap(node), AppState._findNodeRaw('n1'), 'Proxy обязан оборачивать тот же raw-узел');
});
