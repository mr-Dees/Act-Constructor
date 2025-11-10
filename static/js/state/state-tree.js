/**
 * Модуль операций с деревом документа.
 * Управляет CRUD операциями с узлами, нумерацией и перемещением элементов.
 */

// Расширение AppState методами работы с деревом
Object.assign(AppState, {
    /**
     * Генерирует иерархическую нумерацию для всех узлов дерева.
     * Обрабатывает разные типы узлов: обычные пункты (1.1, 1.2.3), таблицы,
     * текстовые блоки и нарушения. Поддерживает пользовательские метки.
     * @param {Object} node - Узел для обработки (по умолчанию корень)
     * @param {string} prefix - Префикс нумерации для текущего уровня
     */
    generateNumbering(node = this.treeData, prefix = '') {
        if (!node.children) return;

        node.children.forEach((child, index) => {
            // Нумерация таблиц в рамках родительского узла
            if (child.type === 'table') {
                const parentTables = node.children.filter(c => c.type === 'table');
                const tableIndex = parentTables.indexOf(child) + 1;
                child.number = `Таблица ${tableIndex}`;
                // Используем пользовательскую метку, если она задана
                if (!child.customLabel) {
                    child.label = child.number;
                } else {
                    child.label = child.customLabel;
                }
                return;
            }

            // Нумерация текстовых блоков в рамках родительского узла
            if (child.type === 'textblock') {
                const parentTextBlocks = node.children.filter(c => c.type === 'textblock');
                const textBlockIndex = parentTextBlocks.indexOf(child) + 1;
                child.number = `Текстовый блок ${textBlockIndex}`;
                if (!child.customLabel) {
                    child.label = child.number;
                } else {
                    child.label = child.customLabel;
                }
                return;
            }

            // Нумерация нарушений в рамках родительского узла
            if (child.type === 'violation') {
                const parentViolations = node.children.filter(c => c.type === 'violation');
                const violationIndex = parentViolations.indexOf(child) + 1;
                child.number = `Нарушение ${violationIndex}`;
                if (!child.customLabel) {
                    child.label = child.number;
                } else {
                    child.label = child.customLabel;
                }
                return;
            }

            // Нумерация обычных пунктов с иерархической структурой (1, 1.1, 1.1.1)
            const itemChildren = node.children.filter(c => !c.type || c.type === 'item');
            const itemIndex = itemChildren.indexOf(child);
            if (itemIndex === -1) return;

            // Формируем номер: для корневого уровня "1", для вложенных "1.1"
            const number = prefix ? `${prefix}.${itemIndex + 1}` : `${itemIndex + 1}`;
            // Извлекаем базовую метку без старой нумерации
            const baseLabelMatch = child.label.match(/^[\d.]+\s*(.*)$/);
            const baseLabel = baseLabelMatch ? baseLabelMatch[1] : child.label;

            child.number = number;
            child.label = `${number}. ${baseLabel}`;

            // НОВАЯ ЛОГИКА: обновляем названия таблиц метрик для дочерних элементов пункта 5
            if (node.id === '5' && number.startsWith('5.')) {
                this.updateMetricsTableLabel(child.id);
            }

            // Рекурсивно обрабатываем дочерние узлы
            if (child.children && child.children.length > 0) {
                this.generateNumbering(child, number);
            }
        });
    },

    /**
     * Обновляет название таблицы метрик после изменения номера узла.
     * @param {string} nodeId - ID узла, для которого нужно обновить таблицу
     */
    updateMetricsTableLabel(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node || !node.children) return;

        // Ищем таблицу метрик среди дочерних элементов
        const metricsTableNode = node.children.find(child =>
            child.type === 'table' && child.isMetricsTable === true
        );

        if (metricsTableNode && node.number) {
            // Обновляем название таблицы
            const newLabel = `Объем выявленных отклонений (В метриках) по ${node.number}`;
            metricsTableNode.label = newLabel;
            metricsTableNode.customLabel = newLabel;
        }
    },

    /**
     * Добавляет новый узел в дерево как дочерний или соседний элемент.
     * Выполняет валидацию ограничений вложенности и обновляет нумерацию.
     * @param {string} parentId - ID родительского узла (для дочернего) или узла-соседа
     * @param {string} label - Метка нового узла
     * @param {boolean} isChild - true для дочернего узла, false для соседнего
     * @returns {Object} Результат операции с success и причиной отказа
     */
    addNode(parentId, label, isChild = true) {
        const parent = this.findNodeById(parentId);
        if (!parent) return {success: false, reason: 'Родительский узел не найден'};

        // Проверка ограничений перед добавлением
        if (isChild) {
            const canAdd = this.canAddChild(parentId);
            if (!canAdd.allowed) {
                return {success: false, reason: canAdd.reason};
            }
        } else {
            const canAdd = this.canAddSibling(parentId);
            if (!canAdd.allowed) {
                return {success: false, reason: canAdd.reason};
            }
        }

        // Создаем новый узел с уникальным ID на основе timestamp
        const newId = Date.now().toString();
        const newNode = {
            id: newId,
            label: label || 'Новый пункт',
            children: [],
            content: '',
            type: 'item'
        };

        // Вставка в дерево
        if (isChild) {
            if (!parent.children) parent.children = [];
            parent.children.push(newNode);
        } else {
            const grandParent = this.findParentNode(parentId);
            if (grandParent && grandParent.children) {
                const index = grandParent.children.findIndex(n => n.id === parentId);
                grandParent.children.splice(index + 1, 0, newNode);
            }
        }

        this.generateNumbering();

        // НОВАЯ ЛОГИКА: автоматическое создание таблицы метрик
        // Проверяем, является ли новый узел дочерним элементом пункта 5 на первом уровне вложенности
        const parentNode = isChild ? parent : this.findParentNode(parentId);
        if (parentNode && parentNode.id === '5') {
            // Это дочерний элемент пункта 5
            // Ищем номер созданного узла
            const nodeNumber = newNode.number;
            if (nodeNumber && nodeNumber.startsWith('5.')) {
                // Создаем таблицу метрик
                const result = this._createMetricsTable(newNode.id, nodeNumber);
                if (result.success) {
                    this.generateNumbering(); // Перенумеруем после добавления таблицы
                }
            }
        }

        return {success: true, node: newNode};
    },

    /**
     * Удаляет узел из дерева и все связанные данные (таблицы, текстовые блоки, нарушения).
     * Рекурсивно очищает дочерние элементы и обновляет нумерацию.
     * @param {string} nodeId - ID удаляемого узла
     * @returns {boolean} true при успешном удалении
     */
    deleteNode(nodeId) {
        const parent = this.findParentNode(nodeId);
        if (parent && parent.children) {
            const node = this.findNodeById(nodeId);

            // Рекурсивная очистка данных для обычных пунктов
            if (node && node.type === 'item' && node.children) {
                // Удаляем все таблицы из дочерних элементов
                node.children.filter(c => c.type === 'table').forEach(tableNode => {
                    delete this.tables[tableNode.tableId];
                });
                // Удаляем все текстовые блоки из дочерних элементов
                node.children.filter(c => c.type === 'textblock').forEach(textBlockNode => {
                    delete this.textBlocks[textBlockNode.textBlockId];
                });
                // Удаляем все нарушения из дочерних элементов
                node.children.filter(c => c.type === 'violation').forEach(violationNode => {
                    delete this.violations[violationNode.violationId];
                });
            }

            // Удаление таблицы из хранилища
            if (node && node.type === 'table' && node.tableId) {
                delete this.tables[node.tableId];
            }

            // Удаление текстового блока из хранилища
            if (node && node.type === 'textblock' && node.textBlockId) {
                delete this.textBlocks[node.textBlockId];
            }

            // Удаление нарушения из хранилища
            if (node && node.type === 'violation' && node.violationId) {
                delete this.violations[node.violationId];
            }

            // Удаляем узел из дерева
            parent.children = parent.children.filter(n => n.id !== nodeId);
            this.generateNumbering();
            return true;
        }

        return false;
    },

    /**
     * Перемещает узел в дереве на новую позицию.
     * ИСПРАВЛЕНО: возвращает Promise для корректной обработки диалога
     * @param {string} draggedNodeId - ID перемещаемого узла
     * @param {string} targetNodeId - ID целевого узла
     * @param {string} position - Позиция вставки: 'before', 'after', 'child'
     * @returns {Promise<Object>} Результат операции с флагом success и причиной отказа
     */
    async moveNode(draggedNodeId, targetNodeId, position) {
        if (draggedNodeId === targetNodeId) {
            return {success: false, reason: 'Нельзя переместить узел в самого себя'};
        }

        const draggedNode = this.findNodeById(draggedNodeId);
        const targetNode = this.findNodeById(targetNodeId);
        const draggedParent = this.findParentNode(draggedNodeId);

        if (!draggedNode || !targetNode || !draggedParent) {
            return {success: false, reason: 'Узел не найден'};
        }

        if (draggedNode.protected) {
            return {success: false, reason: 'Нельзя перемещать защищенный элемент'};
        }

        if (this.isDescendant(targetNode, draggedNode)) {
            return {success: false, reason: 'Нельзя переместить узел внутрь своего потомка'};
        }

        // ИСПРАВЛЕНИЕ 3: проверка на таблицу метрик для ЛЮБОГО перемещения
        const hasMetricsTable = draggedNode.children && draggedNode.children.some(
            child => child.type === 'table' && child.isMetricsTable === true
        );

        // Определяем нового родителя после перемещения
        let newParent;
        if (position === 'child') {
            newParent = targetNode;
        } else {
            newParent = this.findParentNode(targetNodeId);
        }

        // Проверяем, останется ли узел дочерним элементом пункта 5 на первом уровне
        const willStayUnder5FirstLevel = newParent && newParent.id === '5';

        // ИСПРАВЛЕНИЕ 3: если есть таблица метрик и перемещение уведет узел из-под пункта 5
        if (hasMetricsTable && !willStayUnder5FirstLevel) {
            const confirmed = await new Promise((resolve) => {
                DialogManager.show({
                    title: 'Удаление таблицы метрик',
                    message: 'При перемещении этого пункта таблица метрик будет удалена. Продолжить?',
                    icon: '⚠️',
                    confirmText: 'Да, переместить',
                    cancelText: 'Отмена',
                    onConfirm: () => resolve(true),
                    onCancel: () => resolve(false)
                });
            });

            if (!confirmed) {
                return {success: false, reason: 'Перемещение отменено пользователем', cancelled: true};
            }

            // Удаляем таблицу метрик
            const metricsTableNode = draggedNode.children.find(
                child => child.type === 'table' && child.isMetricsTable === true
            );
            if (metricsTableNode) {
                delete this.tables[metricsTableNode.tableId];
                draggedNode.children = draggedNode.children.filter(
                    child => child.id !== metricsTableNode.id
                );
            }
        }

        // Проверка глубины вложенности только для обычных пунктов
        const isDraggedInformational = draggedNode.type === 'table' ||
            draggedNode.type === 'textblock' ||
            draggedNode.type === 'violation';

        if (!isDraggedInformational) {
            let targetDepth;

            if (position === 'child') {
                targetDepth = this.getNodeDepth(targetNodeId);
            } else {
                const targetParent = this.findParentNode(targetNodeId);
                if (targetParent) {
                    targetDepth = this.getNodeDepth(targetParent.id);
                } else {
                    targetDepth = 0;
                }
            }

            const draggedSubtreeDepth = this.getSubtreeDepth(draggedNode);
            const resultingDepth = targetDepth + 1 + draggedSubtreeDepth;

            if (resultingDepth > 4) {
                return {
                    success: false,
                    reason: `Перемещение приведет к превышению максимальной вложенности (${resultingDepth} > 4 уровней)`
                };
            }
        }

        // Проверка для первого уровня
        const targetParent = this.findParentNode(targetNodeId);

        if (position !== 'child' && targetParent && targetParent.id === 'root') {
            if (draggedParent.id === 'root') {
                // Можно перемещать в пределах первого уровня
            } else {
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
                if (targetNum) {
                    const targetNumber = parseInt(targetNum[1]);
                    if (position === 'before' && targetNumber !== 6) {
                        return {
                            success: false,
                            reason: 'Новый пункт первого уровня можно добавить только в конец списка (после пункта 5)'
                        };
                    }
                    if (position === 'after' && targetNumber !== 5) {
                        return {
                            success: false,
                            reason: 'Новый пункт первого уровня можно добавить только в конец списка (после пункта 5)'
                        };
                    }
                }
            }
        }

        // Удаляем узел из старого родителя
        draggedParent.children = draggedParent.children.filter(n => n.id !== draggedNodeId);

        // Вставляем узел на новое место
        let insertIndex;

        if (position === 'child') {
            if (!newParent.children) newParent.children = [];
            newParent.children.push(draggedNode);
        } else if (position === 'before') {
            insertIndex = newParent.children.findIndex(n => n.id === targetNodeId);
            newParent.children.splice(insertIndex, 0, draggedNode);
        } else if (position === 'after') {
            insertIndex = newParent.children.findIndex(n => n.id === targetNodeId);
            newParent.children.splice(insertIndex + 1, 0, draggedNode);
        }

        if (draggedNode.parentId) {
            draggedNode.parentId = newParent.id;
        }

        this.generateNumbering();

        // НОВАЯ ЛОГИКА: создаем таблицу метрик если узел попал под пункт 5 на первый уровень
        if (newParent.id === '5' && draggedNode.number && draggedNode.number.startsWith('5.')) {
            // Проверяем, нет ли уже таблицы метрик
            const hasTable = draggedNode.children && draggedNode.children.some(
                child => child.type === 'table' && child.isMetricsTable === true
            );

            if (!hasTable) {
                const result = this._createMetricsTable(draggedNode.id, draggedNode.number);
                if (result.success) {
                    this.generateNumbering();
                }
            } else {
                // Если таблица уже есть, просто обновляем её название
                this.updateMetricsTableLabel(draggedNode.id);
            }
        }

        return {success: true, node: draggedNode};
    },

    /**
     * Проверяет, является ли узел дочерним элементом пункта 5 на первом уровне вложенности.
     * @param {string} nodeId - ID проверяемого узла
     * @returns {boolean} true, если узел является дочерним элементом пункта 5 первого уровня
     */
    isDirectChildOf5(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return false;

        const parent = this.findParentNode(nodeId);
        if (!parent || parent.id !== '5') return false;

        // Проверяем, что узел находится на первом уровне вложенности (его номер начинается с "5.")
        return node.number && node.number.match(/^5\.\d+$/);
    }
});
