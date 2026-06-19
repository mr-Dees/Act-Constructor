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
