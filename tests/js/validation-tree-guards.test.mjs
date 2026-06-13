/**
 * Guard'ы валидации дерева (val-3 / tree-3).
 *
 * Инварианты:
 *  - canAddChild по неизвестному родителю — отказ (раньше getNodeDepth давал -1,
 *    что проходило проверку maxDepth и давало ложный success);
 *  - детект «дополнительного пункта 7» парсит номер строго: '7.1' — НЕ пункт 7
 *    (parseInt('7.1') === 7 ложно срабатывал на номерах с точкой).
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
// tree-3: номер с точкой не считается пунктом 7
// ──────────────────────────────────────────────────────────────────────────

test('canAddSibling: номер "7.1" у соседа НЕ детектится как пункт 7', () => {
    // Повреждённое/нестандартное состояние: на первом уровне узел с номером '7.1'.
    // parseInt('7.1') === 7 ложно блокировал добавление «лимит пункта 7 исчерпан».
    AppState.treeData.children.push(
        { id: 'x71', label: 'Аномальный', number: '7.1', type: 'item', children: [] }
    );
    AppState._rebuildNodeIndex();

    const result = ValidationTree.canAddSibling('x71');
    assert.equal(result.valid, true, 'номер с точкой не должен считаться пунктом 7');
});

test('canAddSibling: настоящий пункт 7 на первом уровне блокирует добавление', () => {
    AppState.treeData.children.push(
        { id: 'x7', label: 'Пункт 7', number: '7', type: 'item', children: [] }
    );
    AppState._rebuildNodeIndex();

    const result = ValidationTree.canAddSibling('x7');
    assert.equal(result.valid, false, 'второй кастомный пункт первого уровня запрещён');
});

test('_checkFirstLevelConstraints: сосед с номером "7.1" не блокирует перемещение после пункта 6', () => {
    // Повреждённый номер '7.1' на первом уровне: parseInt('7.1') === 7 ложно
    // включал «на первом уровне уже есть пункт 7» и блокировал перемещение.
    AppState.treeData.children.push(
        { id: 'x71', label: 'Аномальный', number: '7.1', type: 'item', children: [] }
    );
    const dragged = { id: 'd1', label: 'Перемещаемый', type: 'item', children: [] };
    AppState.treeData.children[0].children.push(dragged);
    AppState._rebuildNodeIndex();

    const draggedParent = AppState.findNodeById('1');
    const targetNode = AppState.findNodeById('6');

    const result = AppState._checkFirstLevelConstraints(
        dragged, draggedParent, targetNode, '6', 'after'
    );
    assert.equal(result.valid, true, "'7.1' не пункт 7 — перемещение после пункта 6 разрешено");
});
