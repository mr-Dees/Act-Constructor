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

            // Рекурсивно обрабатываем дочерние узлы
            if (child.children && child.children.length > 0) {
                this.generateNumbering(child, number);
            }
        });
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
     * @param {string} draggedNodeId - ID перемещаемого узла
     * @param {string} targetNodeId - ID целевого узла
     * @param {string} position - Позиция вставки: 'before', 'after', 'child'
     * @returns {Object} Результат операции с флагом success и причиной отказа
     */
    moveNode(draggedNodeId, targetNodeId, position) {
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

        // Проверка глубины вложенности только для обычных пунктов
        const isDraggedInformational = draggedNode.type === 'table' ||
            draggedNode.type === 'textblock' ||
            draggedNode.type === 'violation';

        if (!isDraggedInformational) {
            let targetDepth;

            if (position === 'child') {
                // При вставке как child - глубина целевого узла + 1
                targetDepth = this.getNodeDepth(targetNodeId);
            } else {
                // При вставке before/after - глубина родителя целевого узла
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

        // Если перемещаем НА первый уровень (targetParent === root)
        if (position !== 'child' && targetParent && targetParent.id === 'root') {
            // Если элемент уже на первом уровне, разрешаем перемещение
            if (draggedParent.id === 'root') {
                // Можно перемещать в пределах первого уровня
            } else {
                // Перемещаем с другого уровня на первый
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

                // Разрешаем вставку только после пункта 5 (в конец)
                const targetNum = targetNode.label.match(/^(\d+)\./);
                if (targetNum) {
                    const targetNumber = parseInt(targetNum[1]);
                    // Для before: можем вставить только перед пунктом 6 (если он есть)
                    if (position === 'before' && targetNumber !== 6) {
                        return {
                            success: false,
                            reason: 'Новый пункт первого уровня можно добавить только в конец списка (после пункта 5)'
                        };
                    }
                    // Для after: можем вставить только после пункта 5
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
        let newParent;
        let insertIndex;

        if (position === 'child') {
            newParent = targetNode;
            if (!newParent.children) newParent.children = [];
            newParent.children.push(draggedNode);
        } else if (position === 'before') {
            newParent = targetParent;
            insertIndex = newParent.children.findIndex(n => n.id === targetNodeId);
            newParent.children.splice(insertIndex, 0, draggedNode);
        } else if (position === 'after') {
            newParent = targetParent;
            insertIndex = newParent.children.findIndex(n => n.id === targetNodeId);
            newParent.children.splice(insertIndex + 1, 0, draggedNode);
        }

        if (draggedNode.parentId) {
            draggedNode.parentId = newParent.id;
        }

        this.generateNumbering();

        return {success: true, node: draggedNode};
    }
});
