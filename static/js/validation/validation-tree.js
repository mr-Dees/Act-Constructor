/**
 * Валидация структуры дерева документа
 *
 * Проверяет глубину вложенности, возможность добавления узлов,
 * лимиты контента и отношения родитель-потомок.
 * НЕ содержит бизнес-логики акта.
 */
const ValidationTree = {
    /**
     * Проверяет возможность добавления дочернего узла
     * @param {string} parentId - ID родительского узла
     * @returns {Object} Результат с полями valid, message, isWarning
     */
    canAddChild(parentId) {
        const depth = TreeUtils.getNodeDepth(parentId);
        const maxDepth = AppConfig.tree.maxDepth;

        if (depth >= maxDepth) {
            return ValidationCore.failure(
                AppConfig.tree.validation.maxDepthExceeded(maxDepth)
            );
        }

        return ValidationCore.success();
    },

    /**
     * Проверяет возможность добавления соседнего узла
     * @param {string} nodeId - ID узла для добавления рядом
     * @returns {Object} Результат с полями valid, message, isWarning
     */
    canAddSibling(nodeId) {
        const parent = TreeUtils.findParentNode(nodeId);

        if (parent?.id === 'root') {
            return this._validateFirstLevelSiblingAddition(parent, nodeId);
        }

        return ValidationCore.success();
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
            return num && parseInt(num[1]) === 6;
        });

        if (hasCustomFirstLevel) {
            return ValidationCore.failure(
                AppConfig.tree.validation.maxCustomSections(
                    AppConfig.tree.maxCustomFirstLevelSections
                )
            );
        }

        const nodeIndex = parent.children.findIndex(n => n.id === nodeId);
        if (nodeIndex !== parent.children.length - 1) {
            return ValidationCore.failure(
                AppConfig.tree.validation.firstLevelOnlyAtEnd
            );
        }

        return ValidationCore.success();
    },

    /**
     * Проверяет возможность добавления контента к узлу дерева
     * @param {Object} node - Проверяемый узел
     * @param {string} contentType - Тип контента из AppConfig.nodeTypes
     * @returns {Object} Результат валидации
     */
    canAddContent(node, contentType) {
        // Проверка существования узла
        const existsCheck = ValidationCore.validateNodeExists(node);
        if (!existsCheck.valid) return existsCheck;

        // Проверка типа узла
        const typeCheck = this._validateNodeType(node, contentType);
        if (!typeCheck.valid) return typeCheck;

        // Проверка лимитов
        const limitCheck = this._validateContentLimits(node, contentType);
        if (!limitCheck.valid) return limitCheck;

        return ValidationCore.success();
    },

    /**
     * Проверяет совместимость типа узла с добавляемым контентом
     * @private
     * @param {Object} node - Проверяемый узел
     * @param {string} contentType - Тип контента из AppConfig.nodeTypes
     * @returns {Object} Результат проверки
     */
    _validateNodeType(node, contentType) {
        const {TABLE, TEXTBLOCK, VIOLATION} = AppConfig.nodeTypes;
        const errors = AppConfig.content.errors;
        const typeName = AppConfig.content.typeNames[contentType];

        // Нельзя добавлять контент к информационным элементам
        if (node.type === TABLE) {
            return ValidationCore.failure(
                errors.cannotAddToTable(typeName)
            );
        }

        if (node.type === TEXTBLOCK) {
            return ValidationCore.failure(
                errors.cannotAddToTextBlock(typeName)
            );
        }

        if (node.type === VIOLATION) {
            return ValidationCore.failure(
                errors.cannotAddToViolation(typeName)
            );
        }

        return ValidationCore.success();
    },

    /**
     * Проверяет лимиты количества элементов контента в узле
     * @private
     * @param {Object} node - Проверяемый узел
     * @param {string} contentType - Тип контента из AppConfig.nodeTypes
     * @returns {Object} Результат проверки
     */
    _validateContentLimits(node, contentType) {
        const {TABLE, TEXTBLOCK, VIOLATION} = AppConfig.nodeTypes;
        const limits = AppConfig.content.limits;

        // Маппинг типов на лимиты
        const limitMap = {
            [TABLE]: limits.tablesPerNode,
            [TEXTBLOCK]: limits.textBlocksPerNode,
            [VIOLATION]: limits.violationsPerNode
        };

        if (!node.children) {
            return ValidationCore.success();
        }

        const existingCount = TreeUtils.countChildrenByType(node, contentType);
        const limit = limitMap[contentType];
        const limitName = AppConfig.content.limitNames[contentType];

        return ValidationCore.validateLimit(existingCount, limit, limitName);
    }
};
