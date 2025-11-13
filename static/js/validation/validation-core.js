/**
 * Структурные валидации и ограничения дерева
 *
 * Проверяет глубину, возможность добавления дочерних/соседних узлов,
 * отношения "родитель-потомок". НЕ содержит бизнес-логики.
 */
const ValidationCore = {
    /**
     * Вычисляет глубину узла в дереве
     * @param {string} nodeId - ID искомого узла
     * @param {Object} [node=AppState.treeData] - Узел для начала поиска
     * @param {number} [depth=0] - Текущая глубина
     * @returns {number} Глубина узла или -1 если не найден
     */
    getNodeDepth(nodeId, node = AppState.treeData, depth = 0) {
        if (node.id === nodeId) return depth;

        if (!node.children) return -1;

        for (const child of node.children) {
            const found = this.getNodeDepth(nodeId, child, depth + 1);
            if (found !== -1) return found;
        }

        return -1;
    },

    /**
     * Проверяет возможность добавления дочернего узла
     * @param {string} parentId - ID родительского узла
     * @returns {Object} Результат с флагом allowed и причиной отказа
     */
    canAddChild(parentId) {
        const depth = this.getNodeDepth(parentId);
        const maxDepth = AppConfig.tree.maxDepth;

        if (depth >= maxDepth) {
            return {
                allowed: false,
                reason: AppConfig.tree.validation.maxDepthExceeded(maxDepth)
            };
        }

        return {allowed: true};
    },

    /**
     * Проверяет возможность добавления соседнего узла
     * @param {string} nodeId - ID узла для добавления рядом
     * @returns {Object} Результат с флагом allowed и причиной отказа
     */
    canAddSibling(nodeId) {
        const parent = AppState.findParentNode(nodeId);

        if (parent?.id === 'root') {
            return this._validateFirstLevelSiblingAddition(parent, nodeId);
        }

        return {allowed: true};
    },

    /**
     * Валидирует добавление sibling на первом уровне
     * @private
     * @param {Object} parent - Родительский узел (root)
     * @param {string} nodeId - ID узла-соседа
     * @returns {Object} Результат валидации
     */
    _validateFirstLevelSiblingAddition(parent, nodeId) {
        const hasCustomFirstLevel = parent.children.some(child => {
            const num = child.label.match(/^(\d+)\./);
            return num && parseInt(num) === 6;
        });

        if (hasCustomFirstLevel) {
            return {
                allowed: false,
                reason: AppConfig.tree.validation.maxCustomSections(
                    AppConfig.tree.maxCustomFirstLevelSections
                )
            };
        }

        const nodeIndex = parent.children.findIndex(n => n.id === nodeId);
        if (nodeIndex !== parent.children.length - 1) {
            return {
                allowed: false,
                reason: AppConfig.tree.validation.firstLevelOnlyAtEnd
            };
        }

        return {allowed: true};
    },

    /**
     * Вычисляет максимальную глубину поддерева
     * @param {Object} node - Корневой узел поддерева
     * @returns {number} Максимальная глубина
     */
    getSubtreeDepth(node) {
        if (!node.children?.length) return 0;

        let maxDepth = 0;

        for (const child of node.children) {
            if (this._isInformationalNode(child)) continue;

            const childDepth = this.getSubtreeDepth(child);
            maxDepth = Math.max(maxDepth, childDepth + 1);
        }

        return maxDepth;
    },

    /**
     * Проверяет, является ли узел информационным элементом
     * @private
     * @param {Object} node - Проверяемый узел
     * @returns {boolean} true если это информационный элемент
     */
    _isInformationalNode(node) {
        return ['table', 'textblock', 'violation'].includes(node.type);
    },

    /**
     * Проверяет, является ли узел потомком другого узла
     * @param {Object} node - Проверяемый узел
     * @param {Object} possibleAncestor - Возможный предок
     * @returns {boolean} true если node является потомком possibleAncestor
     */
    isDescendant(node, possibleAncestor) {
        if (!possibleAncestor.children?.length) return false;

        for (const child of possibleAncestor.children) {
            if (child.id === node.id) return true;
            if (this.isDescendant(node, child)) return true;
        }

        return false;
    }
};