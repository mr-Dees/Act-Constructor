/**
 * Null-guard в handleDragOver (tree-4).
 *
 * dragover может прийти по DOM-элементу, чей узел уже удалён из AppState
 * (stale-DOM между мутацией и ререндером): findNodeById вернёт null, и без
 * guard'а null уходил в isDescendant/_calculateDropPosition → TypeError.
 * Ожидание: зона сброса очищается, исключения нет.
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import { TreeDragDrop } from '../../static/js/constructor/tree/tree-drag-drop.js';

/** Минимальный fake tree-item с dataset и геометрией. */
function makeFakeTreeItem(nodeId) {
    return {
        dataset: { nodeId },
        classList: { add() {}, remove() {}, contains: () => false },
        getBoundingClientRect: () => ({ top: 0, left: 0, right: 100, bottom: 20, height: 20, width: 100 }),
        querySelector: () => null,
    };
}

/** Fake dragover-событие, ведущее на указанный tree-item. */
function makeDragOverEvent(treeItem) {
    return {
        preventDefault() {},
        stopPropagation() {},
        dataTransfer: {},
        clientY: 10,
        target: { closest: () => treeItem },
    };
}

let dragDrop;

beforeEach(() => {
    AppState.treeData = {
        id: 'root',
        label: 'Акт',
        children: [
            { id: 'n1', label: 'Перетаскиваемый', type: 'item', children: [] },
        ],
    };
    AppState._rebuildNodeIndex();
    AppState._dragInProgress = true;

    // init() не зовём (MutationObserver не нужен) — тестируем handleDragOver напрямую.
    dragDrop = new TreeDragDrop({ container: null });
    dragDrop.draggedNode = AppState.findNodeById('n1');
    dragDrop.draggedElement = makeFakeTreeItem('n1');
});

test('handleDragOver: целевой узел не найден в состоянии → зона сброса очищена, без исключения', () => {
    const ghostItem = makeFakeTreeItem('ghost-id');
    // Имитируем «висящую» зону сброса от предыдущего dragover.
    dragDrop.currentDropZone = makeFakeTreeItem('n-old');
    dragDrop.dropPosition = 'after';
    dragDrop.dropTargetNode = { id: 'n-old' };

    assert.doesNotThrow(() => {
        dragDrop.handleDragOver(makeDragOverEvent(ghostItem));
    });

    assert.equal(dragDrop.dropTargetNode, null, 'цель сброса должна быть сброшена');
    assert.equal(dragDrop.dropPosition, null);
    assert.equal(dragDrop.currentDropZone, null);
});

test('handleDragOver: существующий целевой узел обрабатывается как раньше', () => {
    AppState.treeData.children.push({ id: 'n2', label: 'Цель', type: 'item', children: [] });
    AppState._rebuildNodeIndex();

    const targetItem = makeFakeTreeItem('n2');
    dragDrop.handleDragOver(makeDragOverEvent(targetItem));

    assert.ok(dragDrop.dropTargetNode, 'валидная цель должна установить зону сброса');
    assert.equal(dragDrop.dropTargetNode.id, 'n2');
});
