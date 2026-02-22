/**
 * Основной менеджер дерева элементов акта
 *
 * Управляет состоянием, выделением и координацией между модулями.
 * Делегирует рендеринг и drag-and-drop специализированным классам.
 */
class TreeManager {
    /**
     * @param {string} containerId - ID элемента-контейнера для дерева
     */
    constructor(containerId) {
        /** @type {HTMLElement} Контейнер для дерева */
        this.container = document.getElementById(containerId);

        /** @type {string|null} ID текущего выбранного узла */
        this.selectedNode = null;

        /** @type {HTMLElement|null} Элемент, который сейчас редактируется */
        this.editingElement = null;

        // Инициализация делегатов для отдельных функций
        this.renderer = new TreeRenderer(this);
        this.dragDrop = new TreeDragDrop(this);

        // Запускаем обработчики для снятия выделения
        this.initDeselectionHandlers();

        // Инициализируем drag-and-drop
        this.dragDrop.init();
    }

    /**
     * Инициализация обработчиков для снятия выделения
     *
     * Настраивает реакцию на клики вне дерева и нажатие ESC.
     */
    initDeselectionHandlers() {
        // Снимаем выделение при клике вне контейнера дерева
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.clearSelection();
            }
        });

        // Снимаем выделение при нажатии ESC (но не во время редактирования)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.editingElement) {
                this.clearSelection();
            }
        });
    }

    /**
     * Снятие выделения всех узлов
     *
     * Убирает все классы выделения и сбрасывает ссылки на выбранный узел.
     */
    clearSelection() {
        // Убираем класс selected со всех элементов
        this.container.querySelectorAll('.tree-item.selected')
            .forEach(el => el.classList.remove('selected'));

        // Убираем класс parent-selected со всех родительских элементов
        this.container.querySelectorAll('.tree-item.parent-selected')
            .forEach(el => el.classList.remove('parent-selected'));

        // Сбрасываем выбранный узел
        this.selectedNode = null;
        AppState.selectedNode = null;
    }

    /**
     * Выбор узла
     *
     * Снимает выделение со всех узлов и выделяет указанный,
     * также подсвечивает родительские элементы.
     *
     * @param {HTMLElement} itemElement - Элемент li, который нужно выделить
     */
    selectNode(itemElement) {
        // Снимаем выделение со всех элементов
        this.container.querySelectorAll('.tree-item.selected')
            .forEach(el => el.classList.remove('selected'));
        this.container.querySelectorAll('.tree-item.parent-selected')
            .forEach(el => el.classList.remove('parent-selected'));

        // Выделяем текущий элемент
        itemElement.classList.add('selected');
        this.selectedNode = itemElement.dataset.nodeId;
        AppState.selectedNode = this.selectedNode;

        // Подсвечиваем родительские элементы
        this._highlightParentNodes(itemElement);
    }

    /**
     * Подсвечивает родительские узлы
     * @private
     * @param {HTMLElement} itemElement - Элемент для начала подсветки
     */
    _highlightParentNodes(itemElement) {
        let currentElement = itemElement.parentElement;

        while (currentElement) {
            // Если это ul с классом tree-children, его родитель - li
            if (currentElement.classList?.contains('tree-children')) {
                const parentLi = currentElement.parentElement;
                if (parentLi?.classList.contains('tree-item')) {
                    parentLi.classList.add('parent-selected');
                }
            }

            currentElement = currentElement.parentElement;

            // Прерываем, если дошли до основного контейнера
            if (currentElement?.id === this.container.id) {
                break;
            }
        }
    }

    /**
     * Обработчик Ctrl+Click для перехода к элементу в превью
     *
     * @param {Object} node - Узел дерева
     * @param {HTMLElement} itemElement - Элемент li для выделения
     */
    handleCtrlClick(node, itemElement) {
        ContextMenuManager.hide();
        this.selectNode(itemElement);

        // Проверяем, что мы на шаге 1 (конструктор)
        if (typeof App !== 'undefined' && AppState.currentStep === 1) {
            const targetNodeId = node.id;

            // Переходим на шаг 2 (превью)
            App.goToStep(2);

            // Используем цепочку requestAnimationFrame + timeout для надежности
            const delay = AppConfig.tree.scrollSettings.transitionDelay;

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        this._scrollToPreviewElement(targetNodeId);
                    }, delay);
                });
            });
        }
    }

    /**
     * Прокручивает страницу до элемента в превью
     * @private
     * @param {string} targetNodeId - ID целевого узла
     */
    _scrollToPreviewElement(targetNodeId) {
        const itemsContainer = document.getElementById('itemsContainer');
        if (!itemsContainer) {
            console.warn('itemsContainer не найден');
            return;
        }

        const targetElement = this._findPreviewElement(itemsContainer, targetNodeId);
        if (!targetElement) {
            console.warn(`Элемент с node-id="${targetNodeId}" не найден`);
            return;
        }

        this._performScroll(targetElement);
        this._animateHighlight(targetElement);
    }

    /**
     * Находит элемент в превью по различным селекторам
     * @private
     * @param {HTMLElement} container - Контейнер для поиска
     * @param {string} nodeId - ID узла
     * @returns {HTMLElement|null} Найденный элемент или null
     */
    _findPreviewElement(container, nodeId) {
        // Попытка 1: ищем .item-block с data-node-id
        let element = container.querySelector(`.item-block[data-node-id="${nodeId}"]`);
        if (element) return element;

        // Попытка 2: ищем любой элемент с data-node-id и находим ближайший .item-block
        const nodeElement = container.querySelector(`[data-node-id="${nodeId}"]`);
        if (nodeElement) {
            const itemBlock = nodeElement.closest('.item-block');
            if (itemBlock) return itemBlock;

            // Если сам элемент имеет класс item-block
            if (nodeElement.classList.contains('item-block')) {
                return nodeElement;
            }
        }

        // Попытка 3: поиск в item-container, затем ближайший item-block
        const itemContainers = container.querySelectorAll('.item-container');
        for (const cont of itemContainers) {
            if (cont.dataset.nodeId === nodeId) {
                const itemBlock = cont.querySelector('.item-block');
                if (itemBlock) return itemBlock;
                return cont;
            }
        }

        return null;
    }

    /**
     * Выполняет плавную прокрутку к элементу
     * @private
     * @param {HTMLElement} element - Целевой элемент
     */
    _performScroll(element) {
        const scrollContainer = document.getElementById('step2');
        if (!scrollContainer) return;

        const header = document.querySelector('.header');
        const headerHeight = header ? header.offsetHeight : 0;
        const padding = AppConfig.tree.scrollSettings.headerOffset;

        const elementTop = element.getBoundingClientRect().top
            - scrollContainer.getBoundingClientRect().top
            + scrollContainer.scrollTop;

        scrollContainer.scrollTo({
            top: elementTop - headerHeight - padding,
            behavior: AppConfig.tree.scrollSettings.behavior
        });
    }

    /**
     * Анимирует подсветку элемента через CSS класс
     * @private
     * @param {HTMLElement} element - Элемент для подсветки
     */
    _animateHighlight(element) {
        // Убираем старую анимацию если она была
        element.classList.remove('highlight-flash');

        // Форсируем reflow для перезапуска анимации
        void element.offsetWidth;

        // Добавляем анимацию подсветки элемента
        element.classList.add('highlight-flash');

        // Удаляем класс после завершения анимации (2 секунды)
        setTimeout(() => {
            element.classList.remove('highlight-flash');
        }, 2000);
    }

    /**
     * Рендеринг дерева
     *
     * Делегирует выполнение в TreeRenderer.
     *
     * @param {Object} [node=AppState.treeData] - Корневой узел для рендеринга
     */
    render(node = AppState.treeData) {
        this.renderer.render(node);
    }
}

// Создаем глобальный экземпляр менеджера дерева
const treeManager = new TreeManager('tree');
