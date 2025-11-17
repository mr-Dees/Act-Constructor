/**
 * Модуль drag-and-drop для дерева элементов
 *
 * Обеспечивает перетаскивание узлов внутри дерева с визуальными индикаторами.
 * Поддерживает валидацию перемещений и запрет на перетаскивание узлов с таблицами рисков.
 */
class TreeDragDrop {
    /**
     * @param {TreeManager} manager - Экземпляр менеджера дерева
     */
    constructor(manager) {
        /** @type {TreeManager} */
        this.manager = manager;

        /** @type {Object|null} Перетаскиваемый узел данных */
        this.draggedNode = null;

        /** @type {HTMLElement|null} Перетаскиваемый DOM элемент */
        this.draggedElement = null;

        /** @type {HTMLElement|null} Текущая зона сброса */
        this.currentDropZone = null;

        /** @type {string|null} Позиция сброса ('before', 'after', 'child') */
        this.dropPosition = null;

        /** @type {Object|null} Целевой узел для сброса */
        this.dropTargetNode = null;
    }

    /**
     * Инициализация drag-and-drop для дерева
     * Привязывает обработчики событий и активирует перетаскивание для доступных элементов
     */
    init() {
        const container = this.manager.container;

        container.addEventListener('dragstart', this.handleDragStart.bind(this));
        container.addEventListener('dragover', this.handleDragOver.bind(this));
        container.addEventListener('dragleave', this.handleDragLeave.bind(this));
        container.addEventListener('drop', this.handleDrop.bind(this));
        container.addEventListener('dragend', this.handleDragEnd.bind(this));

        this.enableDraggableItems();
    }

    /**
     * Делает все незащищенные элементы перетаскиваемыми
     * Использует MutationObserver для динамического обновления атрибутов
     */
    enableDraggableItems() {
        const observer = new MutationObserver(() => {
            this.manager.container.querySelectorAll('.tree-item:not(.protected)')
                .forEach(item => item.setAttribute('draggable', 'true'));
        });

        observer.observe(this.manager.container, {
            childList: true,
            subtree: true
        });

        // Начальная установка
        this.manager.container.querySelectorAll('.tree-item:not(.protected)')
            .forEach(item => item.setAttribute('draggable', 'true'));
    }

    /**
     * Обработчик начала перетаскивания
     * Блокирует перетаскивание защищенных узлов и узлов с таблицами рисков в поддереве
     * @param {DragEvent} e - Событие dragstart
     */
    handleDragStart(e) {
        const treeItem = e.target.closest('.tree-item');
        if (!treeItem) return;

        const nodeId = treeItem.dataset.nodeId;
        const node = AppState.findNodeById(nodeId);

        if (!node || node.protected) {
            e.preventDefault();
            return;
        }

        // Запрещаем перетаскивание узлов с таблицами рисков
        if (this._hasRiskTablesInSubtree(node)) {
            e.preventDefault();
            Notifications.error('Нельзя перемещать блоки, содержащие таблицы рисков');
            return;
        }

        this.draggedNode = node;
        this.draggedElement = treeItem;

        treeItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', nodeId);

        setTimeout(() => {
            treeItem.style.opacity = '0.4';
        }, 0);
    }

    /**
     * Проверяет наличие таблиц рисков в узле и его поддереве
     * @private
     * @param {Object} node - Узел для проверки
     * @returns {boolean} true если найдены таблицы рисков
     */
    _hasRiskTablesInSubtree(node) {
        // Если узел сам является таблицей риска
        if (node.type === 'table' && node.tableId) {
            const table = AppState.tables[node.tableId];
            if (table && (table.isRegularRiskTable || table.isOperationalRiskTable)) {
                return true;
            }
        }

        // Рекурсивно проверяем дочерние элементы
        if (node.children?.length) {
            for (const child of node.children) {
                if (this._hasRiskTablesInSubtree(child)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Проверяет, может ли целевой узел принять перетаскиваемый узел как дочерний
     * @param {Object} targetNode - Целевой узел
     * @param {Object} draggedNode - Перетаскиваемый узел
     * @returns {boolean} true если может принять как дочерний
     */
    canAcceptAsChild(targetNode, draggedNode) {
        // Информационные элементы не могут иметь детей
        const informationalTypes = ['table', 'textblock', 'violation'];
        return !informationalTypes.includes(targetNode.type);
    }

    /**
     * Обработчик перемещения курсора над элементами
     * Определяет зону сброса и отображает визуальные индикаторы
     * @param {DragEvent} e - Событие dragover
     */
    handleDragOver(e) {
        if (!this.draggedNode) return;

        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        const treeItem = e.target.closest('.tree-item');
        if (!treeItem || treeItem === this.draggedElement) {
            this.clearDropZone();
            return;
        }

        const targetNodeId = treeItem.dataset.nodeId;
        const targetNode = AppState.findNodeById(targetNodeId);

        if (TreeUtils.isDescendant(targetNode, this.draggedNode)) {
            this.clearDropZone();
            return;
        }

        const position = this._calculateDropPosition(e, treeItem, targetNode);
        if (position) {
            this.updateDropZone(treeItem, `drop-${position}`, position, targetNode);
        }
    }

    /**
     * Вычисляет позицию сброса относительно целевого элемента
     * @private
     * @param {DragEvent} e - Событие dragover
     * @param {HTMLElement} treeItem - Целевой элемент
     * @param {Object} targetNode - Целевой узел
     * @returns {string|null} Позиция ('before', 'after', 'child') или null
     */
    _calculateDropPosition(e, treeItem, targetNode) {
        const rect = treeItem.getBoundingClientRect();
        const mouseY = e.clientY;

        // Получаем label элемента для более точного позиционирования
        const label = treeItem.querySelector('.tree-label');
        const labelRect = label ? label.getBoundingClientRect() : rect;

        // Вычисляем относительную позицию внутри видимой части элемента (label)
        const relativeY = mouseY - labelRect.top;
        const labelHeight = labelRect.height;

        // Проверяем, может ли целевой узел принять перетаскиваемый как дочерний
        const canBeChild = this.canAcceptAsChild(targetNode, this.draggedNode);

        // Для информационных элементов при наведении на их родителя всегда предлагаем вставку как child
        const draggedParent = AppState.findParentNode(this.draggedNode.id);
        const isDraggedInformational = ['table', 'textblock', 'violation'].includes(this.draggedNode.type);

        if (isDraggedInformational && draggedParent && draggedParent.id === targetNode.id) {
            return 'child';
        }

        // Определяем зону сброса
        if (relativeY < labelHeight * 0.15) {
            return 'before';
        } else if (relativeY > labelHeight * 0.85) {
            return 'after';
        } else {
            // Средние 70% - child, если возможно
            if (canBeChild) {
                return 'child';
            }
            // Если нельзя child, выбираем ближайшую границу
            return relativeY < labelHeight * 0.5 ? 'before' : 'after';
        }
    }

    /**
     * Обновляет визуальный индикатор зоны сброса
     * @param {HTMLElement} targetElement - Элемент-цель
     * @param {string} dropZoneClass - CSS-класс зоны сброса
     * @param {string} position - Позиция ('before', 'after', 'child')
     * @param {Object} targetNode - Узел-цель
     */
    updateDropZone(targetElement, dropZoneClass, position, targetNode) {
        if (this.currentDropZone === targetElement && this.dropPosition === position) {
            return;
        }

        this.clearDropZone();

        targetElement.classList.add(dropZoneClass);
        this.currentDropZone = targetElement;
        this.dropPosition = position;
        this.dropTargetNode = targetNode;
    }

    /**
     * Очищает визуальные индикаторы зоны сброса
     */
    clearDropZone() {
        if (this.currentDropZone) {
            this.currentDropZone.classList.remove('drop-before', 'drop-after', 'drop-child');
            this.currentDropZone = null;
        }
        this.dropPosition = null;
        this.dropTargetNode = null;
    }

    /**
     * Обработчик ухода курсора с элемента
     * Очищает индикаторы если курсор покинул границы элемента
     * @param {DragEvent} e - Событие dragleave
     */
    handleDragLeave(e) {
        const treeItem = e.target.closest('.tree-item');
        if (!treeItem) return;

        const rect = treeItem.getBoundingClientRect();

        // Проверяем, действительно ли курсор покинул элемент
        if (e.clientX < rect.left || e.clientX >= rect.right ||
            e.clientY < rect.top || e.clientY >= rect.bottom) {

            if (this.currentDropZone === treeItem) {
                this.clearDropZone();
            }
        }
    }

    /**
     * Обработчик сброса элемента
     * Выполняет перемещение узла с валидацией и обновлением UI
     * @param {DragEvent} e - Событие drop
     */
    async handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();

        if (!this.draggedNode || !this.dropTargetNode || !this.dropPosition) {
            this.cleanup();
            return;
        }

        const result = await AppState.moveNode(
            this.draggedNode.id,
            this.dropTargetNode.id,
            this.dropPosition
        );

        if (result.valid) {
            this.manager.render();
            PreviewManager.update('previewTrim', 30);

            if (AppState.currentStep === 2) {
                ItemsRenderer.renderAll();
            }

            Notifications.success('Элемент успешно перемещен');
        } else if (result.message) {
            Notifications.error(result.message);
        }

        this.cleanup();
    }

    /**
     * Обработчик завершения перетаскивания
     * Очищает состояние независимо от результата операции
     * @param {DragEvent} e - Событие dragend
     */
    handleDragEnd(e) {
        this.cleanup();
    }

    /**
     * Очищает все состояния и визуальные эффекты
     */
    cleanup() {
        if (this.draggedElement) {
            this.draggedElement.classList.remove('dragging');
            this.draggedElement.style.opacity = '';
        }

        this.clearDropZone();

        this.draggedNode = null;
        this.draggedElement = null;
    }
}
