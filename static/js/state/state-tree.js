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

        child.number = number;

        // Обновляем метки таблиц метрик для узлов под пунктом 5
        if (parent.id === '5' && number.startsWith('5.')) {
            this.updateMetricsTableLabel(child.id);
        }

        // Рекурсивная нумерация дочерних элементов
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
     * @returns {Object} Результат создания узла с полями valid, message
     */
    addNode(parentId, label, isChild = true) {
        // Блокируем добавление в режиме только чтения
        if (AppConfig.readOnlyMode?.isReadOnly) {
            return ValidationCore.failure(AppConfig.readOnlyMode.messages.cannotModifyTree);
        }

        const parent = this.findNodeById(parentId);
        if (!parent) {
            return ValidationCore.failure(AppConfig.tree.validation.parentNotFound);
        }

        const validation = isChild
            ? ValidationTree.canAddChild(parentId)
            : ValidationTree.canAddSibling(parentId);

        if (!validation.valid) {
            return validation;
        }

        const newNode = this._createNewNode(label);

        if (isChild) {
            // Очищаем ТБ и фактуру у родителя, если он был листовым узлом в разделе 5
            if (TreeUtils.isUnderSection5(parent) && TreeUtils.isTbLeaf(parent)) {
                delete parent.tb;
                delete parent.invoice;
            }
            this._addAsChild(parent, newNode);
        } else {
            this._addAsSibling(parentId, newNode);
        }

        this.generateNumbering();
        return ValidationCore.success();
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
     * Добавляет узел как sibling (соседний элемент)
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
        // Блокируем удаление в режиме только чтения
        if (AppConfig.readOnlyMode?.isReadOnly) {
            Notifications.warning(AppConfig.readOnlyMode.messages.cannotModifyTree);
            return false;
        }

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
     * @param {'before'|'after'|'child'} position - Позиция относительно целевого узла
     * @returns {Promise<Object>} Результат операции с полями valid, message
     */
    async moveNode(draggedNodeId, targetNodeId, position) {
        // Блокируем перемещение в режиме только чтения
        if (AppConfig.readOnlyMode?.isReadOnly) {
            return ValidationCore.failure(AppConfig.readOnlyMode.messages.cannotModifyTree);
        }

        if (draggedNodeId === targetNodeId) {
            return ValidationCore.failure(AppConfig.tree.validation.cannotMoveToSelf);
        }

        const nodes = this._getNodesForMove(draggedNodeId, targetNodeId);
        if (!nodes.valid) return ValidationCore.failure(nodes.reason);

        const {draggedNode, targetNode, draggedParent} = nodes;

        const validation = this._validateMove(draggedNode, targetNode, position);
        if (!validation.valid) return validation;

        const newParent = this._determineNewParent(targetNode, targetNodeId, position);

        const metricsCheck = await this._checkMetricsTableDeletion(draggedNode, newParent);
        if (!metricsCheck.valid) return metricsCheck;

        const depthCheck = this._checkDepthConstraints(draggedNode, targetNode, targetNodeId, position);
        if (!depthCheck.valid) return depthCheck;

        const firstLevelCheck = this._checkFirstLevelConstraints(
            draggedNode,
            draggedParent,
            targetNode,
            targetNodeId,
            position
        );
        if (!firstLevelCheck.valid) return firstLevelCheck;

        const riskCheck = this._checkSection5RiskConstraints(draggedNode, newParent);
        if (!riskCheck.valid) return riskCheck;

        // Запоминаем, был ли новый родитель листовым узлом в разделе 5
        const wasNewParentTbLeaf = position === 'child' &&
            (!draggedNode.type || draggedNode.type === 'item') &&
            TreeUtils.isUnderSection5(newParent) &&
            TreeUtils.isTbLeaf(newParent);

        this._performMove(draggedNode, draggedParent, newParent, targetNode, targetNodeId, position);
        this.generateNumbering();

        // Очищаем ТБ и фактуру у нового родителя, если он был листовым узлом в разделе 5
        if (wasNewParentTbLeaf) {
            delete newParent.tb;
            delete newParent.invoice;
        }

        // Очищаем ТБ у старого родителя, если он стал листовым узлом в разделе 5
        if (TreeUtils.isUnderSection5(draggedParent) && TreeUtils.isTbLeaf(draggedParent)) {
            delete draggedParent.tb;
        }

        // Очищаем ТБ и фактуры если узел переместился за пределы раздела 5
        if (!TreeUtils.isUnderSection5(draggedNode)) {
            this._clearTbRecursive(draggedNode);
            this._clearInvoiceRecursive(draggedNode);
        }

        // Обрабатываем таблицы метрик для узлов под пунктом 5
        // только если у узла уже есть таблицы рисков в поддереве
        if (newParent.id === '5' && draggedNode.number?.startsWith('5.')) {
            const riskTables = this._findRiskTablesInSubtree(draggedNode);
            if (riskTables.length > 0) {
                this._handleMetricsTableForNode(draggedNode);
            }
        }

        return ValidationCore.success();
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
            return ValidationCore.failure(AppConfig.tree.validation.cannotMoveProtected);
        }

        if (TreeUtils.isDescendant(targetNode, draggedNode)) {
            return ValidationCore.failure(AppConfig.tree.validation.cannotMoveToDescendant);
        }

        return ValidationCore.success();
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
        return position === 'child' ? targetNode : this.findParentNode(targetNodeId);
    },

    /**
     * Проверяет необходимость удаления таблицы метрик при перемещении
     * @private
     * @param {Object} draggedNode - Перемещаемый узел
     * @param {Object} newParent - Новый родитель
     * @returns {Promise<Object>} Результат проверки
     */
    async _checkMetricsTableDeletion(draggedNode, newParent) {
        const hasMetricsTable = draggedNode.children?.some(
            child => child.type === 'table' && child.isMetricsTable === true
        );

        if (!hasMetricsTable) return ValidationCore.success();

        // Проверяем, останется ли узел под пунктом 5 первого уровня
        const willStayUnder5FirstLevel = newParent && newParent.id === '5';
        if (willStayUnder5FirstLevel) return ValidationCore.success();

        // Запрашиваем подтверждение удаления таблицы метрик
        const confirmed = await DialogManager.show(
            AppConfig.content.dialogs.deleteMetricsTable
        );

        if (!confirmed) {
            return ValidationCore.failure('Перемещение отменено пользователем');
        }

        this._removeMetricsTable(draggedNode);
        return ValidationCore.success();
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
        // Информационные узлы не учитываются в глубине
        const isInformational = ['table', 'textblock', 'violation'].includes(draggedNode.type);
        if (isInformational) return ValidationCore.success();

        const targetDepth = this._calculateTargetDepth(targetNode, targetNodeId, position);
        const draggedSubtreeDepth = TreeUtils.getSubtreeDepth(draggedNode);
        const resultingDepth = targetDepth + 1 + draggedSubtreeDepth;

        if (resultingDepth > AppConfig.tree.maxDepth) {
            return ValidationCore.failure(
                `Перемещение приведет к превышению максимальной вложенности (${resultingDepth} > ${AppConfig.tree.maxDepth} уровней)`
            );
        }

        return ValidationCore.success();
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
            return TreeUtils.getNodeDepth(targetNodeId);
        }

        const targetParent = this.findParentNode(targetNodeId);
        return targetParent ? TreeUtils.getNodeDepth(targetParent.id) : 0;
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
        // Проверяем только при перемещении before/after
        if (position === 'child') return ValidationCore.success();

        const targetParent = this.findParentNode(targetNodeId);
        if (!targetParent || targetParent.id !== 'root') return ValidationCore.success();

        // Если узел уже на первом уровне, разрешаем перемещение
        if (draggedParent.id === 'root') return ValidationCore.success();

        // Проверяем, есть ли уже кастомный пункт 6
        const hasCustomFirstLevel = targetParent.children.some(child => {
            const num = child.number ? parseInt(child.number) : null;
            return num === 6;
        });

        if (hasCustomFirstLevel) {
            return ValidationCore.failure('На первом уровне уже есть дополнительный пункт (6)');
        }

        // Проверяем, что добавляем только после пункта 5 или перед пунктом 6
        const targetNumber = targetNode.number ? parseInt(targetNode.number) : null;
        if (!targetNumber) return ValidationCore.success();

        if ((position === 'before' && targetNumber !== 6) ||
            (position === 'after' && targetNumber !== 5)) {
            return ValidationCore.failure(AppConfig.tree.validation.firstLevelOnlyAtEnd);
        }

        return ValidationCore.success();
    },

    /**
     * Проверяет ограничения перемещения узлов в раздел 5 с учётом таблиц рисков
     * @private
     * @param {Object} draggedNode - Перемещаемый узел
     * @param {Object} newParent - Новый родитель после перемещения
     * @returns {Object} Результат проверки
     */
    _checkSection5RiskConstraints(draggedNode, newParent) {
        // Проверяем только item-узлы
        if (draggedNode.type && draggedNode.type !== 'item') return ValidationCore.success();

        // Если новый родитель — узел 5.*, проверяем наличие таблиц рисков на уровне 5.*
        if (newParent.number?.match(/^5\.\d+$/)) {
            const node5 = this.findNodeById('5');
            if (node5?.children) {
                const hasRiskAtLevel5x = node5.children.some(child => {
                    if (child.type !== 'item' || !child.number?.match(/^5\.\d+$/)) return false;
                    return child.children?.some(c => {
                        if (c.type !== 'table' || !c.tableId) return false;
                        const table = this.tables[c.tableId];
                        return table && (table.isRegularRiskTable || table.isOperationalRiskTable);
                    });
                });
                if (hasRiskAtLevel5x) {
                    return ValidationCore.failure(
                        'Нельзя перемещать элементы в подпункты раздела 5: есть таблицы рисков на уровне пунктов'
                    );
                }
            }
        }

        return ValidationCore.success();
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
        // Удаляем узел из старого родителя
        draggedParent.children = draggedParent.children.filter(n => n.id !== draggedNode.id);

        // Добавляем узел в новую позицию
        if (position === 'child') {
            if (!newParent.children) newParent.children = [];
            newParent.children.push(draggedNode);
        } else {
            const insertIndex = newParent.children.findIndex(n => n.id === targetNodeId);
            const offset = position === 'after' ? 1 : 0;
            let effectiveIndex = insertIndex + offset;

            // Страховка: не вставляем перед закреплёнными таблицами
            const firstNonPinnedIndex = this._getFirstNonPinnedIndex(newParent);
            if (effectiveIndex < firstNonPinnedIndex) {
                effectiveIndex = firstNonPinnedIndex;
            }

            newParent.children.splice(effectiveIndex, 0, draggedNode);
        }

        // Обновляем parentId если он существует
        if (draggedNode.parentId) {
            draggedNode.parentId = newParent.id;
        }
    },

    /**
     * Возвращает индекс первого незакреплённого элемента в children родителя
     * @private
     * @param {Object} parent - Родительский узел
     * @returns {number} Индекс первого незакреплённого элемента
     */
    _getFirstNonPinnedIndex(parent) {
        if (!parent.children) return 0;
        for (let i = 0; i < parent.children.length; i++) {
            if (!TreeUtils.isPinnedTable(parent.children[i])) return i;
        }
        return parent.children.length;
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
            if (result.valid) {
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
    },

    /**
     * Рекурсивно очищает свойство tb у узла и всех его потомков
     * @private
     * @param {Object} node - Узел для очистки
     */
    _clearTbRecursive(node) {
        if (node.tb) {
            delete node.tb;
        }

        if (node.children) {
            for (const child of node.children) {
                this._clearTbRecursive(child);
            }
        }
    },

    /**
     * Рекурсивно очищает свойство invoice у узла и всех его потомков
     * @private
     * @param {Object} node - Узел для очистки
     */
    _clearInvoiceRecursive(node) {
        if (node.invoice) {
            delete node.invoice;
        }

        if (node.children) {
            for (const child of node.children) {
                this._clearInvoiceRecursive(child);
            }
        }
    }
});
