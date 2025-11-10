/**
 * Обработчик контекстного меню для дерева.
 * Управляет добавлением элементов, таблиц, текстовых блоков, нарушений и удалением узлов.
 */
class TreeContextMenu {
    constructor(menu) {
        this.menu = menu;
        this.initHandlers();
    }

    /**
     * Инициализирует обработчики событий для пунктов меню.
     */
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

    /**
     * Показывает контекстное меню в указанных координатах.
     * @param {number} x - Координата X
     * @param {number} y - Координата Y
     * @param {Object} params - Параметры (nodeId и др.)
     */
    show(x, y, params = {}) {
        const {nodeId} = params;
        ContextMenuManager.positionMenu(this.menu, x, y);
    }

    /**
     * Обрабатывает выбранное действие из меню.
     * @param {string} action - Тип действия
     */
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
            case 'add-regular-table':
                this.handleAddTable(node, nodeId, 'regular');
                break;
            case 'add-regular-risk-table':
                this.handleAddTable(node, nodeId, 'regular-risk');
                break;
            case 'add-operational-risk-table':
                this.handleAddTable(node, nodeId, 'operational-risk');
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

    /**
     * Добавляет дочерний элемент к узлу.
     * @param {Object} node - Узел дерева
     * @param {string} nodeId - ID узла
     */
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

    /**
     * Добавляет соседний элемент к узлу.
     * @param {Object} node - Узел дерева
     * @param {string} nodeId - ID узла
     */
    handleAddSibling(node, nodeId) {
        const result = AppState.addNode(nodeId, '', false);
        if (result.success) {
            this.updateTreeViews();
        } else {
            alert(result.reason);
        }
    }

    /**
     * Добавляет таблицу к узлу.
     * @param {Object} node - Узел дерева
     * @param {string} nodeId - ID узла
     * @param {string} tableType - Тип таблицы ('regular', 'regular-risk', 'operational-risk')
     */
    handleAddTable(node, nodeId, tableType = 'regular') {
        if (node.type === 'table') {
            alert('Нельзя добавлять таблицу к таблице');
            return;
        }

        let result;

        switch (tableType) {
            case 'regular':
                result = AppState.addTableToNode(nodeId);
                break;
            case 'regular-risk':
                result = AppState._createRegularRiskTable(nodeId);
                if (result.success) {
                    AppState.generateNumbering();
                    // Обновляем таблицы метрик после создания таблицы риска
                    AppState._updateMetricsTablesAfterRiskTableCreated(nodeId);
                }
                break;
            case 'operational-risk':
                result = AppState._createOperationalRiskTable(nodeId);
                if (result.success) {
                    AppState.generateNumbering();
                    // Обновляем таблицы метрик после создания таблицы риска
                    AppState._updateMetricsTablesAfterRiskTableCreated(nodeId);
                }
                break;
            default:
                result = AppState.addTableToNode(nodeId);
        }

        if (result.success) {
            this.updateTreeViews();
        } else {
            alert(result.reason);
        }
    }

    /**
     * Добавляет текстовый блок к узлу.
     * @param {Object} node - Узел дерева
     * @param {string} nodeId - ID узла
     */
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

    /**
     * Добавляет нарушение к узлу.
     * @param {Object} node - Узел дерева
     * @param {string} nodeId - ID узла
     */
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

    /**
     * Удаляет узел из дерева.
     * Проверяет флаг deletable для возможности удаления.
     * @param {Object} node - Узел дерева
     * @param {string} nodeId - ID узла
     */
    handleDelete(node, nodeId) {
        // Проверка возможности удаления через флаг deletable
        // Флаг deletable работает независимо от protected
        if (node.deletable === false) {
            alert('Этот элемент нельзя удалить');
            return;
        }

        if (confirm('Удалить этот элемент?')) {
            AppState.deleteNode(nodeId);
            this.updateTreeViews();
        }
    }

    /**
     * Обновляет все представления дерева и предпросмотр.
     */
    updateTreeViews() {
        treeManager.render();
        PreviewManager.update('previewTrim', 30);
        if (AppState.currentStep === 2) {
            ItemsRenderer.renderAll();
        }
    }
}
