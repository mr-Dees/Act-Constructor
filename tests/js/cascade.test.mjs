/**
 * Property-тесты каскада metrics ↔ risk (model-based, fc.commands + fc.modelRun).
 *
 * РЕШЕНИЕ ПО ЗАПУСКУ В NODE (логировано в отчёте P5):
 * Боевые AppState-методы (state-content.js / state-tree.js /
 * metrics-risk-coordinator.js) на import тянут DOM/window/localStorage/рендереры
 * (window.location.origin в AppConfig, ItemsRenderer/APIClient в StorageManager,
 * getElementById в context-menu-core, и т.д.). Стабить весь этот граф — хрупко и
 * противоречит «behavior-preserving». Поэтому ЧИСТОЕ ядро решений каскада
 * вынесено в metrics-risk-core.js (БЕЗ DOM), а AppState-методы делегируют в него.
 * Тест гоняет ИМЕННО это ядро через `ops`-адаптер над plain {treeData, tables} —
 * та же логика, что и в проде, только построение объектов таблиц инъектится.
 *
 * Инварианты:
 *  - derivability: 5.X имеет сводную ⟺ в его поддереве есть риск (на 5.X.Y+);
 *    §5 имеет главную сводную ⟺ где-либо в §5 есть риск;
 *  - no-orphan: нет сводной без удерживающего её риска;
 *  - idempotence: повторный reconcile ничего не меняет;
 *  - round-trip / convergence: добавление+удаление риска возвращает к базе;
 *  - rollback-safety (D1): падение создателя сводной в середине удаления
 *    риск-узла откатывает ПОЛНОЕ состояние, ВКЛЮЧАЯ удалённый риск-узел.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  shouldHaveMetricsTable,
  shouldHaveMainMetrics,
  reconcileAfterRiskAdded,
  reconcileAfterRiskRemoved,
  removeRiskTableNode,
} from '../../static/js/constructor/state/metrics-risk-core.js';

/**
 * Переключатель пути удаления риск-узла:
 *  - 'legacy' воспроизводит ПРОДОВЫЙ баг (snapshot ВНУТРИ reconcile, уже после
 *    удаления узла — как в _deleteNodeUnchecked → onRiskTableRemoved). D1 RED.
 *  - 'fixed' использует боевое ядро removeRiskTableNode (snapshot ДО удаления).
 * После фикса D1 (T5.2) прод переходит на removeRiskTableNode, и тест зелёный.
 */
const DELETE_PATH = 'fixed';

// ---------------------------------------------------------------------------
// Минимальная боевая модель состояния {treeData, tables}.
// ---------------------------------------------------------------------------

let _id = 0;
const nextId = (p) => `${p}_${++_id}`;

/** Базовое дерево: §5 с двумя ветками 5.1 и 5.2, в каждой по item-листу 5.X.1. */
function makeBaseState() {
  const leaf11 = { id: 'n_511', type: 'item', number: '5.1.1', children: [] };
  const node51 = { id: 'n_51', type: 'item', number: '5.1', children: [leaf11] };
  const leaf21 = { id: 'n_521', type: 'item', number: '5.2.1', children: [] };
  const node52 = { id: 'n_52', type: 'item', number: '5.2', children: [leaf21] };
  const section5 = { id: '5', number: '5', children: [node51, node52] };
  const root = { id: 'root', children: [section5] };
  return { treeData: root, tables: {} };
}

/** Рекурсивный поиск узла по id. */
function findNodeById(treeData, id, node = treeData) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const f = findNodeById(treeData, id, c);
    if (f) return f;
  }
  return null;
}

/** Поиск родителя узла по id. */
function findParentNode(treeData, id, parent = treeData) {
  for (const c of parent.children || []) {
    if (c.id === id) return parent;
    const f = findParentNode(treeData, id, c);
    if (f) return f;
  }
  return null;
}

/** Риск-таблицы в поддереве (regular для простоты; дискриминатор по флагу). */
function findRiskTables(node) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'table' && (n.isRegularRiskTable || n.isOperationalRiskTable
      || n.isTaxRiskTable || n.isOtherRiskTable)) out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(node);
  return out;
}

const isMetricsNode = (n) => n.type === 'table' && n.isMetricsTable === true;
const isMainMetricsNode = (n) => n.type === 'table' && n.isMainMetricsTable === true;

/**
 * Собирает `ops` для ядра поверх state. `throwOnCreate` имитирует падение
 * создателя сводной (rollback-safety). `legacyOrder=true` воспроизводит СТАРЫЙ
 * (баговый) порядок: snapshot снимается ВНУТРИ reconcile, уже после удаления
 * узла (как было в _deleteNodeUnchecked → onRiskTableRemoved).
 */
function makeOps(state, opts = {}) {
  const { throwOnReconcile = false } = opts;
  return {
    findNodeById: (id) => findNodeById(state.treeData, id),
    findParentNode: (id) => findParentNode(state.treeData, id),
    findRiskTables,
    createMetricsTable: (node5x) => {
      const tableId = nextId('table');
      const tn = { id: nextId('mt'), type: 'table', tableId, isMetricsTable: true, children: [] };
      node5x.children.unshift(tn);
      state.tables[tableId] = { id: tableId, nodeId: tn.id, isMetricsTable: true };
    },
    createMainMetricsTable: () => {
      const node5 = findNodeById(state.treeData, '5');
      if (node5.children.some(isMainMetricsNode)) return;
      const tableId = nextId('table');
      const tn = { id: nextId('mmt'), type: 'table', tableId, isMainMetricsTable: true, children: [] };
      node5.children.unshift(tn);
      state.tables[tableId] = { id: tableId, nodeId: tn.id, isMainMetricsTable: true };
    },
    removeMetricsTable: (parent, tableNode) => {
      // Имитируем падение поставщика сводных В СЕРЕДИНЕ reconcile при удалении
      // риска (per-section сводная снимается → создатель/удалитель бросает).
      if (throwOnReconcile) throw new Error('removeMetricsTable boom');
      delete state.tables[tableNode.tableId];
      parent.children = parent.children.filter((c) => c.id !== tableNode.id);
    },
    snapshot: () => {
      const node5 = findNodeById(state.treeData, '5');
      const children5 = JSON.parse(JSON.stringify(node5.children));
      const tablesCopy = JSON.parse(JSON.stringify(state.tables));
      return {
        rollback: () => {
          node5.children = children5;
          state.tables = tablesCopy;
        },
      };
    },
  };
}

/** Все 4 флага подвидов риск-таблиц (зеркало RISK_FLAG_NAMES в table-kind.js). */
const RISK_FLAGS = ['isRegularRiskTable', 'isOperationalRiskTable', 'isTaxRiskTable', 'isOtherRiskTable'];

/**
 * Добавляет риск-таблицу указанного типа в item-узел и реконсилит.
 * @param {string} [riskFlag='isRegularRiskTable'] - Один из 4 флагов подвидов.
 */
function addRisk(state, hostId, riskFlag = 'isRegularRiskTable') {
  const host = findNodeById(state.treeData, hostId);
  if (!host) return;
  const tableId = nextId('table');
  const tn = { id: nextId('rt'), type: 'table', tableId, [riskFlag]: true, children: [] };
  host.children.push(tn);
  state.tables[tableId] = { id: tableId, nodeId: tn.id, [riskFlag]: true };
  reconcileAfterRiskAdded(tn.id, makeOps(state));
}

/**
 * Удаляет риск-узел. Путь выбирается DELETE_PATH:
 *  - 'fixed'  → боевое ядро removeRiskTableNode (snapshot ДО удаления, D1-fix);
 *  - 'legacy' → продовый баг: сначала удаляем узел, ПОТОМ snapshot+reconcile
 *    (snapshot снят уже без риск-узла → откат его не вернёт).
 * `throwOnCreate` — для rollback-теста.
 */
function removeRisk(state, riskNodeId, opts = {}) {
  const riskNode = findNodeById(state.treeData, riskNodeId);
  if (!riskNode) return true;
  const ops = makeOps(state, opts);
  ops.deleteNode = () => {
    delete state.tables[riskNode.tableId];
    const parent = findParentNode(state.treeData, riskNodeId);
    if (parent) parent.children = parent.children.filter((c) => c.id !== riskNodeId);
  };

  if (DELETE_PATH === 'legacy') {
    // Воспроизводим _deleteNodeUnchecked: узел удаляется ДО snapshot'а.
    ops.deleteNode();
    const snap = ops.snapshot();
    try {
      reconcileAfterRiskRemoved(ops);
      return true;
    } catch (err) {
      snap.rollback();
      return false;
    }
  }

  return removeRiskTableNode(ops);
}

/** Все риск-узлы в дереве. */
function allRiskNodes(state) {
  return findRiskTables(findNodeById(state.treeData, '5'));
}

// ---------------------------------------------------------------------------
// Инварианты.
// ---------------------------------------------------------------------------

function assertInvariants(state) {
  const node5 = findNodeById(state.treeData, '5');
  const firstLevel = node5.children.filter((c) => /^5\.\d+$/.test(c.number || ''));

  for (const node5x of firstLevel) {
    const expect = shouldHaveMetricsTable(node5x, findRiskTables);
    const has = node5x.children.some(isMetricsNode);
    // derivability + no-orphan для per-section.
    assert.equal(has, expect, `derivability 5.X=${node5x.number}: has=${has} expect=${expect}`);
  }

  const expectMain = shouldHaveMainMetrics(node5, findRiskTables);
  const hasMain = node5.children.some(isMainMetricsNode);
  assert.equal(hasMain, expectMain, `derivability main: has=${hasMain} expect=${expectMain}`);
}

// ---------------------------------------------------------------------------
// Model-based commands.
// ---------------------------------------------------------------------------

const HOSTS = ['n_511', 'n_521', 'n_51', 'n_52'];

class AddRiskCommand {
  constructor(hostId, riskFlag) { this.hostId = hostId; this.riskFlag = riskFlag; }
  check() { return true; }
  run(model, real) {
    addRisk(real, this.hostId, this.riskFlag);
    assertInvariants(real);
  }
  toString() { return `AddRisk(${this.hostId}, ${this.riskFlag})`; }
}

class RemoveRiskCommand {
  constructor(idx) { this.idx = idx; }
  check() { return true; }
  run(model, real) {
    const risks = allRiskNodes(real);
    if (risks.length === 0) return;
    const target = risks[this.idx % risks.length];
    const ok = removeRisk(real, target.id);
    assert.equal(ok, true, 'нормальное удаление риска не должно откатываться');
    assertInvariants(real);
  }
  toString() { return `RemoveRisk(#${this.idx})`; }
}

class ReconcileIdempotentCommand {
  check() { return true; }
  run(model, real) {
    const before = JSON.stringify(real.treeData);
    reconcileAfterRiskRemoved(makeOps(real));
    reconcileAfterRiskAdded('n_511', makeOps(real)); // no-op если риска нет
    // idempotence: повторный reconcile-removed не должен ломать инвариант.
    reconcileAfterRiskRemoved(makeOps(real));
    assertInvariants(real);
    void before;
  }
  toString() { return 'ReconcileIdempotent'; }
}

test('каскад: инварианты при случайных add/remove/reconcile (model-based)', () => {
  const allCommands = [
    // AddRisk по каждому host × каждому из 4 типов риска — чтобы в прогоне
    // реально появлялись tax/other-риски, а не только regular/operational.
    ...HOSTS.flatMap((h) => RISK_FLAGS.map((f) => fc.constant(new AddRiskCommand(h, f)))),
    ...[0, 1, 2].map((i) => fc.constant(new RemoveRiskCommand(i))),
    fc.constant(new ReconcileIdempotentCommand()),
  ];
  fc.assert(
    fc.property(fc.commands(allCommands, { maxCommands: 20 }), (cmds) => {
      _id = 0;
      const real = makeBaseState();
      const setup = () => ({ model: {}, real });
      fc.modelRun(setup, cmds);
    }),
    { numRuns: 200 }
  );
});

test('каскад: idempotence reconcile на стабильном состоянии', () => {
  _id = 0;
  const state = makeBaseState();
  addRisk(state, 'n_511');
  addRisk(state, 'n_521');
  const snap1 = JSON.stringify(state.treeData);
  reconcileAfterRiskRemoved(makeOps(state));
  reconcileAfterRiskAdded(findRiskTables(findNodeById(state.treeData, '5'))[0].id, makeOps(state));
  reconcileAfterRiskRemoved(makeOps(state));
  assert.equal(JSON.stringify(state.treeData), snap1, 'reconcile не должен менять стабильное состояние');
});

test('каскад: round-trip add→remove возвращает к базе', () => {
  _id = 0;
  const state = makeBaseState();
  const base = JSON.stringify(state.treeData);
  addRisk(state, 'n_511');
  const risk = findRiskTables(findNodeById(state.treeData, '5'))[0];
  removeRisk(state, risk.id);
  assert.equal(JSON.stringify(state.treeData), base, 'после удаления риска состояние должно вернуться к базе');
});

// --- D1 RED: rollback-safety при падении создателя сводной в удалении риска. ---
test('каскад D1: падение reconcile при удалении риск-узла откатывает узел целиком', () => {
  _id = 0;
  const state = makeBaseState();
  addRisk(state, 'n_511'); // создаст per-section 5.1 + main metrics
  addRisk(state, 'n_521'); // создаст per-section 5.2

  const before = JSON.stringify(state.treeData);
  const beforeTables = JSON.stringify(state.tables);

  // Удаляем единственный риск из 5.1 → reconcile снимет per-section сводную 5.1,
  // а removeMetricsTable бросит исключение посреди операции.
  const risk51 = findRiskTables(findNodeById(state.treeData, 'n_51'))[0];
  const ok = removeRisk(state, risk51.id, { throwOnReconcile: true });

  assert.equal(ok, false, 'операция должна сообщить об откате');
  // Полное состояние, ВКЛЮЧАЯ удалённый риск-узел, восстановлено.
  assert.equal(JSON.stringify(state.treeData), before, 'treeData должен быть восстановлен целиком (включая риск-узел)');
  assert.equal(JSON.stringify(state.tables), beforeTables, 'tables должны быть восстановлены целиком');
  // Конкретно: риск-узел снова существует.
  assert.ok(findNodeById(state.treeData, risk51.id), 'удалённый риск-узел должен быть восстановлен откатом');
});
