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
import {
    getStructureLimits,
    resetImageLimitsForTests,
} from '../../static/js/constructor/violation/violation-image-validator.js';

beforeEach(() => {
    resetImageLimitsForTests();
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

// ──────────────────────────────────────────────────────────────────────────
// PERSIST-2/#7: canInsertSubtree — лимиты блоков (текстблоки/нарушения/таблицы)
// при вставке ГОТОВОГО поддерева (undo/paste/drag, insertNodeAt не зовёт
// canAddContent). Обобщено с прежней canInsertTextBlockSubtree.
// ──────────────────────────────────────────────────────────────────────────

test('canInsertSubtree: родитель на лимите + корень-textblock → отказ', () => {
    getStructureLimits().textBlocksPerNode = 1;
    AppState.treeData = {
        id: 'root', label: 'Акт', children: [
            { id: 'p', label: 'Пункт', children: [
                { id: 'tb1', type: 'textblock', textBlockId: 'tb1', children: [] },
            ] },
        ],
    };
    AppState._rebuildNodeIndex();

    const newTextBlock = { id: 'tb2', type: 'textblock', textBlockId: 'tb2', children: [] };
    const result = ValidationTree.canInsertSubtree('p', newTextBlock);
    assert.equal(result.valid, false);
    assert.match(result.message, /текстовых блоков/);
});

test('canInsertSubtree: родитель НЕ на лимите → success', () => {
    getStructureLimits().textBlocksPerNode = 2;
    AppState.treeData = {
        id: 'root', label: 'Акт', children: [
            { id: 'p', label: 'Пункт', children: [
                { id: 'tb1', type: 'textblock', textBlockId: 'tb1', children: [] },
            ] },
        ],
    };
    AppState._rebuildNodeIndex();

    const newTextBlock = { id: 'tb2', type: 'textblock', textBlockId: 'tb2', children: [] };
    assert.equal(ValidationTree.canInsertSubtree('p', newTextBlock).valid, true);
});

test('canInsertSubtree: корень поддерева — не textblock, прямая проверка родителя не применяется', () => {
    getStructureLimits().textBlocksPerNode = 1;
    AppState.treeData = {
        id: 'root', label: 'Акт', children: [
            { id: 'p', label: 'Пункт', children: [
                { id: 'tb1', type: 'textblock', textBlockId: 'tb1', children: [] },
            ] },
        ],
    };
    AppState._rebuildNodeIndex();

    // Вставляем item (не сам textblock) — родитель получает не-textblock ребёнка.
    const itemNode = { id: 'sub', type: 'item', children: [] };
    assert.equal(ValidationTree.canInsertSubtree('p', itemNode).valid, true);
});

test('canInsertSubtree: узел поддерева нарушает ТЕКУЩИЙ лимит (самосогласованность) → отказ', () => {
    getStructureLimits().textBlocksPerNode = 2;
    AppState.treeData = { id: 'root', label: 'Акт', children: [{ id: 'p', label: 'Пункт', children: [] }] };
    AppState._rebuildNodeIndex();

    // Поддерево несёт узел с 3 текстблоками — валидно было при лимите ≥3, но
    // лимит уже снижен (например, конфиг поменялся после копирования/удаления).
    const subtree = {
        id: 'sub', type: 'item', children: [
            { id: 'tb1', type: 'textblock', textBlockId: 'tb1', children: [] },
            { id: 'tb2', type: 'textblock', textBlockId: 'tb2', children: [] },
            { id: 'tb3', type: 'textblock', textBlockId: 'tb3', children: [] },
        ],
    };
    const result = ValidationTree.canInsertSubtree('p', subtree);
    assert.equal(result.valid, false, 'самосогласованность поддерева нарушена под текущим лимитом');
});

test('canInsertSubtree: поддерево самосогласовано → success', () => {
    getStructureLimits().textBlocksPerNode = 3;
    AppState.treeData = { id: 'root', label: 'Акт', children: [{ id: 'p', label: 'Пункт', children: [] }] };
    AppState._rebuildNodeIndex();

    const subtree = {
        id: 'sub', type: 'item', children: [
            { id: 'tb1', type: 'textblock', textBlockId: 'tb1', children: [] },
            { id: 'tb2', type: 'textblock', textBlockId: 'tb2', children: [] },
            { id: 'tb3', type: 'textblock', textBlockId: 'tb3', children: [] },
        ],
    };
    assert.equal(ValidationTree.canInsertSubtree('p', subtree).valid, true);
});

test('canInsertSubtree: лимит текстблоков не задан (не число) → фолбэк block-types, малое поддерево проходит', () => {
    getStructureLimits().textBlocksPerNode = undefined;
    AppState.treeData = { id: 'root', label: 'Акт', children: [{ id: 'p', label: 'Пункт', children: [] }] };
    AppState._rebuildNodeIndex();

    const newTextBlock = { id: 'tb1', type: 'textblock', textBlockId: 'tb1', children: [] };
    assert.equal(ValidationTree.canInsertSubtree('p', newTextBlock).valid, true);
});

test('canInsertSubtree: move/reorder — node уже физически среди children родителя, не считается дважды', () => {
    getStructureLimits().textBlocksPerNode = 2;
    AppState.treeData = {
        id: 'root', label: 'Акт', children: [
            { id: 'p', label: 'Пункт', children: [
                { id: 'tb1', type: 'textblock', textBlockId: 'tb1', children: [] },
                { id: 'tb2', type: 'textblock', textBlockId: 'tb2', children: [] },
            ] },
        ],
    };
    AppState._rebuildNodeIndex();

    // p уже "на лимите" (2/2), но tb1 — один из ЭТИХ ЖЕ двух детей (drag ещё
    // не вырезал его из children) — проверка родителя того же узла не должна
    // отказывать (иначе обычный reorder внутри родителя ложно бы блокировался).
    const tb1 = AppState.findNodeById('p').children[0];
    const result = ValidationTree.canInsertSubtree('p', tb1);
    assert.equal(result.valid, true, 'узел не должен учитываться дважды относительно самого себя');
});

test('canInsertSubtree: move в ДРУГОЙ родитель на лимите → отказ (чужой узел туда ещё не входит)', () => {
    getStructureLimits().textBlocksPerNode = 1;
    AppState.treeData = {
        id: 'root', label: 'Акт', children: [
            { id: 'src', label: 'Источник', children: [
                { id: 'tb1', type: 'textblock', textBlockId: 'tb1', children: [] },
            ] },
            { id: 'dst', label: 'Назначение', children: [
                { id: 'tb2', type: 'textblock', textBlockId: 'tb2', children: [] },
            ] },
        ],
    };
    AppState._rebuildNodeIndex();

    const tb1 = AppState.findNodeById('src').children[0];
    const result = ValidationTree.canInsertSubtree('dst', tb1);
    assert.equal(result.valid, false, 'dst уже на лимите своим собственным tb2 — чужой узел не помещается');
});

// ── #7: обобщение на нарушения ──────────────────────────────────────────────

test('canInsertSubtree: родитель на лимите нарушений + корень-violation → отказ', () => {
    getStructureLimits().violationsPerNode = 1;
    AppState.treeData = {
        id: 'root', label: 'Акт', children: [
            { id: 'p', label: 'Пункт', children: [
                { id: 'v1', type: 'violation', violationId: 'v1', children: [] },
            ] },
        ],
    };
    AppState._rebuildNodeIndex();

    const newViolation = { id: 'v2', type: 'violation', violationId: 'v2', children: [] };
    const result = ValidationTree.canInsertSubtree('p', newViolation);
    assert.equal(result.valid, false);
    assert.match(result.message, /нарушений/);
});

test('canInsertSubtree: поддерево нарушает лимит нарушений (самосогласованность) → отказ', () => {
    getStructureLimits().violationsPerNode = 2;
    AppState.treeData = { id: 'root', label: 'Акт', children: [{ id: 'p', label: 'Пункт', children: [] }] };
    AppState._rebuildNodeIndex();

    const subtree = {
        id: 'sub', type: 'item', children: [
            { id: 'v1', type: 'violation', violationId: 'v1', children: [] },
            { id: 'v2', type: 'violation', violationId: 'v2', children: [] },
            { id: 'v3', type: 'violation', violationId: 'v3', children: [] },
        ],
    };
    assert.equal(ValidationTree.canInsertSubtree('p', subtree).valid, false);
});

test('canInsertSubtree: reorder нарушения ВНУТРИ родителя на лимите — node не считается дважды → success', () => {
    getStructureLimits().violationsPerNode = 2;
    AppState.treeData = {
        id: 'root', label: 'Акт', children: [
            { id: 'p', label: 'Пункт', children: [
                { id: 'v1', type: 'violation', violationId: 'v1', children: [] },
                { id: 'v2', type: 'violation', violationId: 'v2', children: [] },
            ] },
        ],
    };
    AppState._rebuildNodeIndex();

    const v1 = AppState.findNodeById('p').children[0];
    assert.equal(ValidationTree.canInsertSubtree('p', v1).valid, true,
        'self-exclusion по id: reorder внутри родителя на лимите не блокируется');
});

// ── #7: обобщение на таблицы (считаются ВСЕ, включая закреплённые) ──────────

test('canInsertSubtree: родитель на лимите таблиц + корень-table → отказ', () => {
    getStructureLimits().tablesPerNode = 1;
    AppState.treeData = {
        id: 'root', label: 'Акт', children: [
            { id: 'p', label: 'Пункт', children: [
                { id: 't1', type: 'table', tableId: 't1', children: [] },
            ] },
        ],
    };
    AppState._rebuildNodeIndex();

    const newTable = { id: 't2', type: 'table', tableId: 't2', children: [] };
    const result = ValidationTree.canInsertSubtree('p', newTable);
    assert.equal(result.valid, false);
    assert.match(result.message, /таблиц/);
});

test('canInsertSubtree: закреплённые metrics/risk-таблицы учитываются в лимите таблиц', () => {
    getStructureLimits().tablesPerNode = 2;
    AppState.treeData = {
        id: 'root', label: 'Акт', children: [
            { id: 'p', label: 'Пункт', children: [
                { id: 'm1', type: 'table', tableId: 'm1', kind: 'metrics', children: [] },
                { id: 't1', type: 'table', tableId: 't1', children: [] },
            ] },
        ],
    };
    AppState._rebuildNodeIndex();

    // p уже на лимите (2/2, одна из них закреплённая metrics) — новый table не влезет.
    const newTable = { id: 't2', type: 'table', tableId: 't2', children: [] };
    assert.equal(ValidationTree.canInsertSubtree('p', newTable).valid, false,
        'закреплённая metrics считается наравне с обычными таблицами');
});

test('canInsertSubtree: reorder таблицы ВНУТРИ родителя на лимите — node не считается дважды → success', () => {
    getStructureLimits().tablesPerNode = 2;
    AppState.treeData = {
        id: 'root', label: 'Акт', children: [
            { id: 'p', label: 'Пункт', children: [
                { id: 't1', type: 'table', tableId: 't1', children: [] },
                { id: 't2', type: 'table', tableId: 't2', children: [] },
            ] },
        ],
    };
    AppState._rebuildNodeIndex();

    const t1 = AppState.findNodeById('p').children[0];
    assert.equal(ValidationTree.canInsertSubtree('p', t1).valid, true,
        'self-exclusion по id: reorder таблицы внутри родителя на лимите не блокируется');
});
