/**
 * Проверка глубины в canAddContent (val-8).
 *
 * canAddContent раньше НЕ проверял maxDepth: контент можно было добавить к
 * запредельно глубокому (повреждённому) узлу. Добавлена проверка по аналогии
 * с canAddChild — узел глубже maxDepth контент не принимает. Контент-узлы не
 * создают нового уровня иерархии, поэтому порог — глубина САМОГО узла > maxDepth
 * (без +1, в отличие от canAddChild для item-детей).
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import '../../static/js/constructor/state/state-tree.js';
import '../../static/js/constructor/state/state-content.js';
import { ValidationTree } from '../../static/js/constructor/validation/validation-tree.js';
import { AppConfig } from '../../static/js/shared/app-config.js';

const { TABLE } = AppConfig.nodeTypes;
const maxDepth = AppConfig.tree.maxDepth; // 4

/** Строит цепочку item-узлов глубины depth (root → ... → лист). */
function buildChain(depth) {
    let leaf;
    let node = null;
    for (let i = depth; i >= 1; i--) {
        const current = { id: `lvl${i}`, type: 'item', label: `Уровень ${i}`, children: node ? [node] : [] };
        if (i === depth) leaf = current;
        node = current;
    }
    return { root: { id: 'root', label: 'Акт', children: [node] }, leaf };
}

beforeEach(() => {
    AppState.treeData = { id: 'root', label: 'Акт', children: [] };
    AppState._rebuildNodeIndex();
});

test('canAddContent: узел в пределах maxDepth принимает контент', () => {
    // Глубина листа = maxDepth (lvl1=1 ... lvl4=4 при maxDepth=4) — допустимо.
    const { root, leaf } = buildChain(maxDepth);
    AppState.treeData = root;
    AppState._rebuildNodeIndex();

    const result = ValidationTree.canAddContent(leaf, TABLE);
    assert.equal(result.valid, true, 'узел на максимально допустимой глубине должен принимать контент');
});

test('canAddContent: узел глубже maxDepth отклоняет контент', () => {
    // Глубина листа = maxDepth + 1 — за пределом.
    const { root, leaf } = buildChain(maxDepth + 1);
    AppState.treeData = root;
    AppState._rebuildNodeIndex();

    const result = ValidationTree.canAddContent(leaf, TABLE);
    assert.equal(result.valid, false, 'узел за пределом глубины не должен принимать контент');
    assert.ok(result.message);
});

test('canAddContent: несуществующий узел отклоняется (как раньше)', () => {
    const result = ValidationTree.canAddContent(null, TABLE);
    assert.equal(result.valid, false);
});

test('canAddContent: узел не в дереве (depth -1) отклоняется', () => {
    AppState.treeData = { id: 'root', label: 'Акт', children: [{ id: 'n1', type: 'item', children: [] }] };
    AppState._rebuildNodeIndex();

    // Узел существует как объект, но не привязан к дереву → getNodeDepth = -1.
    const orphan = { id: 'orphan', type: 'item', label: 'Сирота', children: [] };
    const result = ValidationTree.canAddContent(orphan, TABLE);
    assert.equal(result.valid, false, 'узел вне дерева не должен принимать контент');
});
