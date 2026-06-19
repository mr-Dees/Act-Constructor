/**
 * Guard'ы валидации дерева (val-3 / tree-3).
 *
 * Инварианты:
 *  - canAddChild по неизвестному родителю — отказ (раньше getNodeDepth давал -1,
 *    что проходило проверку maxDepth и давало ложный success);
 *  - _checkFirstLevelConstraints запрещает before/after на 0 уровне;
 *  - canAddSibling запрещает обычного соседа на 0 уровне (только Process Mining).
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import '../../static/js/constructor/state/state-tree.js';
import '../../static/js/constructor/state/state-content.js';
import { ValidationTree } from '../../static/js/constructor/validation/validation-tree.js';

beforeEach(() => {
    AppState.treeData = {
        id: 'root',
        label: 'Акт',
        children: [
            { id: '1', label: 'Раздел 1', number: '1', protected: true, children: [] },
            { id: '6', label: 'Раздел 6', number: '6', deletable: true, children: [] },
        ],
    };
    AppState._rebuildNodeIndex();
});

// ──────────────────────────────────────────────────────────────────────────
// val-3: неизвестный родитель → отказ
// ──────────────────────────────────────────────────────────────────────────

test('canAddChild: неизвестный родитель → отказ (не ложный success)', () => {
    const result = ValidationTree.canAddChild('ghost-id');
    assert.equal(result.valid, false, 'ненайденный родитель не должен проходить валидацию');
    assert.ok(result.message, 'нужно сообщение об ошибке');
});

test('canAddChild: существующий родитель в пределах maxDepth → success', () => {
    const result = ValidationTree.canAddChild('1');
    assert.equal(result.valid, true);
});

// ──────────────────────────────────────────────────────────────────────────
// tree-3: новый контракт — перенос на 0 уровень запрещён; обычный сосед 0 уровня тоже
// ──────────────────────────────────────────────────────────────────────────

test('_checkFirstLevelConstraints запрещает before/after на 0 уровне', () => {
    AppState.initializeTree(true);
    const dragged = AppState.findNodeById('5'); // любой узел; функция чистая по позиции
    const draggedParent = AppState.treeData;
    const res = AppState._checkFirstLevelConstraints(dragged, draggedParent, AppState.findNodeById('4'), '4', 'after');
    assert.equal(res.valid, false);
});

test('canAddSibling запрещает обычного соседа на 0 уровне, разрешает глубже', () => {
    AppState.initializeTree(true);
    // 0 уровень (родитель root): обычный сосед запрещён — только Process Mining через меню.
    assert.equal(ValidationTree.canAddSibling('5').valid, false);
    // Глубже 0 уровня — сосед разрешён.
    assert.ok(AppState.addNode('5', 'Подпункт', true).valid);
    const child = AppState.findNodeById('5').children.at(-1);
    assert.equal(ValidationTree.canAddSibling(child.id).valid, true);
});
