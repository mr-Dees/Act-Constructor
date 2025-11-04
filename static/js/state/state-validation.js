/**
 * Модуль валидации операций с деревом документа.
 * Проверяет ограничения вложенности, лимиты элементов и правила добавления узлов.
 */

// Расширение AppState методами валидации
Object.assign(AppState, {
    /**
     * Вычисляет глубину узла в дереве (расстояние от корня).
     * @param {string} nodeId - ID искомого узла
     * @param {Object} node - Узел для начала поиска (по умолчанию корень)
     * @param {number} depth - Текущая глубина
     * @returns {number} Глубина узла или -1 если не найден
     */
    getNodeDepth(nodeId, node = this.treeData, depth = 0) {
        if (node.id === nodeId) return depth;
        if (node.children) {
            for (let child of node.children) {
                const found = this.getNodeDepth(nodeId, child, depth + 1);
                if (found !== -1) return found;
            }
        }
        return -1;
    },

    /**
     * Проверяет возможность добавления дочернего узла с учетом ограничения вложенности.
     * Максимальная глубина: 4 уровня (*.*.*.*)
     * @param {string} parentId - ID родительского узла
     * @returns {Object} Объект с флагом allowed и причиной отказа
     */
    canAddChild(parentId) {
        const depth = this.getNodeDepth(parentId);
        if (depth >= 4) {
            return {allowed: false, reason: 'Достигнута максимальная вложенность (4 уровня: *.*.*.*)'};
        }
        return {allowed: true};
    },

    /**
     * Проверяет возможность добавления соседнего узла (sibling).
     * Для первого уровня разрешен только один дополнительный пункт (6-й) в конце списка.
     * @param {string} nodeId - ID узла, после которого добавляется новый
     * @returns {Object} Объект с флагом allowed и причиной отказа
     */
    canAddSibling(nodeId) {
        const parent = this.findParentNode(nodeId);

        // Специальная логика для первого уровня (дети root)
        if (parent && parent.id === 'root') {
            // Проверяем наличие пользовательского пункта 6
            const hasCustomFirstLevel = parent.children.some(child => {
                const num = child.label.match(/^(\d+)\./);
                return num && parseInt(num[1]) === 6;
            });

            if (hasCustomFirstLevel) {
                return {
                    allowed: false,
                    reason: 'Можно добавить только один дополнительный пункт первого уровня (пункт 6)'
                };
            }

            // Новый пункт можно добавить только в конец
            const nodeIndex = parent.children.findIndex(n => n.id === nodeId);
            if (nodeIndex !== parent.children.length - 1) {
                return {allowed: false, reason: 'Новый пункт первого уровня можно добавить только в конец списка'};
            }

            return {allowed: true};
        }

        return {allowed: true};
    },

    /**
     * Вычисляет максимальную глубину поддерева от узла (учитываются только пункты, не информационные элементы)
     * @param {Object} node - Узел для проверки
     * @returns {number} Максимальная глубина поддерева
     */
    getSubtreeDepth(node) {
        if (!node.children || node.children.length === 0) {
            return 0;
        }

        let maxDepth = 0;
        for (const child of node.children) {
            // Игнорируем информационные элементы при подсчете глубины
            if (child.type === 'table' || child.type === 'textblock' || child.type === 'violation') {
                continue;
            }

            const childDepth = this.getSubtreeDepth(child);
            maxDepth = Math.max(maxDepth, childDepth + 1);
        }

        return maxDepth;
    },

    /**
     * Проверяет, является ли node потомком possibleAncestor.
     * @param {Object} node - Проверяемый узел
     * @param {Object} possibleAncestor - Возможный предок
     * @returns {boolean} true, если node является потомком possibleAncestor
     */
    isDescendant(node, possibleAncestor) {
        if (!possibleAncestor.children || possibleAncestor.children.length === 0) {
            return false;
        }

        for (const child of possibleAncestor.children) {
            if (child.id === node.id) {
                return true;
            }
            if (this.isDescendant(node, child)) {
                return true;
            }
        }

        return false;
    }
});
