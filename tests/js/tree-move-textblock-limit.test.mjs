/**
 * PERSIST-2 (продолжение): лимит текстблоков-на-узел при drag-and-drop
 * перемещении (AppState.moveNode/_performMove).
 *
 * _performMove вставляет узел в newParent.children через push/splice —
 * отдельно от insertNodeAt (paste/undo), поэтому без явной проверки drag мог
 * дать новому родителю N+1 текстблоков так же, как paste/undo (см.
 * validation-tree-guards.test.mjs, undo-delete.test.mjs, node-clipboard.test.mjs).
 *
 * Критичный краевой случай: reorder ВНУТРИ одного родителя не должен ложно
 * отказывать — перемещаемый узел в момент проверки ещё физически состоит в
 * children целевого (= исходного) родителя, и canInsertSubtree
 * исключает его по id из подсчёта (см. validation-tree.js).
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
import { AppConfig } from '../../static/js/shared/app-config.js';
import { Notifications } from '../../static/js/shared/notifications.js';
import {
    getStructureLimits,
    resetImageLimitsForTests,
} from '../../static/js/constructor/violation/violation-image-validator.js';

const notified = { error: [], success: [] };
const originalNotifications = {
    error: Notifications.error,
    success: Notifications.success,
};

beforeEach(() => {
    for (const key of Object.keys(notified)) {
        notified[key].length = 0;
        Notifications[key] = (msg) => { notified[key].push(msg); };
    }
    AppState.treeData = null;
    AppState.tables = {};
    AppState.textBlocks = {};
    AppState.violations = {};
    AppState._rebuildNodeIndex();
    AppConfig.readOnlyMode.isReadOnly = false;
});

afterEach(() => {
    Object.assign(Notifications, originalNotifications);
    AppConfig.readOnlyMode.isReadOnly = false;
    resetImageLimitsForTests();
});

/** Добавляет item-узел и возвращает его (tracked). */
function addItem(parentId, label = 'Пункт') {
    const res = AppState.addNode(parentId, label, true);
    assert.ok(res.valid, `addNode(${parentId}): ${res.message}`);
    return AppState.findNodeById(parentId).children.at(-1);
}

test('move: текстблок в узел на лимите — отказ, тост, дерево не изменилось', async () => {
    AppState.initializeTree(true);
    getStructureLimits().textBlocksPerNode = 1;

    const src = addItem('4', 'Источник');
    assert.ok(AppState.addTextBlockToNode(src.id).valid);
    const draggedTb = src.children.find(c => c.type === 'textblock');

    const dst = addItem('4', 'Назначение на лимите');
    assert.ok(AppState.addTextBlockToNode(dst.id).valid); // уже на лимите (1/1)
    AppState.generateNumbering();

    const srcChildrenBefore = src.children.length;
    const dstChildrenBefore = dst.children.length;

    const result = await AppState.moveNode(draggedTb.id, dst.id, 'child');

    assert.equal(result.valid, false, 'move отклонён — цель на лимите текстблоков');
    assert.ok(result.message, 'нужно сообщение для тоста');
    assert.equal(src.children.length, srcChildrenBefore, 'источник не изменился');
    assert.equal(dst.children.length, dstChildrenBefore, 'назначение не изменилось');
    assert.ok(AppState.findNodeById(draggedTb.id), 'узел остался на прежнем месте (не вырезан)');
    assert.ok(src.children.some(c => c.id === draggedTb.id), 'узел всё ещё в исходном родителе');
});

test('move: reorder текстблока ВНУТРИ родителя на лимите — разрешён', async () => {
    AppState.initializeTree(true);
    getStructureLimits().textBlocksPerNode = 2;

    const item = addItem('4', 'Пункт');
    assert.ok(AppState.addTextBlockToNode(item.id).valid);
    assert.ok(AppState.addTextBlockToNode(item.id).valid);
    AppState.generateNumbering();

    const [tb1, tb2] = item.children.filter(c => c.type === 'textblock');

    // item уже на лимите (2/2) — реордер ВНУТРИ него не должен считать
    // перемещаемый узел дважды (краевой случай, отмеченный тимлидом).
    const result = await AppState.moveNode(tb2.id, tb1.id, 'before');

    assert.equal(result.valid, true, 'reorder внутри родителя на лимите должен быть разрешён');
    const order = item.children.filter(c => c.type === 'textblock').map(c => c.id);
    assert.deepEqual(order, [tb2.id, tb1.id], 'порядок должен смениться на tb2, tb1');
});

test('move: перенос текстблока из A в B под лимитом — работает как раньше', async () => {
    AppState.initializeTree(true);
    getStructureLimits().textBlocksPerNode = 2;

    const a = addItem('4', 'A');
    const b = addItem('4', 'B');
    assert.ok(AppState.addTextBlockToNode(a.id).valid);
    AppState.generateNumbering();
    const tb = a.children.find(c => c.type === 'textblock');

    const result = await AppState.moveNode(tb.id, b.id, 'child');

    assert.equal(result.valid, true, 'перенос под лимитом должен пройти как раньше');
    assert.equal(AppState.findNodeById(a.id).children.length, 0, 'источник опустел');
    assert.ok(AppState.findNodeById(b.id).children.some(c => c.id === tb.id), 'текстблок теперь в B');
});

// ── #7: тот же гейт для нарушений (обобщённый canInsertSubtree) ─────────────

test('move: нарушение в узел на лимите нарушений — отказ, дерево не изменилось', async () => {
    AppState.initializeTree(true);
    getStructureLimits().violationsPerNode = 1;

    const src = addItem('4', 'Источник');
    assert.ok(AppState.addViolationToNode(src.id).valid);
    const draggedVio = src.children.find(c => c.type === 'violation');

    const dst = addItem('4', 'Назначение на лимите');
    assert.ok(AppState.addViolationToNode(dst.id).valid); // уже на лимите (1/1)
    AppState.generateNumbering();

    const srcChildrenBefore = src.children.length;
    const dstChildrenBefore = dst.children.length;

    const result = await AppState.moveNode(draggedVio.id, dst.id, 'child');

    assert.equal(result.valid, false, 'move отклонён — цель на лимите нарушений');
    assert.ok(result.message, 'нужно сообщение для тоста');
    assert.match(result.message, /нарушений/);
    assert.equal(src.children.length, srcChildrenBefore, 'источник не изменился');
    assert.equal(dst.children.length, dstChildrenBefore, 'назначение не изменилось');
    assert.ok(src.children.some(c => c.id === draggedVio.id), 'узел всё ещё в исходном родителе');
});

test('move: reorder нарушения ВНУТРИ родителя на лимите — разрешён (self-exclusion)', async () => {
    AppState.initializeTree(true);
    getStructureLimits().violationsPerNode = 2;

    const item = addItem('4', 'Пункт');
    assert.ok(AppState.addViolationToNode(item.id).valid);
    assert.ok(AppState.addViolationToNode(item.id).valid);
    AppState.generateNumbering();

    const [v1, v2] = item.children.filter(c => c.type === 'violation');

    // item на лимите (2/2) — реордер ВНУТРИ него не должен считать
    // перемещаемый узел дважды.
    const result = await AppState.moveNode(v2.id, v1.id, 'before');

    assert.equal(result.valid, true, 'reorder внутри родителя на лимите должен быть разрешён');
    const order = item.children.filter(c => c.type === 'violation').map(c => c.id);
    assert.deepEqual(order, [v2.id, v1.id], 'порядок должен смениться на v2, v1');
});
