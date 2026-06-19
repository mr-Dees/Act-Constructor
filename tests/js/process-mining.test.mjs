import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import '../../static/js/constructor/state/state-tree.js';
import '../../static/js/constructor/state/state-content.js';
import { AppConfig } from '../../static/js/shared/app-config.js';

beforeEach(() => {
    AppState.treeData = null;
    AppState.tables = {};
    AppState.textBlocks = {};
    AppState.violations = {};
    AppState._rebuildNodeIndex();
    AppConfig.readOnlyMode.isReadOnly = false;
});

function pm() {
    return AppState.treeData.children.find(c => c.special === 'process_mining');
}

test('addProcessMiningSection добавляет защищённый удаляемый пункт с фиксированным названием', () => {
    AppState.initializeTree(true);
    const res = AppState.addProcessMiningSection();
    assert.ok(res.valid, res.message);
    const node = pm();
    assert.ok(node, 'пункт Process Mining не найден');
    assert.equal(node.label, AppConfig.tree.processMiningSection.label);
    assert.equal(node.protected, true);
    assert.equal(node.deletable, true);
    assert.equal(node.titleLocked, true);
    assert.equal(node.number, '6'); // встаёт последним после раздела 5
});

test('addProcessMiningSection нельзя добавить дважды', () => {
    AppState.initializeTree(true);
    assert.ok(AppState.addProcessMiningSection().valid);
    const res2 = AppState.addProcessMiningSection();
    assert.equal(res2.valid, false);
});

test('Process Mining можно удалить, несмотря на protected', () => {
    AppState.initializeTree(true);
    AppState.addProcessMiningSection();
    assert.equal(AppState.deleteNode('6'), true);
    assert.equal(pm(), undefined);
});

test('_isUnderProcessMining истинно для пункта PM и его потомков', () => {
    AppState.initializeTree(true);
    AppState.addProcessMiningSection();
    assert.equal(AppState._isUnderProcessMining('6'), true);
    assert.ok(AppState.addNode('6', 'Подпункт', true).valid);
    const child = AppState.findNodeById('6').children.at(-1);
    assert.equal(AppState._isUnderProcessMining(child.id), true);
    assert.equal(AppState._isUnderProcessMining('5'), false);
});

test('по умолчанию дерево содержит 5 защищённых разделов без Process Mining', () => {
    AppState.initializeTree(true);
    const ids = AppState.treeData.children.map(c => c.id);
    assert.deepEqual(ids, ['1', '2', '3', '4', '5']);
    for (const c of AppState.treeData.children) {
        assert.equal(c.protected, true, `раздел ${c.id} должен быть protected`);
        assert.notEqual(c.deletable, true, `раздел ${c.id} не должен быть deletable`);
    }
});

test('пункт 0 уровня определяется как ребёнок root', () => {
    AppState.initializeTree(true);
    assert.equal(AppState.findParentNode('5').id, 'root');
    AppState.addProcessMiningSection();
    assert.equal(AppState.findParentNode('6').id, 'root');
});

test('перенос пункта на 0 уровень запрещён', async () => {
    AppState.initializeTree(true);
    // 5.1 — обычный подпункт
    assert.ok(AppState.addNode('5', 'Подпункт', true).valid);
    const child = AppState.findNodeById('5').children.at(-1);
    // Пытаемся вынести его на 0 уровень (after раздела 5)
    const res = await AppState.moveNode(child.id, '5', 'after');
    assert.equal(res.valid, false);
    assert.match(res.message, /верхний уровень/i);
    // Узел остался под разделом 5
    assert.equal(AppState.findParentNode(child.id).id, '5');
});

test('нельзя добавить нарушение под пунктом Process Mining', () => {
    AppState.initializeTree(true);
    AppState.addProcessMiningSection();
    const res = AppState.addViolationToNode('6');
    assert.equal(res.valid, false);
});

test('нельзя перенести нарушение под пункт Process Mining', async () => {
    AppState.initializeTree(true);
    AppState.addProcessMiningSection();
    // нарушение под разделом 4
    assert.ok(AppState.addNode('4', 'Контейнер', true).valid);
    const cont = AppState.findNodeById('4').children.at(-1);
    assert.ok(AppState.addViolationToNode(cont.id).valid);
    const vio = AppState.findNodeById(cont.id).children.at(-1);
    const res = await AppState.moveNode(vio.id, '6', 'child');
    assert.equal(res.valid, false);
});

test('addProcessMiningSection не создаёт дубликат id при наличии legacy-раздела 6', () => {
    AppState.initializeTree(true);
    AppState.treeData.children.push({ id: '6', label: 'Старый раздел', children: [], content: '' });
    AppState._rebuildNodeIndex();
    const res = AppState.addProcessMiningSection();
    assert.equal(res.valid, false);
    assert.equal(AppState.treeData.children.filter(c => c.id === '6').length, 1);
});
