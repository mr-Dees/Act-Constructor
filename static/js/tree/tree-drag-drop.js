/**
 * Модуль drag-and-drop для дерева элементов
 * Обеспечивает перетаскивание узлов внутри дерева с визуальными индикаторами
 */
class TreeDragDrop {
    constructor(manager) {
        this.manager = manager;
        this.draggedNode = null;
        this.draggedElement = null;
        this.currentDropZone = null;
        this.dropPosition = null;
        this.dropTargetNode = null;
    }

    /**
     * Инициализация drag-and-drop для дерева
     */
    init() {
        this.manager.container.addEventListener('dragstart', this.handleDragStart.bind(this));
        this.manager.container.addEventListener('dragover', this.handleDragOver.bind(this));
        this.manager.container.addEventListener('dragleave', this.handleDragLeave.bind(this));
        this.manager.container.addEventListener('drop', this.handleDrop.bind(this));
        this.manager.container.addEventListener('dragend', this.handleDragEnd.bind(this));

        this.enableDraggableItems();
    }

    /**
     * Делает все незащищенные элементы перетаскиваемыми
     */
    enableDraggableItems() {
        const observer = new MutationObserver(() => {
            this.manager.container.querySelectorAll('.tree-item:not(.protected)').forEach(item => {
                item.setAttribute('draggable', 'true');
            });
        });

        observer.observe(this.manager.container, {
            childList: true,
            subtree: true
        });

        this.manager.container.querySelectorAll('.tree-item:not(.protected)').forEach(item => {
            item.setAttribute('draggable', 'true');
        });
    }

    /**
     * Обработчик начала перетаскивания
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
     * Проверяет, может ли целевой узел принять перетаскиваемый узел как дочерний
     */
    canAcceptAsChild(targetNode, draggedNode) {
        // Информационные элементы не могут иметь детей
        if (targetNode.type === 'table' || targetNode.type === 'textblock' || targetNode.type === 'violation') {
            return false;
        }

        // Если перетаскиваем информационный элемент, проверяем что целевой узел - это его текущий родитель
        // или другой обычный пункт (item)
        if (draggedNode.type === 'table' || draggedNode.type === 'textblock' || draggedNode.type === 'violation') {
            // Информационные элементы могут быть детьми любых обычных пунктов
            return true;
        }

        // Для обычных пунктов - стандартная логика
        return true;
    }

    /**
     * Обработчик перемещения над элементами
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

        if (AppState.isDescendant(targetNode, this.draggedNode)) {
            this.clearDropZone();
            return;
        }

        const rect = treeItem.getBoundingClientRect();
        const mouseY = e.clientY;

        // Получаем label элемента для более точного позиционирования
        const label = treeItem.querySelector('.tree-label');
        const labelRect = label ? label.getBoundingClientRect() : rect;

        // Вычисляем относительную позицию внутри видимой части элемента (label)
        const relativeY = mouseY - labelRect.top;
        const labelHeight = labelRect.height;

        let position = null;
        let dropZoneClass = null;

        // Проверяем, может ли целевой узел принять перетаскиваемый как дочерний
        const canBeChild = this.canAcceptAsChild(targetNode, this.draggedNode);

        // Для информационных элементов, если мы наводим на их родителя,
        // всегда предлагаем вставку как child
        const draggedParent = AppState.findParentNode(this.draggedNode.id);
        const isDraggedInformational = this.draggedNode.type === 'table' ||
            this.draggedNode.type === 'textblock' ||
            this.draggedNode.type === 'violation';

        if (isDraggedInformational && draggedParent && draggedParent.id === targetNode.id) {
            // Перетаскиваем информационный элемент на его текущего родителя
            position = 'child';
            dropZoneClass = 'drop-child';
        } else if (relativeY < labelHeight * 0.15) {
            // Верхние 15% label - before
            position = 'before';
            dropZoneClass = 'drop-before';
        } else if (relativeY > labelHeight * 0.85) {
            // Нижние 15% label - after
            position = 'after';
            dropZoneClass = 'drop-after';
        } else {
            // Средние 70% - child, если возможно
            if (canBeChild) {
                position = 'child';
                dropZoneClass = 'drop-child';
            } else {
                // Если нельзя child, выбираем ближайшую границу
                if (relativeY < labelHeight * 0.5) {
                    position = 'before';
                    dropZoneClass = 'drop-before';
                } else {
                    position = 'after';
                    dropZoneClass = 'drop-after';
                }
            }
        }

        this.updateDropZone(treeItem, dropZoneClass, position, targetNode);
    }

    /**
     * Обновляет визуальный индикатор зоны сброса
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
     */
    handleDragLeave(e) {
        const treeItem = e.target.closest('.tree-item');
        if (!treeItem) return;

        const rect = treeItem.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX >= rect.right ||
            e.clientY < rect.top || e.clientY >= rect.bottom) {

            if (this.currentDropZone === treeItem) {
                this.clearDropZone();
            }
        }
    }

    /**
     * Обработчик сброса элемента
     * ИСПРАВЛЕНО: добавлен await для асинхронного вызова moveNode
     */
    async handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();

        if (!this.draggedNode || !this.dropTargetNode || !this.dropPosition) {
            this.cleanup();
            return;
        }

        // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: await для асинхронного метода
        const result = await AppState.moveNode(
            this.draggedNode.id,
            this.dropTargetNode.id,
            this.dropPosition
        );

        if (result.success) {
            this.manager.render();
            PreviewManager.update('previewTrim', 30);
            if (AppState.currentStep === 2) {
                ItemsRenderer.renderAll();
            }

            if (typeof Notifications !== 'undefined') {
                Notifications.success('Элемент успешно перемещен');
            }
        } else {
            // Не показываем ошибку, если пользователь отменил действие
            if (!result.cancelled) {
                if (typeof Notifications !== 'undefined') {
                    Notifications.error(result.reason || 'Не удалось переместить элемент');
                } else {
                    alert(result.reason || 'Не удалось переместить элемент');
                }
            }
        }

        this.cleanup();
    }

    /**
     * Обработчик завершения перетаскивания
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
