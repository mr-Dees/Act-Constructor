/**
 * Обработчик контекстного меню для дерева.
 */
class TreeContextMenu {
    constructor(menu) {
        this.menu = menu;
        this.initHandlers();
    }

    /** Инициализация пунктов меню */
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

    /** Отображение меню и обновление состояния */
    show(x, y, params = {}) {
        const {nodeId} = params;
        this.updateMenuState(nodeId);
        ContextMenuManager.positionMenu(this.menu, x, y);
    }

    /** Обновляет доступность пунктов меню */
    updateMenuState(nodeId) {
        if (!nodeId) return;

        const node = AppState.findNodeById(nodeId);
        if (!node) return;

        const isRiskTableAllowed = this._isRiskTableAllowedForNode(node);

        const regularRiskItem = this.menu.querySelector('[data-action="add-regular-risk-table"]');
        const operationalRiskItem = this.menu.querySelector('[data-action="add-operational-risk-table"]');

        if (regularRiskItem)
            regularRiskItem.classList.toggle('disabled', !isRiskTableAllowed);
        if (operationalRiskItem)
            operationalRiskItem.classList.toggle('disabled', !isRiskTableAllowed);

        // Показываем "Приложить фактуру" только для leaf-узлов раздела 5
        const attachInvoiceItem = this.menu.querySelector('[data-action="attach-invoice"]');
        const attachInvoiceSeparator = this.menu.querySelector('[data-action="attach-invoice-separator"]');
        const showInvoice = TreeUtils.isTbLeaf(node);
        if (attachInvoiceItem) attachInvoiceItem.style.display = showInvoice ? '' : 'none';
        if (attachInvoiceSeparator) attachInvoiceSeparator.style.display = showInvoice ? '' : 'none';

        // Меняем текст пункта в зависимости от наличия фактуры
        if (attachInvoiceItem && showInvoice) {
            const hasInvoice = !!node.invoice;
            attachInvoiceItem.textContent = hasInvoice
                ? '📎 Изменить информацию о фактуре'
                : '📎 Приложить фактуру';
        }

        // Блокируем добавление подпунктов для всех 5.*, если где-либо на 5.* есть таблицы рисков
        const addChildItem = this.menu.querySelector('[data-action="add-child"]');
        if (addChildItem) {
            const isAddChildBlocked = node.number?.match(/^5\.\d+$/) && this._hasRiskTablesAtLevel5x();
            addChildItem.classList.toggle('disabled', !!isAddChildBlocked);
        }
    }

    /** Проверяет, разрешено ли создавать таблицу риска */
    _isRiskTableAllowedForNode(node) {
        if (node.type && node.type !== AppConfig.nodeTypes.ITEM) return false;
        if (!node.number) return false;
        if (!/^5\.\d+/.test(node.number)) return false;
        // Нельзя создать вторую таблицу рисков на одном узле
        if (this._hasDirectRiskTables(node)) return false;
        // На уровне 5.* нельзя, если где-либо в 5.*.* уже есть риски
        if (node.number.match(/^5\.\d+$/) && this._hasRiskTablesBelowLevel5x()) return false;
        // На уровне 5.*.* нельзя, если где-либо на 5.* уже есть риски
        if (node.number.match(/^5\.\d+\.\d+/) && this._hasRiskTablesAtLevel5x()) return false;
        return true;
    }

    /** Возвращает причину блокировки создания таблицы рисков */
    _getRiskTableBlockReason(node) {
        if (this._hasDirectRiskTables(node)) {
            return 'На одном пункте может быть только одна таблица рисков';
        }
        if (node.number?.match(/^5\.\d+$/) && this._hasRiskTablesBelowLevel5x()) {
            return 'Нельзя создать таблицу рисков: в подпунктах раздела 5 уже есть таблицы рисков';
        }
        if (node.number?.match(/^5\.\d+\.\d+/) && this._hasRiskTablesAtLevel5x()) {
            return 'Нельзя создать таблицу рисков: в пунктах раздела 5 уже есть таблицы рисков';
        }
        return 'Таблицы рисков можно создавать только в подпунктах раздела 5';
    }

    /** Проверяет, есть ли у узла прямые дочерние таблицы рисков */
    _hasDirectRiskTables(node) {
        if (!node.children) return false;
        return node.children.some(child => {
            if (child.type !== AppConfig.nodeTypes.TABLE) return false;
            // E-2: risk-флаги читаем с node (унифицировано с metrics).
            return !!(child.isRegularRiskTable || child.isOperationalRiskTable);
        });
    }

    /** Проверяет, есть ли таблицы рисков в дочерних item-узлах */
    _hasChildItemRiskTables(node) {
        if (!node.children) return false;
        for (const child of node.children) {
            if (child.type === AppConfig.nodeTypes.ITEM && AppState._findRiskTablesInSubtree(child).length > 0) {
                return true;
            }
        }
        return false;
    }

    /** Проверяет, есть ли таблицы рисков на уровне 5.* (в любой ветке) */
    _hasRiskTablesAtLevel5x() {
        const node5 = AppState.findNodeById('5');
        if (!node5?.children) return false;
        return node5.children.some(child =>
            child.type === AppConfig.nodeTypes.ITEM && child.number?.match(/^5\.\d+$/) && this._hasDirectRiskTables(child)
        );
    }

    /** Проверяет, есть ли таблицы рисков на уровне 5.*.* и глубже (в любой ветке) */
    _hasRiskTablesBelowLevel5x() {
        const node5 = AppState.findNodeById('5');
        if (!node5?.children) return false;
        return node5.children.some(child =>
            child.type === AppConfig.nodeTypes.ITEM && child.number?.match(/^5\.\d+$/) && this._hasChildItemRiskTables(child)
        );
    }

    /** Проверяет, есть ли в разделе 5 TB-leaf узлы на уровне 5.X и item-узлы на уровне 5.X.X одновременно */
    _hasBothLevelsAvailable() {
        const node5 = AppState.findNodeById('5');
        if (!node5?.children) return false;
        const items = node5.children.filter(c => !c.type || c.type === AppConfig.nodeTypes.ITEM);
        let hasLeafAt5x = false;
        let hasNodesAt5xx = false;
        for (const child of items) {
            const itemKids = (child.children || []).filter(gc => !gc.type || gc.type === AppConfig.nodeTypes.ITEM);
            if (itemKids.length === 0) hasLeafAt5x = true;
            else hasNodesAt5xx = true;
            if (hasLeafAt5x && hasNodesAt5xx) return true;
        }
        return false;
    }

    /** Проверяет, нужно ли показать предупреждение о выборе уровня для таблиц рисков */
    _shouldShowRiskLevelWarning() {
        return !this._hasRiskTablesAtLevel5x()
            && !this._hasRiskTablesBelowLevel5x()
            && this._hasBothLevelsAvailable();
    }

    /** Показывает предупреждение о выборе уровня для таблиц рисков */
    async _showRiskLevelWarning() {
        await DialogManager.alert({
            title: 'Обратите внимание',
            icon: 'ℹ️',
            message: 'В рамках одного акта таблицы рисков могут располагаться либо на уровне пунктов (5.1, 5.2, ...), '
                + 'либо на уровне подпунктов (5.1.1, 5.1.1.1, ...), но не на обоих уровнях одновременно.\n\n'
                + 'Пожалуйста, прикрепляйте таблицы рисков только к пунктам одного уровня.',
            confirmText: 'Понятно',
            type: 'info'
        });
    }

    /** Выполняет действие */
    async handleAction(action) {
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
                if (!this._isRiskTableAllowedForNode(node)) {
                    return Notifications.error(this._getRiskTableBlockReason(node));
                }
                if (this._shouldShowRiskLevelWarning()) {
                    await this._showRiskLevelWarning();
                }
                return this.handleAddTable(node, nodeId, 'regular-risk');
            case 'add-operational-risk-table':
                if (!this._isRiskTableAllowedForNode(node)) {
                    return Notifications.error(this._getRiskTableBlockReason(node));
                }
                if (this._shouldShowRiskLevelWarning()) {
                    await this._showRiskLevelWarning();
                }
                return this.handleAddTable(node, nodeId, 'operational-risk');
            case 'add-textblock':
                this.handleAddTextBlock(node, nodeId);
                break;
            case 'add-violation':
                this.handleAddViolation(node, nodeId);
                break;
            case 'attach-invoice':
                this.handleAttachInvoice(node, nodeId);
                break;
            case 'delete':
                this.handleDelete(node, nodeId);
                break;
        }
    }

    /** Добавляет дочерний элемент */
    handleAddChild(node, nodeId) {
        if (node.type === AppConfig.nodeTypes.TABLE) {
            Notifications.error('Нельзя добавлять дочерние элементы к таблице');
            return;
        }

        // Нельзя добавлять подпункты ни к одному 5.*, если где-либо на 5.* есть таблица рисков
        if (node.number?.match(/^5\.\d+$/) && this._hasRiskTablesAtLevel5x()) {
            Notifications.error('Нельзя добавлять подпункты: в разделе 5 есть таблицы рисков на уровне пунктов');
            return;
        }

        const result = AppState.addNode(nodeId, '', true);
        if (result.valid) {
            // Добавление потомка → пересборка поддерева самого nodeId
            this.updateTreeViews(nodeId);
        } else {
            Notifications.error(result.message || 'Не удалось добавить элемент');
        }
    }

    /** Добавляет соседний элемент */
    handleAddSibling(node, nodeId) {
        // Нельзя добавлять соседние подпункты на уровне 5.*.*, если где-либо на 5.* есть таблица рисков
        if (node.number?.match(/^5\.\d+\./)) {
            if (this._hasRiskTablesAtLevel5x()) {
                Notifications.error('Нельзя добавлять подпункты: в разделе 5 есть таблицы рисков на уровне пунктов');
                return;
            }
        }

        const result = AppState.addNode(nodeId, '', false);
        if (result.valid) {
            // Добавление сиблинга → пересборка поддерева общего родителя
            const parent = AppState.findParentNode(nodeId);
            this.updateTreeViews(parent ? parent.id : undefined);
        } else {
            Notifications.error(result.message || 'Не удалось добавить элемент');
        }
    }

    /** Добавляет таблицу к узлу */
    handleAddTable(node, nodeId, tableType = 'regular') {
        if (node.type === AppConfig.nodeTypes.TABLE) {
            Notifications.error('Нельзя добавлять таблицу к таблице');
            return;
        }

        let result;
        switch (tableType) {
            case 'regular':
                result = AppState.addTableToNode(nodeId);
                break;
            case 'regular-risk':
                result = AppState._createRegularRiskTable(nodeId);
                if (result.valid) {
                    AppState.generateNumbering();
                    MetricsRiskCoordinator.onRiskTableAdded(nodeId);
                }
                break;
            case 'operational-risk':
                result = AppState._createOperationalRiskTable(nodeId);
                if (result.valid) {
                    AppState.generateNumbering();
                    MetricsRiskCoordinator.onRiskTableAdded(nodeId);
                }
                break;
            default:
                result = AppState.addTableToNode(nodeId);
        }

        if (result.valid) {
            // Регулярные/операционные риск-таблицы влияют на метрики-таблицы
            // других узлов раздела 5 → полный renderAll. Обычная таблица — узкая.
            const scope = (tableType === 'regular') ? nodeId : undefined;
            this.updateTreeViews(scope);
        } else {
            Notifications.error(result.message || 'Ошибка при добавлении таблицы');
        }
    }

    /** Добавляет текстовый блок */
    handleAddTextBlock(node, nodeId) {
        const {TABLE, TEXTBLOCK} = AppConfig.nodeTypes;
        if ([TABLE, TEXTBLOCK].includes(node.type)) {
            Notifications.error('Нельзя добавлять текстовый блок к этому элементу');
            return;
        }

        const result = AppState.addTextBlockToNode(nodeId);
        if (result.valid) {
            this.updateTreeViews(nodeId);
        } else {
            Notifications.error(result.message || 'Ошибка при добавлении текстового блока');
        }
    }

    /** Добавляет нарушение */
    handleAddViolation(node, nodeId) {
        const {TABLE, TEXTBLOCK, VIOLATION} = AppConfig.nodeTypes;
        if ([TABLE, TEXTBLOCK, VIOLATION].includes(node.type)) {
            Notifications.error('Нельзя добавлять нарушение к этому элементу');
            return;
        }

        const result = AppState.addViolationToNode(nodeId);
        if (result.valid) {
            this.updateTreeViews(nodeId);
        } else {
            Notifications.error(result.message || 'Ошибка при добавлении нарушения');
        }
    }

    /** Приложить фактуру */
    handleAttachInvoice(node, nodeId) {
        InvoiceDialog.show(node, nodeId);
    }

    /** Удаляет узел */
    handleDelete(node, nodeId) {
        if (node.deletable === false) {
            Notifications.error('Этот элемент нельзя удалить');
            return;
        }

        // Проверка удаления таблиц метрик
        if (node.type === AppConfig.nodeTypes.TABLE && node.tableId) {
            const table = AppState.tables[node.tableId];

            // Проверка под узлом 5.*
            if (table?.isMetricsTable) {
                const parentUnder5 = this._findParentFirstLevelUnderPoint5(node);
                if (parentUnder5) {
                    let hasDeepRisks = false;
                    for (const child of parentUnder5.children || []) {
                        if (child.type === AppConfig.nodeTypes.ITEM && AppState._findRiskTablesInSubtree(child).length > 0) {
                            hasDeepRisks = true;
                            break;
                        }
                    }
                    if (hasDeepRisks) {
                        Notifications.error('Нельзя удалить таблицу метрик, пока есть таблицы рисков');
                        return;
                    }
                }
            }

            // Проверка главной таблицы метрик
            if (table?.isMainMetricsTable) {
                const node5 = AppState.findNodeById('5');
                if (node5 && AppState._findRiskTablesInSubtree(node5).length > 0) {
                    Notifications.error('Нельзя удалить общую таблицу метрик, пока в пункте 5 есть таблицы рисков');
                    return;
                }
            }
        }

        // Захватываем parentId ДО удаления, иначе AppState.findParentNode вернёт null
        const parentBeforeDelete = AppState.findParentNode(nodeId);
        const parentId = parentBeforeDelete ? parentBeforeDelete.id : null;

        // Удаление таблицы рисков триггерит _cleanupMetricsTablesAfterRiskTableDeleted,
        // которая может удалить метрики-таблицы из ДРУГИХ узлов раздела 5 → fallback на renderAll.
        const isRiskTableDelete = node.type === AppConfig.nodeTypes.TABLE &&
            !!(node.isRegularRiskTable || node.isOperationalRiskTable);

        DialogManager.show({
            title: 'Удаление элемента',
            message: 'Удалить этот элемент?',
            icon: '⚠️',
            confirmText: 'Удалить',
            cancelText: 'Отмена'
        }).then(userConfirmed => {
            if (userConfirmed) {
                AppState.deleteNode(nodeId);
                this.updateTreeViews(isRiskTableDelete ? undefined : parentId);
                Notifications.info('Элемент удалён');
            }
        });
    }

    /** Ищет родителя первого уровня под пунктом 5 */
    _findParentFirstLevelUnderPoint5(node) {
        let parent = AppState.findParentNode(node.id);
        let current = node;

        while (parent && parent.id !== '5') {
            current = parent;
            parent = AppState.findParentNode(current.id);
        }

        if (parent && parent.id === '5' && current.number?.match(/^5\.\d+$/)) {
            return current;
        }
        return null;
    }

    /**
     * Обновление UI после изменения дерева.
     * @param {string} [scopeNodeId] - ID узла-родителя, чьё поддерево достаточно перерисовать.
     *   Если не указан — fallback на полный renderAll (используется для рисковых таблиц,
     *   которые затрагивают метрики-таблицы в произвольных местах раздела 5).
     */
    updateTreeViews(scopeNodeId) {
        treeManager.render();
        PreviewManager.update('previewTrim', 30);
        if (AppState.currentStep === 2) {
            if (scopeNodeId) {
                ItemsRenderer.updateItem(scopeNodeId);
            } else {
                ItemsRenderer.renderAll();
            }
        }
    }
}
