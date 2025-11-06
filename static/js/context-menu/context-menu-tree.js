/**
 * Обработчик контекстного меню для дерева
 */
class TreeContextMenu {
    constructor(menu) {
        this.menu = menu;
        this.initHandlers();
    }

    initHandlers() {
        this.menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();

                if (item.classList.contains('disabled')) return;

                const action = item.dataset.action;
                this.handleAction(action);
                ContextMenuManager.hide();
            });
        });
    }

    show(x, y, params = {}) {
        const {nodeId} = params;
        ContextMenuManager.positionMenu(this.menu, x, y);
    }

    handleAction(action) {
        const nodeId = ContextMenuManager.currentNodeId;
        if (!nodeId) return;

        const node = AppState.findNodeById(nodeId);
        if (!node) return;

        switch (action) {
            case 'add-child':
                this.handleAddChild(node, nodeId);
                break;
            case 'add-sibling':
                this.handleAddSibling(node, nodeId);
                break;
            case 'add-table':
                this.handleAddTable(node, nodeId);
                break;
            case 'add-textblock':
                this.handleAddTextBlock(node, nodeId);
                break;
            case 'add-violation':
                this.handleAddViolation(node, nodeId);
                break;
            case 'delete':
                this.handleDelete(node, nodeId);
                break;
        }
    }

    handleAddChild(node, nodeId) {
        if (node.type === 'table') {
            alert('Нельзя добавлять дочерние элементы к таблице');
            return;
        }

        const result = AppState.addNode(nodeId, '', true);
        if (result.success) {
            this.updateTreeViews();
        } else {
            alert(result.reason);
        }
    }

    handleAddSibling(node, nodeId) {
        const result = AppState.addNode(nodeId, '', false);
        if (result.success) {
            this.updateTreeViews();
        } else {
            alert(result.reason);
        }
    }

    handleAddTable(node, nodeId) {
        if (node.type === 'table') {
            alert('Нельзя добавлять таблицу к таблице');
            return;
        }

        const result = AppState.addTableToNode(nodeId);
        if (result.success) {
            this.updateTreeViews();
        } else {
            alert(result.reason);
        }
    }

    handleAddTextBlock(node, nodeId) {
        if (node.type === 'table' || node.type === 'textblock') {
            alert('Нельзя добавлять текстовый блок к этому элементу');
            return;
        }

        const result = AppState.addTextBlockToNode(nodeId);
        if (result.success) {
            this.updateTreeViews();
        } else {
            alert(result.reason);
        }
    }

    handleAddViolation(node, nodeId) {
        if (node.type === 'table' || node.type === 'textblock' || node.type === 'violation') {
            alert('Нельзя добавлять нарушение к этому элементу');
            return;
        }

        const result = AppState.addViolationToNode(nodeId);
        if (result.success) {
            this.updateTreeViews();
        } else {
            alert(result.reason);
        }
    }

    handleDelete(node, nodeId) {
        if (node.protected) {
            alert('Нельзя удалить защищенный элемент');
            return;
        }

        if (confirm('Удалить этот элемент?')) {
            AppState.deleteNode(nodeId);
            this.updateTreeViews();
        }
    }

    updateTreeViews() {
        treeManager.render();
        PreviewManager.update('previewTrim', 30);
        if (AppState.currentStep === 2) {
            ItemsRenderer.renderAll();
        }
    }
}
