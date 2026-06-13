/**
 * Dirty-трекинг мутаторов состояния (state-3 / state-6).
 *
 *  - state-6: setNodeTb/setNodeInvoice мутируют узлы через tracked-Proxy
 *    (findNodeById) — Proxy сам зовёт markAsUnsaved, ручной вызов внутри
 *    мутаторов был двойной пометкой и удалён. Тесты доказывают покрытие
 *    Proxy-трекингом каждого пути мутации.
 *  - state-3: self-assign (то же значение) не помечает состояние dirty —
 *    set-трап сравнивает prev/raw, top-level сеттер сравнивает значения.
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
            { id: 'n51', type: 'item', number: '5.1', label: 'Пункт', children: [] },
        ],
    };
    AppState.tables = {};
    AppState.textBlocks = {};
    AppState.violations = {};
    AppState._rebuildNodeIndex();
    dirtyCalls = 0;
});

// ──────────────────────────────────────────────────────────────────────────
// state-6: Proxy покрывает пути мутаций setNodeTb / setNodeInvoice
// ──────────────────────────────────────────────────────────────────────────

test('setNodeTb: назначение ТБ помечает состояние dirty через Proxy', () => {
    AppState.setNodeTb('n51', 'ББ', true);

    assert.ok(dirtyCalls > 0, 'назначение ТБ обязано пометить dirty');
    assert.deepEqual(_unwrap(AppState._findNodeRaw('n51')).tb, ['ББ'], 'запись дошла до raw-узла');
});

test('setNodeTb: снятие ТБ помечает состояние dirty через Proxy', () => {
    AppState.setNodeTb('n51', 'ББ', true);
    dirtyCalls = 0;

    AppState.setNodeTb('n51', 'ББ', false);

    assert.ok(dirtyCalls > 0, 'снятие ТБ обязано пометить dirty');
    assert.deepEqual(_unwrap(AppState._findNodeRaw('n51')).tb, []);
});

test('setNodeTb: повторное назначение того же ТБ (no-op) не помечает dirty', () => {
    AppState.setNodeTb('n51', 'ББ', true);
    dirtyCalls = 0;

    AppState.setNodeTb('n51', 'ББ', true);

    assert.equal(dirtyCalls, 0, 'no-op не должен помечать состояние несохранённым');
});

test('setNodeInvoice: установка и снятие фактуры помечают dirty через Proxy', () => {
    AppState.setNodeInvoice('n51', { metric: 'ФР00001' });
    assert.ok(dirtyCalls > 0, 'установка фактуры обязана пометить dirty');
    assert.deepEqual(_unwrap(AppState._findNodeRaw('n51')).invoice, { metric: 'ФР00001' });

    dirtyCalls = 0;
    AppState.setNodeInvoice('n51', null);
    assert.ok(dirtyCalls > 0, 'снятие фактуры обязано пометить dirty');
    assert.equal(_unwrap(AppState._findNodeRaw('n51')).invoice, undefined);
});

test('setNodeInvoice: снятие отсутствующей фактуры (no-op) не помечает dirty', () => {
    AppState.setNodeInvoice('n51', null);
    assert.equal(dirtyCalls, 0);
});

// ──────────────────────────────────────────────────────────────────────────
// state-3: self-assign не даёт ложный dirty
// ──────────────────────────────────────────────────────────────────────────

test('self-assign свойства узла тем же значением не помечает dirty', () => {
    const node = AppState.findNodeById('n51');
    node.label = node.label;
    node.children = node.children;

    assert.equal(dirtyCalls, 0, 'присвоение того же значения — не изменение');
});

test('top-level self-assign (AppState.treeData = AppState.treeData) не помечает dirty', () => {
    AppState.treeData = AppState.treeData;
    AppState.tables = AppState.tables;

    assert.equal(dirtyCalls, 0);
});

test('реальное изменение после self-assign по-прежнему ловится', () => {
    const node = AppState.findNodeById('n51');
    node.label = node.label;
    assert.equal(dirtyCalls, 0);

    node.label = 'Новое имя';
    assert.ok(dirtyCalls > 0, 'настоящая мутация обязана пометить dirty');
});
