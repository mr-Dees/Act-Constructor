/**
 * Модуль операций с деревом документа
 *
 * Управляет CRUD операциями с узлами, иерархической нумерацией,
 * перемещением элементов и обновлением связанных данных.
 */

import { ChangelogTracker } from '../changelog-tracker.js';
import { AuditIdService } from '../services/id-generator.js';
import { MetricsRiskCoordinator } from './metrics-risk-coordinator.js';
import { AppState } from './state-core.js';
import { StorageManager } from '../storage-manager.js';
import { TreeUtils } from '../tree/tree-utils.js';
import { ValidationCore } from '../validation/validation-core.js';
import { ValidationTree } from '../validation/validation-tree.js';
import { AppConfig } from '../../shared/app-config.js';
import { ChatEventBus } from '../../shared/chat/chat-event-bus.js';
import { DialogManager } from '../../shared/dialog/dialog-confirm.js';
import { Notifications } from '../../shared/notifications.js';

Object.assign(AppState, {
    /**
     * Генерирует иерархическую нумерацию для всех узлов дерева
     * @param {Object} [node=this.treeData] - Узел для обработки
     * @param {string} [prefix=''] - Префикс нумерации
     */
    generateNumbering(node = this.treeData, prefix = '') {
        if (!node.children) return;

        const {TABLE, TEXTBLOCK, VIOLATION} = AppConfig.nodeTypes;
        node.children.forEach((child, index) => {
            if (child.type === TABLE) {
                this._numberTable(child, node);
            } else if (child.type === TEXTBLOCK) {
                this._numberTextBlock(child, node);
            } else if (child.type === VIOLATION) {
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
        const parentTables = parent.children.filter(c => c.type === AppConfig.nodeTypes.TABLE);
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
        const parentTextBlocks = parent.children.filter(c => c.type === AppConfig.nodeTypes.TEXTBLOCK);
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
        const parentViolations = parent.children.filter(c => c.type === AppConfig.nodeTypes.VIOLATION);
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
        const itemChildren = parent.children.filter(c => !c.type || c.type === AppConfig.nodeTypes.ITEM);
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
            child.type === AppConfig.nodeTypes.TABLE && child.isMetricsTable === true
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
        const guard = ValidationCore.requireWrite('cannotModifyTree');
        if (guard) return guard;

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
                this.setNodeInvoice(parent.id, null, {changelog: false});
            }
            this._addAsChild(parent, newNode);
        } else {
            this._addAsSibling(parentId, newNode);
        }

        this.generateNumbering();

        // Асинхронно присваиваем audit_point_id новым узлам (не блокируем пользователя)
        if (typeof AuditIdService !== 'undefined' && window.currentActId) {
            AuditIdService.assignMissingPointIds(window.currentActId, this.treeData);
        }

        if (typeof ChangelogTracker !== 'undefined') {
            ChangelogTracker.record('add_node', newNode.id, newNode.label, {parentId: isChild ? parentId : this.findParentNode(parentId)?.id});
        }

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
            type: AppConfig.nodeTypes.ITEM
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

        // Страховка API-уровня над UI-проверкой: защищённые узлы (секции 1-5)
        // нельзя удалить прямым вызовом, даже из консоли/undo/миграции.
        // Исключение: node.deletable === true — явное разрешение поверх protected
        // (используется риск-таблицами: protected продолжает блокировать drag и
        // структуру, но удаление разрешено). Сводные metrics-таблицы deletable не
        // получают — остаются неудаляемыми вручную.
        if ((node.protected && node.deletable !== true) || node.deletable === false) {
            if (typeof Notifications !== 'undefined') {
                Notifications.error('Этот элемент защищён от удаления');
            }
            return false;
        }

        return this._deleteNodeUnchecked(node, nodeId);
    },

    /**
     * Внутреннее удаление узла без проверки protected/deletable.
     * Используется для каскадного удаления потомков: дети защищённых узлов
     * (например, metrics-таблица у 5.X) удаляются вместе с родителем
     * по бизнес-смыслу «родителя нет — детям незачем».
     * @private
     * @param {Object} node - Узел для удаления
     * @param {string} nodeId - ID узла
     * @returns {boolean} true если удаление успешно
     */
    _deleteNodeUnchecked(node, nodeId) {
        const isRiskTable = this._isRiskTable(node);

        if (typeof ChangelogTracker !== 'undefined') {
            const parent = this.findParentNode(nodeId);
            ChangelogTracker.record('delete_node', nodeId, node.label, {parentId: parent?.id});
        }

        this._deleteNodeData(node);
        this._deleteChildren(node);
        this._removeFromParent(nodeId);

        if (isRiskTable) {
            // Единая точка входа в каскад metrics↔risk: snapshot/rollback safety.
            MetricsRiskCoordinator.onRiskTableRemoved();
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
        if (node.type !== AppConfig.nodeTypes.TABLE) return false;
        // E-2: pinned-флаги читаем с node.
        // Tax учитывается как риск; Other — отдельный пул, не риск.
        return !!(node.isRegularRiskTable || node.isOperationalRiskTable || node.isTaxRiskTable);
    },

    /**
     * Удаляет данные узла из хранилищ
     * @private
     * @param {Object} node - Узел для удаления данных
     */
    _deleteNodeData(node) {
        const {TABLE, TEXTBLOCK, VIOLATION} = AppConfig.nodeTypes;
        if (node.type === TABLE && node.tableId) {
            delete this.tables[node.tableId];
            delete this.tableUISizes?.[node.tableId];
        } else if (node.type === TEXTBLOCK && node.textBlockId) {
            delete this.textBlocks[node.textBlockId];
        } else if (node.type === VIOLATION && node.violationId) {
            delete this.violations[node.violationId];
            // Чистим зеркальный реестр ViolationManager.activeViolations,
            // иначе Map копит мёртвые объекты при удалении узлов.
            if (typeof violationManager !== 'undefined' && typeof violationManager.removeViolation === 'function') {
                violationManager.removeViolation(node.violationId);
            }
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
            // Каскадное удаление: НЕ проверяем protected/deletable у потомков,
            // иначе protected metrics-таблица заблокирует удаление родителя.
            this._deleteNodeUnchecked(child, child.id);
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
        const guard = ValidationCore.requireWrite('cannotModifyTree');
        if (guard) return guard;

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

        // Запрещаем перемещение узлов с таблицами рисков за пределы раздела 5
        if (this._findRiskTablesInSubtree(draggedNode).length > 0) {
            const newParentUnder5 = newParent.id === '5' || TreeUtils.isUnderSection5(newParent);
            if (!newParentUnder5) {
                return ValidationCore.failure('Нельзя перемещать блоки с таблицами рисков за пределы раздела 5');
            }
        }

        // Запоминаем предка 5.X до перемещения (для пересчёта сводных таблиц)
        const oldAncestor5x = this._findFirstLevelAncestorUnder5(draggedNode.id);

        // Запоминаем, был ли новый родитель листовым узлом в разделе 5
        const wasNewParentTbLeaf = position === 'child' &&
            (!draggedNode.type || draggedNode.type === AppConfig.nodeTypes.ITEM) &&
            TreeUtils.isUnderSection5(newParent) &&
            TreeUtils.isTbLeaf(newParent);

        this._performMove(draggedNode, draggedParent, newParent, targetNode, targetNodeId, position);
        this.generateNumbering();

        if (typeof ChangelogTracker !== 'undefined') {
            ChangelogTracker.record('move_node', draggedNodeId, draggedNode.label, {from: draggedParent.id, to: newParent.id, position});
        }

        // Очищаем ТБ и фактуру у нового родителя, если он был листовым узлом в разделе 5
        if (wasNewParentTbLeaf) {
            delete newParent.tb;
            this.setNodeInvoice(newParent.id, null, {changelog: false});
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

        // Пересчитываем сводные таблицы метрик при перемещении внутри раздела 5.
        // Через coordinator: snapshot/rollback при exception во время reconcile.
        MetricsRiskCoordinator.onSubtreeMoved(draggedNode, oldAncestor5x);

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
            child => child.type === AppConfig.nodeTypes.TABLE && child.isMetricsTable === true
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
            child => child.type === AppConfig.nodeTypes.TABLE && child.isMetricsTable === true
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
        const {TABLE, TEXTBLOCK, VIOLATION} = AppConfig.nodeTypes;
        const isInformational = [TABLE, TEXTBLOCK, VIOLATION].includes(draggedNode.type);
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
     * Проверяет ограничения перемещения узлов в раздел 5 с учётом таблиц рисков.
     * Гарантирует, что таблицы рисков остаются на одном уровне: либо все на уровне
     * пунктов (5.x), либо все на уровне подпунктов (5.x.x+), но не одновременно.
     *
     * Вычисляет фактическую глубину каждого узла с риск-таблицами:
     * - Оставшиеся узлы (не в перемещаемом поддереве) — по текущей глубине
     * - Узлы в перемещаемом поддереве — по глубине в новой позиции
     * @private
     * @param {Object} draggedNode - Перемещаемый узел
     * @param {Object} newParent - Новый родитель после перемещения
     * @returns {Object} Результат проверки
     */
    _checkSection5RiskConstraints(draggedNode, newParent) {
        if (draggedNode.type && draggedNode.type !== AppConfig.nodeTypes.ITEM) return ValidationCore.success();

        const node5 = this.findNodeById('5');
        if (!node5?.children) return ValidationCore.success();

        const isNewParentInSection5 = newParent.id === '5' || !!newParent.number?.match(/^5\.\d+/);
        if (!isNewParentInSection5) return ValidationCore.success();

        // Собираем ID перемещаемого поддерева для исключения
        const draggedIds = new Set();
        const collectIds = (n) => { draggedIds.add(n.id); n.children?.forEach(collectIds); };
        collectIds(draggedNode);

        // Глубина узла под секцией 5: число сегментов - 1 (5→0, 5.1→1, 5.1.1→2, ...)
        const getDepth = (node) => node.number ? (node.number.split('.').length - 1) : 0;

        let hasPointLevel = false;
        let hasSubpointLevel = false;

        // 1. Оставшиеся узлы — определяем уровень рисков, исключая перемещаемое поддерево
        const checkRemaining = (node) => {
            if (draggedIds.has(node.id)) return;
            if ((!node.type || node.type === AppConfig.nodeTypes.ITEM) && node.number?.match(/^5\.\d+/)) {
                if (node.children?.some(c => !draggedIds.has(c.id) && this._isRiskTable(c))) {
                    if (getDepth(node) === 1) hasPointLevel = true;
                    else hasSubpointLevel = true;
                }
            }
            node.children?.forEach(child => {
                if (!draggedIds.has(child.id)) checkRemaining(child);
            });
        };
        checkRemaining(node5);

        // 2. Перемещаемое поддерево — вычисляем глубину на новой позиции
        const newParentDepth = newParent.id === '5' ? 0 : getDepth(newParent);

        const checkDragged = (node, depth) => {
            if (node.children?.some(c => this._isRiskTable(c))) {
                if (depth === 1) hasPointLevel = true;
                else hasSubpointLevel = true;
            }
            node.children?.forEach(child => {
                if (!child.type || child.type === AppConfig.nodeTypes.ITEM) {
                    checkDragged(child, depth + 1);
                }
            });
        };
        checkDragged(draggedNode, newParentDepth + 1);

        // Конфликт уровней — блокируем
        if (hasPointLevel && hasSubpointLevel) {
            return ValidationCore.failure(
                'Нельзя перемещать: таблицы рисков окажутся на разных уровнях раздела 5'
            );
        }

        // Нельзя создавать подпункты в 5.x при наличии рисков на уровне пунктов
        if (hasPointLevel && newParent.number?.match(/^5\.\d+$/)) {
            return ValidationCore.failure(
                'Нельзя перемещать элементы в подпункты раздела 5: есть таблицы рисков на уровне пунктов'
            );
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
        // Сводная таблица на 5.X нужна только при наличии рисков на глубоком уровне (5.X.X+)
        if (!node.number?.match(/^5\.\d+$/)) return;

        const {TABLE, ITEM} = AppConfig.nodeTypes;
        const hasDeepRisks = (node.children || []).some(child =>
            child.type === ITEM && this._findRiskTablesInSubtree(child).length > 0
        );
        if (!hasDeepRisks) return;

        const hasTable = node.children?.some(
            child => child.type === TABLE && child.isMetricsTable === true
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
     * Находит узел 5.X (первого уровня под разделом 5), который является предком данного узла
     * @private
     * @param {string} nodeId - ID узла
     * @returns {Object|null} Узел 5.X или null если узел не в разделе 5
     */
    _findFirstLevelAncestorUnder5(nodeId) {
        let node = this.findNodeById(nodeId);
        if (!node) return null;

        let parent = this.findParentNode(nodeId);
        while (parent && parent.id !== '5') {
            node = parent;
            parent = this.findParentNode(node.id);
        }

        if (parent?.id === '5' && node.number?.match(/^5\.\d+$/)) return node;
        return null;
    },

    /**
     * Полная сверка сводных таблиц метрик после перемещения узла внутри раздела 5
     * @private
     * @param {Object} draggedNode - Перемещённый узел
     * @param {Object|null} oldAncestor5x - Старый предок 5.X до перемещения
     */
    _reconcileMetricsTablesAfterMove(draggedNode, oldAncestor5x) {
        // Проверяем, есть ли в перемещённом поддереве таблицы рисков
        const riskTables = this._findRiskTablesInSubtree(draggedNode);
        if (riskTables.length === 0) return;

        // Находим нового предка 5.X
        const newAncestor5x = this._findFirstLevelAncestorUnder5(draggedNode.id);

        // Если предок 5.X не изменился — ранний выход
        if (oldAncestor5x && newAncestor5x && oldAncestor5x.id === newAncestor5x.id) return;

        // Очистка старого: удаляет сводные таблицы у всех 5.X, где нет глубоких рисков
        this._cleanupMetricsTablesAfterRiskTableDeleted();

        // Создание сводной для нового предка 5.X, только если риски на глубоком уровне (5.X.X+)
        if (newAncestor5x) {
            const hasDeepRisks = (newAncestor5x.children || []).some(child =>
                child.type === AppConfig.nodeTypes.ITEM && this._findRiskTablesInSubtree(child).length > 0
            );
            if (hasDeepRisks) {
                this._handleMetricsTableForNode(newAncestor5x);
            }
        }

        // Главная сводная таблица: создаём/удаляем по наличию рисков в разделе 5
        const node5 = this.findNodeById('5');
        if (node5) {
            const allRiskTables = this._findRiskTablesInSubtree(node5);
            if (allRiskTables.length > 0) {
                this._createMainMetricsTable();
            }
        }

        this.generateNumbering();
    },

    /**
     * Единая точка записи ТБ-флагов узла. Обновляет node.tb, пишет в changelog
     * и эмитит событие 'node:tb-changed' через ChatEventBus (если доступен) —
     * подписчики (TreeRenderer, ItemsRenderer) обновляют свои представления.
     *
     * Заменяет прямые мутации node.tb в tree-renderer и items-renderer.
     * @param {string} nodeId - ID узла
     * @param {string} abbr - Аббревиатура территориального банка
     * @param {boolean} checked - Назначить (true) или снять (false)
     */
    setNodeTb(nodeId, abbr, checked) {
        const node = this.findNodeById(nodeId);
        if (!node) return;

        if (!node.tb) node.tb = [];

        if (checked) {
            if (!node.tb.includes(abbr)) node.tb.push(abbr);
        } else {
            node.tb = node.tb.filter(t => t !== abbr);
        }

        if (typeof ChangelogTracker !== 'undefined') {
            ChangelogTracker.record('tb_change', nodeId, node.label, {abbr, checked});
        }

        if (typeof StorageManager !== 'undefined' && StorageManager.markAsUnsaved) {
            StorageManager.markAsUnsaved();
        }

        // Уведомляем подписчиков (TreeRenderer/ItemsRenderer) о per-node изменении.
        // ChatEventBus задействован как ad-hoc общий event-bus; optional chaining
        // защищает от случая, когда chat-модуль ещё не загружен.
        window.ChatEventBus?.emit?.('node:tb-changed', {nodeId, abbr, checked});
    },

    /**
     * Единая точка записи фактуры узла. Аналог setNodeTb для node.invoice.
     * Пишет в changelog (если не каскад), эмитит 'node:invoice-changed' для
     * targeted-обновления бейджа в дереве и items без полного render'а.
     *
     * @param {string} nodeId - ID узла
     * @param {Object|null} invoiceData - Данные фактуры или null для удаления
     * @param {Object} [opts] - Опции
     * @param {boolean} [opts.changelog=true] - Записывать ли в changelog
     *        (для каскадных cleanup при move/create передавать false —
     *         родительская операция уже залогирована)
     */
    setNodeInvoice(nodeId, invoiceData, opts = {}) {
        const {changelog = true} = opts;
        const node = this.findNodeById(nodeId);
        if (!node) return;

        const had = !!node.invoice;
        if (invoiceData) {
            node.invoice = invoiceData;
        } else if (had) {
            delete node.invoice;
        } else {
            return;
        }

        if (changelog && typeof ChangelogTracker !== 'undefined') {
            const action = invoiceData ? 'invoice_set' : 'invoice_remove';
            ChangelogTracker.record(action, nodeId, node.label, {});
        }

        if (typeof StorageManager !== 'undefined' && StorageManager.markAsUnsaved) {
            StorageManager.markAsUnsaved();
        }

        // Уведомляем подписчиков (TreeRenderer) о per-node изменении фактуры.
        window.ChatEventBus?.emit?.('node:invoice-changed', {nodeId, attached: !!invoiceData});
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
     * Рекурсивно очищает свойство invoice у узла и всех его потомков.
     * Каскадный путь — родительская операция (move/delete) уже в changelog,
     * поэтому setNodeInvoice вызывается с {changelog: false}. События
     * 'node:invoice-changed' эмитятся, чтобы UI снял бейджи фактур.
     * @private
     * @param {Object} node - Узел для очистки
     */
    _clearInvoiceRecursive(node) {
        if (node.invoice) {
            this.setNodeInvoice(node.id, null, {changelog: false});
        }

        if (node.children) {
            for (const child of node.children) {
                this._clearInvoiceRecursive(child);
            }
        }
    }
});
