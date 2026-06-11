/**
 * Таргетный snapshot/rollback каскада metrics↔risk (перф-волна, 5.1.4).
 *
 * Снапшот больше не делает JSON-копий §5 + всех таблиц: записываются только
 * children/label/customLabel/number узлов §5-поддерева (по ссылкам) и shallow
 * состав словаря tables. Семантика фасада сохраняется:
 *  - rollback после искусственного сбоя восстанавливает исходное состояние
 *    (deep-equal по treeData и tables);
 *  - нетронутые узлы/таблицы/массивы children сохраняют ссылочную идентичность.
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import '../../static/js/constructor/state/state-tree.js';
import '../../static/js/constructor/state/state-content.js';
import { MetricsRiskCoordinator } from '../../static/js/constructor/state/metrics-risk-coordinator.js';

beforeEach(() => {
    AppState.treeData = null;
    AppState.tables = {};
    AppState.textBlocks = {};
    AppState.violations = {};
    AppState._rebuildNodeIndex();
});

/** Базовая структура: акт + 5.1 → 5.1.1 (без рисков). */
function buildBase() {
    AppState.initializeTree(true);
    AppState.addNode('5', 'Пункт 5.1', true);
    const n51 = AppState.findNodeById('5').children.at(-1);
    AppState.addNode(n51.id, 'Подпункт 5.1.1', true);
    const n511 = n51.children.at(-1);
    AppState.generateNumbering();
    return { n51, n511 };
}

/** Снимок состояния для deep-equal сверки. */
function deepState() {
    return JSON.parse(JSON.stringify({ tree: AppState.treeData, tables: AppState.tables }));
}

test('rollback при сбое onRiskTableAdded: deep-equal исходному состоянию', () => {
    const { n511 } = buildBase();
    // Риск создан ДО снапшота (как в реальном флоу context-menu) — каскад
    // падает на создании главной сводной, успев создать per-point сводную.
    assert.ok(AppState._createRegularRiskTable(n511.id).valid);
    AppState.generateNumbering();

    const before = deepState();
    const original = AppState._createMainMetricsTable;
    AppState._createMainMetricsTable = () => { throw new Error('boom'); };
    let ok;
    try {
        ok = MetricsRiskCoordinator.onRiskTableAdded(n511.id);
    } finally {
        AppState._createMainMetricsTable = original;
    }

    assert.equal(ok, false);
    assert.deepEqual(deepState(), before, 'состояние после rollback отличается от исходного');
});

test('rollback при сбое удаления риска: восстанавливает узел и запись таблицы', () => {
    const { n51, n511 } = buildBase();
    assert.ok(AppState._createRegularRiskTable(n511.id).valid);
    AppState.generateNumbering();
    assert.ok(MetricsRiskCoordinator.onRiskTableAdded(n511.id));
    const riskNode = n511.children.find(c => c.kind === 'regularRisk');
    const riskTableId = riskNode.tableId;

    const before = deepState();
    const originalCleanup = AppState._cleanupMetricsTablesAfterRiskTableDeleted;
    AppState._cleanupMetricsTablesAfterRiskTableDeleted = () => { throw new Error('boom'); };
    try {
        AppState.deleteNode(riskNode.id);
    } finally {
        AppState._cleanupMetricsTablesAfterRiskTableDeleted = originalCleanup;
    }

    assert.deepEqual(deepState(), before, 'состояние после rollback отличается от исходного');
    // Удалённый риск-узел вернулся тем же объектом и виден через индекс.
    assert.equal(AppState.findNodeById(riskNode.id), riskNode);
    assert.ok(AppState.tables[riskTableId], 'запись таблицы риска не восстановлена');
});

test('rollback сохраняет ссылочную идентичность нетронутых узлов и таблиц', () => {
    const { n51, n511 } = buildBase();
    assert.ok(AppState._createRegularRiskTable(n511.id).valid);
    AppState.generateNumbering();

    // Нетронутые каскадом сущности: раздел 1 (вне §5), его children-массив,
    // предустановленная таблица раздела 2/3, сам узел 5.1 (объект не заменяется).
    const section1 = AppState.treeData.children[0];
    const section1Children = section1.children;
    const presetTableId = Object.keys(AppState.tables)[0];
    const presetTable = AppState.tables[presetTableId];
    const riskTable = AppState.tables[n511.children[0].tableId];

    const original = AppState._createMainMetricsTable;
    AppState._createMainMetricsTable = () => { throw new Error('boom'); };
    try {
        assert.equal(MetricsRiskCoordinator.onRiskTableAdded(n511.id), false);
    } finally {
        AppState._createMainMetricsTable = original;
    }

    assert.equal(AppState.treeData.children[0], section1, 'узел раздела 1 заменён');
    assert.equal(AppState.treeData.children[0].children, section1Children, 'children раздела 1 заменён');
    assert.equal(AppState.tables[presetTableId], presetTable, 'нетронутая таблица заменена копией');
    assert.equal(AppState.tables[n511.children[0].tableId], riskTable, 'объект риск-таблицы заменён копией');
    assert.equal(AppState.findNodeById(n51.id), n51, 'узел 5.1 заменён копией');
    assert.equal(AppState.findNodeById(n511.id), n511, 'узел 5.1.1 заменён копией');
});

test('успешный каскад со снапшотом не искажает результат (паритет поведения)', () => {
    const { n51, n511 } = buildBase();
    assert.ok(AppState._createRegularRiskTable(n511.id).valid);
    AppState.generateNumbering();

    assert.ok(MetricsRiskCoordinator.onRiskTableAdded(n511.id));

    const metricsNode = n51.children.find(c => c.kind === 'metrics');
    const mainNode = AppState.findNodeById('5').children.find(c => c.kind === 'mainMetrics');
    assert.ok(metricsNode, 'per-point сводная не создана');
    assert.ok(mainNode, 'главная сводная не создана');
    assert.ok(AppState.tables[metricsNode.tableId]);
    assert.ok(AppState.tables[mainNode.tableId]);
});
