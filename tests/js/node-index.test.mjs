/**
 * Индекс id→node / childId→parent в AppState (перф-волна, §6 п.1 / M.10 / 5.1.2).
 *
 * Инварианты:
 *  - после каждой структурной операции (initializeTree, add/delete/move,
 *    создание контент-узлов, каскад metrics↔risk) индекс байт-в-байт совпадает
 *    с полным обходом дерева (по ссылкам, не по копиям);
 *  - findNodeById/findParentNode на типовых операциях НЕ уходят в fallback
 *    (console.warn — сигнал пропущенной инвалидации);
 *  - замена treeData целиком перестраивает индекс автоматически (root-check).
 *
 * Тестируются РЕАЛЬНЫЕ модули (стабы браузерных глобалов — _browser-stub.mjs,
 * импорт ПЕРВЫМ — порядок load-bearing).
 */
import './_browser-stub.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import '../../static/js/constructor/state/state-tree.js';
import '../../static/js/constructor/state/state-content.js';
import { MetricsRiskCoordinator } from '../../static/js/constructor/state/metrics-risk-coordinator.js';

// ── Шпион console.warn: fallback индекса = пропущенная инвалидация ──────────
const warns = [];
const originalWarn = console.warn;

beforeEach(() => {
    warns.length = 0;
    console.warn = (...args) => { warns.push(args.join(' ')); };
    // Чистое состояние между тестами.
    AppState.treeData = null;
    AppState.tables = {};
    AppState.textBlocks = {};
    AppState.violations = {};
    AppState._rebuildNodeIndex();
});

afterEach(() => {
    console.warn = originalWarn;
});

/** Полный обход дерева: эталонные карты id→node и childId→parent. */
function walkReference(root) {
    const nodes = new Map();
    const parents = new Map();
    const walk = (node, parent) => {
        nodes.set(node.id, node);
        if (parent) parents.set(node.id, parent);
        (node.children || []).forEach(child => walk(child, node));
    };
    if (root) walk(root, null);
    return { nodes, parents };
}

/** Сверка индекса с эталонным обходом: размер и ссылочная идентичность. */
function assertIndexConsistent(label = '') {
    const { nodes, parents } = walkReference(AppState.treeData);
    assert.equal(AppState._nodeIndex.size, nodes.size, `${label}: размер _nodeIndex`);
    assert.equal(AppState._parentIndex.size, parents.size, `${label}: размер _parentIndex`);
    for (const [id, node] of nodes) {
        assert.equal(AppState._nodeIndex.get(id), node, `${label}: _nodeIndex['${id}'] — не тот объект`);
    }
    for (const [id, parent] of parents) {
        assert.equal(AppState._parentIndex.get(id), parent, `${label}: _parentIndex['${id}'] — не тот объект`);
    }
}

/** Промахов индекса (warn-fallback) быть не должно. */
function assertNoIndexMiss() {
    const misses = warns.filter(w => w.includes('промах индекса'));
    assert.deepEqual(misses, [], 'fallback индекса — пропущенная инвалидация');
}

// ── initializeTree / загрузка ────────────────────────────────────────────────

test('индекс консистентен после initializeTree (включая предустановленные таблицы)', () => {
    AppState.initializeTree(true);
    // findNodeById лениво построил индекс ещё внутри initializeTree.
    assertIndexConsistent('initializeTree');
    const node2 = AppState.findNodeById('2');
    assert.equal(node2.id, '2');
    assertNoIndexMiss();
});

test('замена treeData целиком перестраивает индекс автоматически (root-check)', () => {
    AppState.initializeTree(true);
    const stale = AppState.findNodeById('2');
    assert.ok(stale);

    AppState.treeData = {
        id: 'root',
        label: 'Другой акт',
        children: [{ id: 'x1', label: 'Пункт', children: [], content: '' }]
    };

    assert.equal(AppState.findNodeById('2'), null, 'узел старого дерева не должен находиться');
    assert.equal(AppState.findNodeById('x1').id, 'x1');
    assertIndexConsistent('после замены treeData');
});

// ── add / delete / move ─────────────────────────────────────────────────────

test('addNode (child и sibling) поддерживает индекс', () => {
    AppState.initializeTree(true);

    assert.ok(AppState.addNode('4', 'Дочерний', true).valid);
    const child = AppState.findNodeById('4').children.at(-1);
    assert.equal(AppState.findParentNode(child.id).id, '4');

    assert.ok(AppState.addNode(child.id, 'Соседний', false).valid);
    assertIndexConsistent('addNode');
    assertNoIndexMiss();
});

test('deleteNode удаляет поддерево из индекса (включая контент-узлы)', () => {
    AppState.initializeTree(true);
    AppState.addNode('4', 'Родитель', true);
    const parent = AppState.findNodeById('4').children.at(-1);
    AppState.addNode(parent.id, 'Ребёнок', true);
    const child = parent.children.at(-1);
    AppState.addTableToNode(child.id);
    const tableNode = child.children.at(-1);

    assert.ok(AppState.deleteNode(parent.id));

    assert.equal(AppState.findNodeById(parent.id), null);
    assert.equal(AppState.findNodeById(child.id), null);
    assert.equal(AppState.findNodeById(tableNode.id), null);
    assert.equal(AppState._nodeIndex.has(child.id), false);
    assert.equal(AppState._parentIndex.has(tableNode.id), false);
    assertIndexConsistent('deleteNode');
    assertNoIndexMiss();
});

test('moveNode обновляет родителя в индексе', async () => {
    AppState.initializeTree(true);
    AppState.addNode('4', 'А', true);
    const a = AppState.findNodeById('4').children.at(-1);
    AppState.addNode('4', 'Б', true);
    const b = AppState.findNodeById('4').children.at(-1);
    AppState.addNode(a.id, 'А-ребёнок', true);
    const aChild = a.children.at(-1);

    const result = await AppState.moveNode(aChild.id, b.id, 'child');
    assert.ok(result.valid, result.message);

    assert.equal(AppState.findParentNode(aChild.id).id, b.id);
    assertIndexConsistent('moveNode');
    assertNoIndexMiss();
});

// ── контент-узлы ────────────────────────────────────────────────────────────

test('создание таблицы/текстблока/нарушения индексируется', () => {
    AppState.initializeTree(true);
    AppState.addNode('4', 'Контейнер', true);
    const node = AppState.findNodeById('4').children.at(-1);

    assert.ok(AppState.addTableToNode(node.id).valid);
    assert.ok(AppState.addTextBlockToNode(node.id).valid);
    assert.ok(AppState.addViolationToNode(node.id).valid);

    for (const child of node.children) {
        assert.equal(AppState.findNodeById(child.id), child);
        assert.equal(AppState.findParentNode(child.id), node);
    }
    assertIndexConsistent('контент-узлы');
    assertNoIndexMiss();
});

// ── каскад metrics↔risk ─────────────────────────────────────────────────────

test('каскад metrics↔risk: создание и удаление риск-таблицы держат индекс', () => {
    AppState.initializeTree(true);
    // 5.1 → 5.1.1, риск на 5.1.1 → сводная на 5.1 + главная на §5.
    AppState.addNode('5', 'Пункт 5.1', true);
    const n51 = AppState.findNodeById('5').children.at(-1);
    AppState.addNode(n51.id, 'Подпункт 5.1.1', true);
    const n511 = n51.children.at(-1);
    AppState.generateNumbering();

    assert.ok(AppState._createRegularRiskTable(n511.id).valid);
    const riskNode = n511.children[0];
    AppState.generateNumbering();
    assert.ok(MetricsRiskCoordinator.onRiskTableAdded(n511.id));

    // Сводные созданы и проиндексированы.
    const metricsNode = n51.children.find(c => c.kind === 'metrics');
    const mainNode = AppState.findNodeById('5').children.find(c => c.kind === 'mainMetrics');
    assert.ok(metricsNode, 'сводная на 5.1 не создана');
    assert.ok(mainNode, 'главная сводная не создана');
    assert.equal(AppState.findNodeById(metricsNode.id), metricsNode);
    assert.equal(AppState.findNodeById(mainNode.id), mainNode);
    assertIndexConsistent('после onRiskTableAdded');

    // Удаление риска каскадно снимает сводные — индекс не отстаёт.
    assert.ok(AppState.deleteNode(riskNode.id));
    assert.equal(AppState.findNodeById(riskNode.id), null);
    assert.equal(AppState.findNodeById(metricsNode.id), null);
    assert.equal(AppState.findNodeById(mainNode.id), null);
    assertIndexConsistent('после deleteNode риска');
    assertNoIndexMiss();
});

test('rollback каскада перестраивает индекс на восстановленные узлы', () => {
    AppState.initializeTree(true);
    AppState.addNode('5', 'Пункт 5.1', true);
    const n51 = AppState.findNodeById('5').children.at(-1);
    AppState.generateNumbering();

    // Искусственный сбой внутри каскада → rollback фасада.
    const original = AppState._updateMetricsTablesAfterRiskTableCreated;
    AppState._updateMetricsTablesAfterRiskTableCreated = () => { throw new Error('boom'); };
    try {
        const ok = MetricsRiskCoordinator.onRiskTableAdded(n51.id);
        assert.equal(ok, false);
    } finally {
        AppState._updateMetricsTablesAfterRiskTableCreated = original;
    }

    // После rollback'а findNodeById обязан отдавать актуальные (восстановленные) узлы.
    const restored51 = AppState.findNodeById('5').children.at(-1);
    assert.equal(AppState.findNodeById(restored51.id), restored51);
    assertIndexConsistent('после rollback');
    assertNoIndexMiss();
});
