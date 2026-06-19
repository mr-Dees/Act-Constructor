/**
 * Валидация структуры дерева документа
 *
 * Проверяет глубину вложенности, возможность добавления узлов,
 * лимиты контента и отношения родитель-потомок.
 * НЕ содержит бизнес-логики акта.
 */
import { AppState } from '../state/state-core.js';
import { TreeUtils } from '../tree/tree-utils.js';
import { ValidationCore } from './validation-core.js';
import { AppConfig } from '../../shared/app-config.js';
import { getBlockType } from '../block-types.js';

export const ValidationTree = {
    /**
     * Проверяет возможность добавления дочернего узла
     * @param {string} parentId - ID родительского узла
     * @returns {Object} Результат с полями valid, message, isWarning
     */
    canAddChild(parentId) {
        const depth = TreeUtils.getNodeDepth(parentId);

        // Неизвестный родитель: getNodeDepth даёт -1, что без guard'а
        // проходило проверку maxDepth и давало ложный success
        if (depth === -1) {
            return ValidationCore.failure(AppConfig.tree.validation.parentNotFound);
        }

        const maxDepth = AppConfig.tree.maxDepth;

        if (depth >= maxDepth) {
            return ValidationCore.failure(
                AppConfig.tree.validation.maxDepthExceeded(maxDepth)
            );
        }

        return ValidationCore.success();
    },

    /**
     * Проверяет возможность добавления соседнего узла.
     * Узлы 0 уровня обрабатываются в меню (пункт Process Mining), здесь без
     * спец-логики.
     * @param {string} nodeId
     * @returns {Object}
     */
    canAddSibling(nodeId) {
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

        // Проверка глубины (как в canAddChild). Контент-узлы (таблица/текстблок/
        // нарушение) не создают нового уровня иерархии, поэтому порог — глубина
        // самого узла > maxDepth (без +1). Узел вне дерева (depth -1) — отказ.
        const depth = TreeUtils.getNodeDepth(node.id);
        const maxDepth = AppConfig.tree.maxDepth;
        if (depth === -1) {
            return ValidationCore.failure(AppConfig.tree.validation.nodeNotFound);
        }
        if (depth > maxDepth) {
            return ValidationCore.failure(
                AppConfig.tree.validation.maxDepthExceeded(maxDepth)
            );
        }

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
        if (!node.children) {
            return ValidationCore.success();
        }

        // Лимит per-type — из реестра типов блоков (block-types.js).
        const spec = getBlockType(contentType);
        const existingCount = TreeUtils.countChildrenByType(node, contentType);
        const limit = spec ? spec.limitPerNode : undefined;
        const limitName = AppConfig.content.limitNames[contentType];

        return ValidationCore.validateLimit(existingCount, limit, limitName);
    }
};

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.ValidationTree = ValidationTree;
