/**
 * Модуль операций с деревом документа
 *
 * Управляет CRUD операциями с узлами, иерархической нумерацией,
 * перемещением элементов и обновлением связанных данных.
 */

Object.assign(AppState, {
    /**
     * Генерирует иерархическую нумерацию для всех узлов дерева
     * @param {Object} [node=this.treeData] - Узел для обработки
     * @param {string} [prefix=''] - Префикс нумерации
     */
    generateNumbering(node = this.treeData, prefix = '') {
        if (!node.children) return;

        node.children.forEach((child, index) => {
            if (child.type === 'table') {
                this._numberTable(child, node);
            } else if (child.type === 'textblock') {
                this._numberTextBlock(child, node);
            } else if (child.type === 'violation') {
                this._numberViolation(child, node);
            } else {
                this._numberItem(child, node, prefix, index);
            }
        });
    },

    /**
     * Нумерует таблицу в рамках родительского узла
     * @private
     * @param {Object} child - Узел таблицы
     * @param {Object} parent - Родительский узел
     */
    _numberTable(child, parent) {
        const parentTables = parent.children.filter(c => c.type === 'table');
        const tableIndex = parentTables.indexOf(child) + 1;

        child.number = `Таблица ${tableIndex}`;
        child.label = child.customLabel || child.number;
    },

    /**
     * Нумерует текстовый блок в рамках родительского узла
     * @private
     * @param {Object} child - Узел текстового блока
     * @param {Object} parent - Родительский узел
     */
    _numberTextBlock(child, parent) {
        const parentTextBlocks = parent.children.filter(c => c.type === 'textblock');
        const textBlockIndex = parentTextBlocks.indexOf(child) + 1;

        child.number = `Текстовый блок ${textBlockIndex}`;
        child.label = child.customLabel || child.number;
    },

    /**
     * Нумерует нарушение в рамках родительского узла
     * @private
     * @param {Object} child - Узел нарушения
     * @param {Object} parent - Родительский узел
     */
    _numberViolation(child, parent) {
        const parentViolations = parent.children.filter(c => c.type === 'violation');
        const violationIndex = parentViolations.indexOf(child) + 1;

        child.number = `Нарушение ${violationIndex}`;
        child.label = child.customLabel || child.number;
    },

    /**
     * Нумерует обычный пункт с иерархической структурой
     * @private
     * @param {Object} child - Узел пункта
     * @param {Object} parent - Родительский узел
     * @param {string} prefix - Префикс нумерации
     * @param {number} index - Индекс среди siblings
     */
    _numberItem(child, parent, prefix, index) {
        const itemChildren = parent.children.filter(c => !c.type || c.type === 'item');
        const itemIndex = itemChildren.indexOf(child);

        if (itemIndex === -1) return;

        const number = prefix ? `${prefix}.${itemIndex + 1}` : `${itemIndex + 1}`;
        const baseLabelMatch = child.label.match(/^[\d.]+\s*(.*)$/);
        const baseLabel = baseLabelMatch ? baseLabelMatch[1] : child.label;

        child.number = number;
        child.label = `${number}. ${baseLabel}`;

        if (parent.id === '5' && number.startsWith('5.')) {
            this.updateMetricsTableLabel(child.id);
        }

        if (child.children?.length > 0) {
            this.generateNumbering(child, number);
        }
    },

    /**
     * Обновляет название таблицы метрик после изменения номера узла
     * @param {string} nodeId - ID узла
     */
    updateMetricsTableLabel(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node?.children) return;

        const metricsTableNode = node.children.find(child =>
            child.type === 'table' && child.isMetricsTable === true
        );

        if (metricsTableNode && node.number) {
            const newLabel = `Объем выявленных отклонений (В метриках) по ${node.number}`;
            metricsTableNode.label = newLabel;
            metricsTableNode.customLabel = newLabel;
        }
    },

    /**
     * Добавляет новый узел в дерево
     * @param {string} parentId - ID родительского узла
     * @param {string} label - Название нового узла
     * @param {boolean} [isChild=true] - Добавить как дочерний элемент или sibling
     * @returns {Object} Результат создания узла
     */
    addNode(parentId, label, isChild = true) {
        const parent = this.findNodeById(parentId);
        if (!parent) return {
            success: false,
            reason: AppConfig.tree.validation.parentNotFound
        };

        const validation = isChild
            ? ValidationCore.canAddChild(parentId)
            : ValidationCore.canAddSibling(parentId);

        if (!validation.allowed) {
            return {success: false, reason: validation.reason};
        }

        const newNode = this._createNewNode(label);

        if (isChild) {
            this._addAsChild(parent, newNode);
        } else {
            this._addAsSibling(parentId, newNode);
        }

        this.generateNumbering();
        return {success: true, node: newNode};
    },

    /**
     * Создает новый узел с дефолтными настройками
     * @private
     * @param {string} label - Название узла
     * @returns {Object} Новый узел
     */
    _createNewNode(label) {
        return {
            id: this._generateId('node'),
            label: label || AppConfig.tree.labels.newItem,
            children: [],
            content: '',
            type: 'item'
        };
    },

    /**
     * Добавляет узел как дочерний элемент
     * @private
     * @param {Object} parent - Родительский узел
     * @param {Object} newNode - Новый узел
     */
    _addAsChild(parent, newNode) {
        if (!parent.children) parent.children = [];
        parent.children.push(newNode);
    },

    /**
     * Добавляет узел как sibling
     * @private
     * @param {string} siblingId - ID узла-соседа
     * @param {Object} newNode - Новый узел
     */
    _addAsSibling(siblingId, newNode) {
        const grandParent = this.findParentNode(siblingId);

        if (grandParent?.children) {
            const index = grandParent.children.findIndex(n => n.id === siblingId);
            grandParent.children.splice(index + 1, 0, newNode);
        }
    },

    /**
     * Удаляет узел и все связанные данные
     * @param {string} nodeId - ID узла для удаления
     * @returns {boolean} true если удаление успешно
     */
    deleteNode(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return false;

        const isRiskTable = this._isRiskTable(node);

        this._deleteNodeData(node);
        this._deleteChildren(node);
        this._removeFromParent(nodeId);

        if (isRiskTable) {
            this._cleanupMetricsTablesAfterRiskTableDeleted(nodeId);
        }

        this.generateNumbering();
        return true;
    },

    /**
     * Проверяет, является ли узел таблицей риска
     * @private
     * @param {Object} node - Проверяемый узел
     * @returns {boolean} true если это таблица риска
     */
    _isRiskTable(node) {
        if (node.type !== 'table' || !node.tableId) return false;

        const table = this.tables[node.tableId];
        return table && (table.isRegularRiskTable || table.isOperationalRiskTable);
    },

    /**
     * Удаляет данные узла из хранилищ
     * @private
     * @param {Object} node - Узел для удаления данных
     */
    _deleteNodeData(node) {
        if (node.type === 'table' && node.tableId) {
            delete this.tables[node.tableId];
            delete this.tableUISizes?.[node.tableId];
        } else if (node.type === 'textblock' && node.textBlockId) {
            delete this.textBlocks[node.textBlockId];
        } else if (node.type === 'violation' && node.violationId) {
            delete this.violations[node.violationId];
        }
    },

    /**
     * Рекурсивно удаляет дочерние элементы
     * @private
     * @param {Object} node - Узел с дочерними элементами
     */
    _deleteChildren(node) {
        if (!node.children) return;

        const childrenToDelete = [...node.children];
        for (const child of childrenToDelete) {
            this.deleteNode(child.id);
        }
    },

    /**
     * Удаляет узел из массива children родителя
     * @private
     * @param {string} nodeId - ID узла
     */
    _removeFromParent(nodeId) {
        const parent = this.findParentNode(nodeId);

        if (parent?.children) {
            parent.children = parent.children.filter(child => child.id !== nodeId);
        }
    },

    /**
     * Перемещает узел в новую позицию
     * @param {string} draggedNodeId - ID перемещаемого узла
     * @param {string} targetNodeId - ID целевого узла
     * @param {string} position - Позиция: 'before', 'after', 'child'
     * @returns {Promise<Object>} Результат операции
     */
    async moveNode(draggedNodeId, targetNodeId, position) {
        if (draggedNodeId === targetNodeId) {
            return {
                success: false,
                reason: AppConfig.tree.validation.cannotMoveToSelf
            };
        }

        const nodes = this._getNodesForMove(draggedNodeId, targetNodeId);
        if (!nodes.valid) return {success: false, reason: nodes.reason};

        const {draggedNode, targetNode, draggedParent} = nodes;

        const validation = this._validateMove(draggedNode, targetNode, position);
        if (!validation.success) return validation;

        const newParent = this._determineNewParent(targetNode, targetNodeId, position);

        const metricsCheck = await this._checkMetricsTableDeletion(
            draggedNode,
            newParent
        );

        if (!metricsCheck.success) return metricsCheck;

        const depthCheck = this._checkDepthConstraints(
            draggedNode,
            targetNode,
            targetNodeId,
            position
        );

        if (!depthCheck.success) return depthCheck;

        const firstLevelCheck = this._checkFirstLevelConstraints(
            draggedNode,
            draggedParent,
            targetNode,
            targetNodeId,
            position
        );

        if (!firstLevelCheck.success) return firstLevelCheck;

        this._performMove(draggedNode, draggedParent, newParent, targetNode, targetNodeId, position);
        this.generateNumbering();

        if (newParent.id === '5' && draggedNode.number?.startsWith('5.')) {
            this._handleMetricsTableForNode(draggedNode);
        }

        return {success: true, node: draggedNode};
    },

    /**
     * Получает узлы для операции перемещения
     * @private
     * @param {string} draggedNodeId - ID перемещаемого узла
     * @param {string} targetNodeId - ID целевого узла
     * @returns {Object} Объект с узлами или ошибкой
     */
    _getNodesForMove(draggedNodeId, targetNodeId) {
        const draggedNode = this.findNodeById(draggedNodeId);
        const targetNode = this.findNodeById(targetNodeId);
        const draggedParent = this.findParentNode(draggedNodeId);

        if (!draggedNode || !targetNode || !draggedParent) {
            return {
                valid: false,
                reason: AppConfig.tree.validation.nodeNotFound
            };
        }

        return {valid: true, draggedNode, targetNode, draggedParent};
    },

    /**
     * Валидирует возможность перемещения
     * @private
     * @param {Object} draggedNode - Перемещаемый узел
     * @param {Object} targetNode - Целевой узел
     * @param {string} position - Позиция
     * @returns {Object} Результат валидации
     */
    _validateMove(draggedNode, targetNode, position) {
        if (draggedNode.protected) {
            return {
                success: false,
                reason: AppConfig.tree.validation.cannotMoveProtected
            };
        }

        if (ValidationCore.isDescendant(targetNode, draggedNode)) {
            return {
                success: false,
                reason: AppConfig.tree.validation.cannotMoveToDescendant
            };
        }

        return {success: true};
    },

    /**
     * Определяет нового родителя после перемещения
     * @private
     * @param {Object} targetNode - Целевой узел
     * @param {string} targetNodeId - ID целевого узла
     * @param {string} position - Позиция
     * @returns {Object} Новый родительский узел
     */
    _determineNewParent(targetNode, targetNodeId, position) {
        return position === 'child'
            ? targetNode
            : this.findParentNode(targetNodeId);
    },

    /**
     * Проверяет необходимость удаления таблицы метрик
     * @private
     * @param {Object} draggedNode - Перемещаемый узел
     * @param {Object} newParent - Новый родитель
     * @returns {Promise<Object>} Результат проверки
     */
    async _checkMetricsTableDeletion(draggedNode, newParent) {
        const hasMetricsTable = draggedNode.children?.some(
            child => child.type === 'table' && child.isMetricsTable === true
        );

        if (!hasMetricsTable) return {success: true};

        const willStayUnder5FirstLevel = newParent && newParent.id === '5';
        if (willStayUnder5FirstLevel) return {success: true};

        const confirmed = await DialogManager.show(
            AppConfig.content.dialogs.deleteMetricsTable
        );

        if (!confirmed) {
            return {
                success: false,
                reason: 'Перемещение отменено пользователем',
                cancelled: true
            };
        }

        this._removeMetricsTable(draggedNode);
        return {success: true};
    },

    /**
     * Удаляет таблицу метрик из узла
     * @private
     * @param {Object} node - Узел с таблицей метрик
     */
    _removeMetricsTable(node) {
        const metricsTableNode = node.children.find(
            child => child.type === 'table' && child.isMetricsTable === true
        );

        if (metricsTableNode) {
            delete this.tables[metricsTableNode.tableId];
            node.children = node.children.filter(
                child => child.id !== metricsTableNode.id
            );
        }
    },

    /**
     * Проверяет ограничения глубины вложенности
     * @private
     * @param {Object} draggedNode - Перемещаемый узел
     * @param {Object} targetNode - Целевой узел
     * @param {string} targetNodeId - ID целевого узла
     * @param {string} position - Позиция
     * @returns {Object} Результат проверки
     */
    _checkDepthConstraints(draggedNode, targetNode, targetNodeId, position) {
        const isInformational = ['table', 'textblock', 'violation'].includes(draggedNode.type);
        if (isInformational) return {success: true};

        const targetDepth = this._calculateTargetDepth(targetNode, targetNodeId, position);
        const draggedSubtreeDepth = ValidationCore.getSubtreeDepth(draggedNode);
        const resultingDepth = targetDepth + 1 + draggedSubtreeDepth;

        if (resultingDepth > AppConfig.tree.maxDepth) {
            return {
                success: false,
                reason: `Перемещение приведет к превышению максимальной вложенности (${resultingDepth} > ${AppConfig.tree.maxDepth} уровней)`
            };
        }

        return {success: true};
    },

    /**
     * Вычисляет целевую глубину для перемещения
     * @private
     * @param {Object} targetNode - Целевой узел
     * @param {string} targetNodeId - ID целевого узла
     * @param {string} position - Позиция
     * @returns {number} Целевая глубина
     */
    _calculateTargetDepth(targetNode, targetNodeId, position) {
        if (position === 'child') {
            return ValidationCore.getNodeDepth(targetNodeId);
        }

        const targetParent = this.findParentNode(targetNodeId);
        return targetParent ? ValidationCore.getNodeDepth(targetParent.id) : 0;
    },

    /**
     * Проверяет ограничения для первого уровня
     * @private
     * @param {Object} draggedNode - Перемещаемый узел
     * @param {Object} draggedParent - Текущий родитель
     * @param {Object} targetNode - Целевой узел
     * @param {string} targetNodeId - ID целевого узла
     * @param {string} position - Позиция
     * @returns {Object} Результат проверки
     */
    _checkFirstLevelConstraints(draggedNode, draggedParent, targetNode, targetNodeId, position) {
        if (position === 'child') return {success: true};

        const targetParent = this.findParentNode(targetNodeId);
        if (!targetParent || targetParent.id !== 'root') return {success: true};

        if (draggedParent.id === 'root') return {success: true};

        const hasCustomFirstLevel = targetParent.children.some(child => {
            const num = child.label.match(/^(\d+)\./);
            return num && parseInt(num[1]) === 6;
        });

        if (hasCustomFirstLevel) {
            return {
                success: false,
                reason: 'На первом уровне уже есть дополнительный пункт (6)'
            };
        }

        const targetNum = targetNode.label.match(/^(\d+)\./);
        if (!targetNum) return {success: true};

        const targetNumber = parseInt(targetNum[1]);

        if ((position === 'before' && targetNumber !== 6) ||
            (position === 'after' && targetNumber !== 5)) {
            return {
                success: false,
                reason: AppConfig.tree.validation.firstLevelOnlyAtEnd
            };
        }

        return {success: true};
    },

    /**
     * Выполняет перемещение узла
     * @private
     * @param {Object} draggedNode - Перемещаемый узел
     * @param {Object} draggedParent - Текущий родитель
     * @param {Object} newParent - Новый родитель
     * @param {Object} targetNode - Целевой узел
     * @param {string} targetNodeId - ID целевого узла
     * @param {string} position - Позиция
     */
    _performMove(draggedNode, draggedParent, newParent, targetNode, targetNodeId, position) {
        draggedParent.children = draggedParent.children.filter(n => n.id !== draggedNode.id);

        if (position === 'child') {
            if (!newParent.children) newParent.children = [];
            newParent.children.push(draggedNode);
        } else {
            const insertIndex = newParent.children.findIndex(n => n.id === targetNodeId);
            const offset = position === 'after' ? 1 : 0;
            newParent.children.splice(insertIndex + offset, 0, draggedNode);
        }

        if (draggedNode.parentId) {
            draggedNode.parentId = newParent.id;
        }
    },

    /**
     * Обрабатывает таблицу метрик для узла под пунктом 5
     * @private
     * @param {Object} node - Узел для обработки
     */
    _handleMetricsTableForNode(node) {
        const hasTable = node.children?.some(
            child => child.type === 'table' && child.isMetricsTable === true
        );

        if (!hasTable) {
            const result = this._createMetricsTable(node.id, node.number);
            if (result.success) {
                this.generateNumbering();
            }
        } else {
            this.updateMetricsTableLabel(node.id);
        }
    },

    /**
     * Проверяет, является ли узел дочерним элементом пункта 5 первого уровня
     * @param {string} nodeId - ID проверяемого узла
     * @returns {boolean} true если узел под пунктом 5 первого уровня
     */
    isDirectChildOf5(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return false;

        const parent = this.findParentNode(nodeId);
        if (!parent || parent.id !== '5') return false;

        return node.number && node.number.match(/^5\.\d+$/);
    }
});
