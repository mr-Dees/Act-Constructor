/**
 * Обработчик контекстного меню для дерева.
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
     * Показывает контекстное меню и обновляет доступность пунктов.
     * @param {number} x - Координата X
     * @param {number} y - Координата Y
     * @param {Object} params - Параметры (nodeId и др.)
     */
    show(x, y, params = {}) {
        const {nodeId} = params;

        // Обновляем состояние пунктов меню перед показом
        this.updateMenuState(nodeId);

        ContextMenuManager.positionMenu(this.menu, x, y);
    }

    /**
     * Обновляет доступность пунктов меню в зависимости от выбранного узла.
     * Таблицы рисков доступны только для узлов 5.*.* (третий уровень под пунктом 5).
     * @param {string} nodeId - ID выбранного узла
     */
    updateMenuState(nodeId) {
        if (!nodeId) return;

        const node = AppState.findNodeById(nodeId);
        if (!node) return;

        // Проверяем, является ли узел подходящим для создания таблиц рисков
        const isRiskTableAllowed = this._isRiskTableAllowedForNode(node);

        // Находим пункты меню для таблиц рисков
        const regularRiskItem = this.menu.querySelector('[data-action="add-regular-risk-table"]');
        const operationalRiskItem = this.menu.querySelector('[data-action="add-operational-risk-table"]');

        // Активируем/деактивируем пункты
        if (regularRiskItem) {
            regularRiskItem.classList.toggle('disabled', !isRiskTableAllowed);
        }
        if (operationalRiskItem) {
            operationalRiskItem.classList.toggle('disabled', !isRiskTableAllowed);
        }
    }

    /**
     * Проверяет, можно ли создать таблицу риска для данного узла.
     * Разрешено только для узлов с номером вида 5.*.* (третий уровень под пунктом 5).
     * @param {Object} node - Узел дерева
     * @returns {boolean} true если можно создать таблицу риска
     */
    _isRiskTableAllowedForNode(node) {
        // Таблицы рисков можно создавать только для обычных узлов (не для таблиц, текстовых блоков и т.д.)
        if (node.type !== 'item' && node.type !== undefined) {
            return false;
        }

        // Проверяем номер узла
        if (!node.number) {
            return false;
        }

        // Разрешаем только для узлов с номером вида 5.X.Y (третий уровень под пунктом 5)
        // Регулярное выражение: начинается с "5.", затем цифра(ы), точка, затем цифра(ы), конец строки
        const pattern = /^5\.\d+\.\d+/;
        return pattern.test(node.number);
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
                // Дополнительная проверка перед созданием
                if (this._isRiskTableAllowedForNode(node)) {
                    this.handleAddTable(node, nodeId, 'regular-risk');
                } else {
                    Notifications.error('Таблицы рисков можно создавать только в пунктах 5.*.*');
                }
                break;
            case 'add-operational-risk-table':
                // Дополнительная проверка перед созданием
                if (this._isRiskTableAllowedForNode(node)) {
                    this.handleAddTable(node, nodeId, 'operational-risk');
                } else {
                    Notifications.error('Таблицы рисков можно создавать только в пунктах 5.*.*');
                }
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
     * @param {string} tableType - Тип таблицы
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
                    AppState._updateMetricsTablesAfterRiskTableCreated(nodeId);
                }
                break;
            case 'operational-risk':
                result = AppState._createOperationalRiskTable(nodeId);
                if (result.success) {
                    AppState.generateNumbering();
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
     * Проверяет флаг deletable и наличие связанных таблиц рисков для таблиц метрик.
     * @param {Object} node - Узел дерева
     * @param {string} nodeId - ID узла
     */
    handleDelete(node, nodeId) {
        // Проверка возможности удаления через флаг deletable
        if (node.deletable === false) {
            alert('Этот элемент нельзя удалить');
            return;
        }

        // НОВАЯ ПРОВЕРКА: для таблиц метрик проверяем наличие связанных таблиц рисков
        if (node.type === 'table' && node.tableId) {
            const table = AppState.tables[node.tableId];

            // Проверка для таблицы метрик пункта 5.*
            if (table && table.isMetricsTable) {
                // Находим родительский узел первого уровня (5.X)
                const parentFirstLevel = this._findParentFirstLevelUnderPoint5(node);

                if (parentFirstLevel) {
                    // Проверяем наличие таблиц рисков в поддереве
                    const hasRiskTables = AppState._findRiskTablesInSubtree(parentFirstLevel).length > 0;

                    if (hasRiskTables) {
                        alert('Нельзя удалить таблицу метрик, пока существуют таблицы рисков в этом разделе');
                        return;
                    }
                }
            }

            // Проверка для главной таблицы метрик пункта 5
            if (table && table.isMainMetricsTable) {
                const node5 = AppState.findNodeById('5');

                if (node5) {
                    // Проверяем наличие хотя бы одной таблицы риска во всем пункте 5
                    const hasRiskTables = AppState._findRiskTablesInSubtree(node5).length > 0;

                    if (hasRiskTables) {
                        alert('Нельзя удалить общую таблицу метрик, пока существуют таблицы рисков в пункте 5');
                        return;
                    }
                }
            }
        }

        if (confirm('Удалить этот элемент?')) {
            AppState.deleteNode(nodeId);
            this.updateTreeViews();
        }
    }

    /**
     * Находит родительский узел первого уровня под пунктом 5 (5.X).
     * @param {Object} node - Текущий узел
     * @returns {Object|null} Родительский узел первого уровня или null
     */
    _findParentFirstLevelUnderPoint5(node) {
        let currentNode = node;
        let parentNode = AppState.findParentNode(currentNode.id);

        // Ищем узел с номером вида "5.X" (дочерний узел первого уровня под пунктом 5)
        while (parentNode && parentNode.id !== '5') {
            currentNode = parentNode;
            parentNode = AppState.findParentNode(currentNode.id);
        }

        // Если нашли узел под пунктом 5 с номером вида "5.X"
        if (parentNode && parentNode.id === '5' && currentNode.number && currentNode.number.match(/^5\.\d+$/)) {
            return currentNode;
        }

        return null;
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
