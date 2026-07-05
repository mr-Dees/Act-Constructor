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
import { getStructureLimits } from '../violation/violation-image-validator.js';

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
     * На 0 уровне (родитель — root) штатно добавляется только пункт Process
     * Mining (через AppState.addProcessMiningSection из меню). Прямое добавление
     * обычного соседа на верхний уровень запрещено и здесь, на уровне состояния.
     * @param {string} nodeId
     * @returns {Object}
     */
    canAddSibling(nodeId) {
        const parent = AppState.findParentNode(nodeId);
        if (parent?.id === 'root') {
            return ValidationCore.failure(AppConfig.tree.validation.cannotAddFirstLevelSibling);
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
        let limit = spec ? spec.limitPerNode : undefined;
        // B-13: лимит текстблоков — из рантайм-настроек (/acts/limits, синхронно
        // с серверной валидацией), фолбэк — захардкоженный реестр block-types.
        if (spec && spec.dictName === 'textBlocks') {
            const runtime = getStructureLimits().textBlocksPerNode;
            if (typeof runtime === 'number') limit = runtime;
        }
        const limitName = AppConfig.content.limitNames[contentType];

        return ValidationCore.validateLimit(existingCount, limit, limitName);
    },

    /**
     * Проверяет лимит текстблоков-на-узел при вставке ГОТОВОГО поддерева
     * (PERSIST-2: undo восстановления удалённого блока, paste, drag-and-drop
     * перемещение). insertNodeAt/_performMove — мутаторы для таких вставок —
     * в отличие от addTextBlockToNode не зовут canAddContent, поэтому без этой
     * проверки узел мог получить N+1 текстблоков, и сервер отклонял бы уже
     * сохранение всего акта.
     *
     * Проверяются две вещи:
     *  - целевой родитель: если сам корень поддерева — textblock, его +1 не
     *    должен превысить лимит родителя (тот же лимит, что у «Добавить
     *    текстовый блок»). Сам node ИСКЛЮЧАЕТСЯ из подсчёта родителя по id:
     *    для paste/undo node ещё не среди children родителя (id не совпадёт —
     *    no-op), а для drag reorder ВНУТРИ одного родителя node уже физически
     *    в его children (drag ещё не вырезал узел оттуда) — без исключения
     *    он засчитался бы дважды и лимит отказывал бы обычному reorder;
     *  - самосогласованность поддерева: число текстблоков-детей на каждом его
     *    узле не должно превышать ТЕКУЩИЙ лимит — поддерево скопировано/удалено
     *    раньше и могло стать невалидным, если лимит с тех пор снизился
     *    (буфер обмена в localStorage переживает перезагрузку страницы).
     *
     * @param {string} parentId - ID узла, в children которого встанет node
     * @param {Object} node - Вставляемый/перемещаемый узел (возможно, с поддеревом)
     * @returns {Object} Результат с полями valid, message
     */
    canInsertTextBlockSubtree(parentId, node) {
        const limit = getStructureLimits().textBlocksPerNode;
        if (typeof limit !== 'number') return ValidationCore.success();

        const limitName = AppConfig.content.limitNames[AppConfig.nodeTypes.TEXTBLOCK];
        const fail = () => ValidationCore.failure(AppConfig.content.errors.limitReached(limitName, limit));

        const parent = AppState.findNodeById(parentId);
        if (parent && node.type === AppConfig.nodeTypes.TEXTBLOCK) {
            const existingCount = (parent.children || []).filter(
                c => c.type === AppConfig.nodeTypes.TEXTBLOCK && c.id !== node.id
            ).length;
            if (existingCount + 1 > limit) return fail();
        }

        const stack = [node];
        while (stack.length) {
            const current = stack.pop();
            if (!Array.isArray(current.children)) continue;
            if (TreeUtils.countChildrenByType(current, AppConfig.nodeTypes.TEXTBLOCK) > limit) return fail();
            stack.push(...current.children);
        }

        return ValidationCore.success();
    }
};

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.ValidationTree = ValidationTree;
