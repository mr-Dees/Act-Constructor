/**
 * Утилиты для работы с деревом документа
 *
 * Централизованные функции поиска, обхода и манипуляции узлами дерева.
 * Используется всеми модулями для избежания дублирования логики.
 */
const TreeUtils = {
    /**
     * Находит узел по ID
     * @param {string} nodeId - ID искомого узла
     * @param {Object} [root=AppState.treeData] - Корневой узел для поиска
     * @returns {Object|null} Найденный узел или null
     */
    findNodeById(nodeId, root = AppState.treeData) {
        if (!root || !nodeId) return null;
        if (root.id === nodeId) return root;

        if (root.children?.length) {
            for (const child of root.children) {
                const found = this.findNodeById(nodeId, child);
                if (found) return found;
            }
        }

        return null;
    },

    /**
     * Находит узел по ID связанной таблицы
     * @param {string} tableId - ID таблицы
     * @param {Object} [root=AppState.treeData] - Корневой узел для поиска
     * @returns {Object|null} Найденный узел или null
     */
    findNodeByTableId(tableId, root = AppState.treeData) {
        return this.findNodeByPredicate(
            node => node.tableId === tableId,
            root
        );
    },

    /**
     * Находит узел по ID связанного текстового блока
     * @param {string} textBlockId - ID текстового блока
     * @param {Object} [root=AppState.treeData] - Корневой узел для поиска
     * @returns {Object|null} Найденный узел или null
     */
    findNodeByTextBlockId(textBlockId, root = AppState.treeData) {
        return this.findNodeByPredicate(
            node => node.textBlockId === textBlockId,
            root
        );
    },

    /**
     * Находит узел по ID связанного нарушения
     * @param {string} violationId - ID нарушения
     * @param {Object} [root=AppState.treeData] - Корневой узел для поиска
     * @returns {Object|null} Найденный узел или null
     */
    findNodeByViolationId(violationId, root = AppState.treeData) {
        return this.findNodeByPredicate(
            node => node.violationId === violationId,
            root
        );
    },

    /**
     * Находит узел по пользовательскому предикату
     * @param {Function} predicate - Функция проверки (node) => boolean
     * @param {Object} [root=AppState.treeData] - Корневой узел для поиска
     * @returns {Object|null} Найденный узел или null
     */
    findNodeByPredicate(predicate, root = AppState.treeData) {
        if (!root || !predicate) return null;
        if (predicate(root)) return root;

        if (root.children?.length) {
            for (const child of root.children) {
                const found = this.findNodeByPredicate(predicate, child);
                if (found) return found;
            }
        }

        return null;
    },

    /**
     * Находит родительский узел
     * @param {string} nodeId - ID дочернего узла
     * @param {Object} [root=AppState.treeData] - Корневой узел для поиска
     * @returns {Object|null} Родительский узел или null
     */
    findParentNode(nodeId, root = AppState.treeData) {
        if (!root?.children) return null;

        for (const child of root.children) {
            if (child.id === nodeId) return root;

            const found = this.findParentNode(nodeId, child);
            if (found) return found;
        }

        return null;
    },

    /**
     * Получает путь от корня до узла
     * @param {string} nodeId - ID узла
     * @param {Object} [root=AppState.treeData] - Корневой узел
     * @returns {Array<Object>} Массив узлов от корня до искомого (включительно)
     */
    getNodePath(nodeId, root = AppState.treeData) {
        const path = [];
        this._buildPath(nodeId, root, path);
        return path;
    },

    /**
     * Вспомогательная функция для построения пути
     * @private
     * @param {string} nodeId - ID искомого узла
     * @param {Object} node - Текущий узел
     * @param {Array<Object>} path - Накопленный путь
     * @returns {boolean} true если узел найден
     */
    _buildPath(nodeId, node, path) {
        if (!node) return false;

        path.push(node);

        if (node.id === nodeId) return true;

        if (node.children?.length) {
            for (const child of node.children) {
                if (this._buildPath(nodeId, child, path)) {
                    return true;
                }
            }
        }

        path.pop();
        return false;
    },

    /**
     * Получает все узлы дерева в виде плоского массива
     * @param {Object} [root=AppState.treeData] - Корневой узел
     * @param {boolean} [includeRoot=false] - Включать ли корневой узел
     * @returns {Array<Object>} Массив всех узлов
     */
    getAllNodes(root = AppState.treeData, includeRoot = false) {
        const nodes = [];

        if (includeRoot) {
            nodes.push(root);
        }

        this._collectNodes(root, nodes);
        return nodes;
    },

    /**
     * Рекурсивно собирает узлы
     * @private
     * @param {Object} node - Текущий узел
     * @param {Array<Object>} collector - Массив-накопитель
     */
    _collectNodes(node, collector) {
        if (!node?.children) return;

        for (const child of node.children) {
            collector.push(child);
            this._collectNodes(child, collector);
        }
    },

    /**
     * Получает глубину узла в дереве
     * @param {string} nodeId - ID узла
     * @param {Object} [root=AppState.treeData] - Корневой узел
     * @param {number} [currentDepth=0] - Текущая глубина (для рекурсии)
     * @returns {number} Глубина узла или -1 если не найден
     */
    getNodeDepth(nodeId, root = AppState.treeData, currentDepth = 0) {
        if (!root) return -1;
        if (root.id === nodeId) return currentDepth;

        if (root.children?.length) {
            for (const child of root.children) {
                const depth = this.getNodeDepth(nodeId, child, currentDepth + 1);
                if (depth !== -1) return depth;
            }
        }

        return -1;
    },

    /**
     * Получает максимальную глубину поддерева
     * @param {Object} node - Корневой узел поддерева
     * @returns {number} Максимальная глубина
     */
    getSubtreeDepth(node) {
        if (!node?.children?.length) return 0;

        let maxDepth = 0;

        for (const child of node.children) {
            // Пропускаем информационные узлы
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
        const {TABLE, TEXTBLOCK, VIOLATION} = AppConfig.nodeTypes;
        return [TABLE, TEXTBLOCK, VIOLATION].includes(node.type);
    },

    /**
     * Проверяет, является ли первый узел потомком второго
     * @param {Object} node - Проверяемый узел
     * @param {Object} possibleAncestor - Возможный предок
     * @returns {boolean} true если node является потомком possibleAncestor
     */
    isDescendant(node, possibleAncestor) {
        if (!possibleAncestor?.children?.length) return false;

        for (const child of possibleAncestor.children) {
            if (child.id === node.id) return true;
            if (this.isDescendant(node, child)) return true;
        }

        return false;
    },

    /**
     * Фильтрует узлы по типу
     * @param {string} type - Тип узлов для фильтрации
     * @param {Object} [root=AppState.treeData] - Корневой узел
     * @returns {Array<Object>} Массив узлов указанного типа
     */
    filterByType(type, root = AppState.treeData) {
        return this.getAllNodes(root).filter(node => node.type === type);
    },

    /**
     * Получает количество дочерних узлов указанного типа
     * @param {Object} node - Родительский узел
     * @param {string} type - Тип дочерних узлов
     * @returns {number} Количество дочерних узлов
     */
    countChildrenByType(node, type) {
        if (!node?.children) return 0;
        return node.children.filter(child => child.type === type).length;
    },

    /**
     * Получает название узла с учетом связанных элементов
     * @param {string} nodeId - ID узла
     * @returns {string} Название узла
     */
    getNodeDisplayName(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return `Узел ${nodeId}`;

        const {TABLE, TEXTBLOCK, VIOLATION} = AppConfig.nodeTypes;
        const isContentType = [TABLE, TEXTBLOCK, VIOLATION].includes(node.type);

        if (isContentType) {
            // Для content-типов: customLabel или number или label
            return node.customLabel || node.number || node.label || `Узел ${nodeId}`;
        }

        // Для item-узлов: number + label
        if (node.number && node.label) {
            return node.number + '. ' + node.label;
        }

        return node.label || `Узел ${nodeId}`;
    }
};
