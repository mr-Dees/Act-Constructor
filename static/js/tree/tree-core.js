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
     * Настраивает реакцию на клики вне дерева и нажатие ESC
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
     * Убирает все классы выделения и сбрасывает ссылки на выбранный узел
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
     * Снимает выделение со всех узлов и выделяет указанный, также подсвечивает родительские элементы
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
     * @param {Object} node - Узел дерева
     * @param {HTMLElement} itemElement - Элемент li для выделения
     */
    handleCtrlClick(node, itemElement) {
        this.selectNode(itemElement);

        // Проверяем, что мы на шаге 1 (конструктор)
        if (typeof App !== 'undefined' && AppState.currentStep === 1) {
            const targetNodeId = node.id;

            // Переходим на шаг 2 (превью)
            App.goToStep(2);

            // Используем цепочку requestAnimationFrame + timeout для надежности
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // Увеличиваем задержку для гарантии полной отрисовки
                    setTimeout(() => {
                        this._scrollToPreviewElement(targetNodeId);
                    }, 300);
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
        console.log('Scrolling to node:', targetNodeId);

        const itemsContainer = document.getElementById('itemsContainer');
        if (!itemsContainer) {
            console.error('itemsContainer не найден');
            return;
        }

        console.log('itemsContainer found');

        // Ищем элемент на странице превью по различным селекторам
        let targetElement = null;

        // Попытка 1: прямой поиск по data-node-id
        targetElement = itemsContainer.querySelector(`[data-node-id="${targetNodeId}"]`);
        console.log('Direct search result:', targetElement);

        // Попытка 2: поиск в item-container
        if (!targetElement) {
            const itemContainers = itemsContainer.querySelectorAll('.item-container');
            console.log('Found item-containers:', itemContainers.length);

            for (const container of itemContainers) {
                console.log('Checking container:', container.dataset.nodeId);
                if (container.dataset.nodeId === targetNodeId) {
                    targetElement = container;
                    console.log('Found in item-container');
                    break;
                }
            }
        }

        // Попытка 3: поиск по ID элемента
        if (!targetElement) {
            targetElement = document.getElementById(`item-${targetNodeId}`);
            console.log('Search by ID result:', targetElement);
        }

        if (!targetElement) {
            console.error(`Элемент с node-id="${targetNodeId}" не найден`);
            console.log('Available elements:', itemsContainer.querySelectorAll('[data-node-id]'));
            return;
        }

        console.log('Target element found:', targetElement);

        // Получаем высоту шапки
        const header = document.querySelector('.header');
        const headerHeight = header ? header.offsetHeight : 80;

        // Вычисляем позицию для прокрутки
        const elementRect = targetElement.getBoundingClientRect();
        const absoluteElementTop = elementRect.top + window.pageYOffset;
        const scrollToPosition = absoluteElementTop - headerHeight - 20;

        console.log('Scrolling to position:', scrollToPosition);

        // Плавно прокручиваем к элементу
        window.scrollTo({
            top: scrollToPosition,
            behavior: 'smooth'
        });

        // Запускаем анимацию подсветки
        console.log('Starting highlight animation');
        this._animateHighlight(targetElement);
    }

    /**
     * Анимирует подсветку элемента через Web Animations API
     * @private
     * @param {HTMLElement} element - Элемент для подсветки
     */
    _animateHighlight(element) {
        console.log('Animating element:', element);

        // Сохраняем оригинальные стили
        const originalBackground = element.style.backgroundColor;
        const originalBoxShadow = element.style.boxShadow;
        const originalTransition = element.style.transition;

        // Временно отключаем transitions
        element.style.transition = 'none';

        // Ключевые кадры анимации
        const keyframes = [
            {
                backgroundColor: 'transparent',
                boxShadow: '0 0 0 0 rgba(102, 126, 234, 0)',
                offset: 0
            },
            {
                backgroundColor: 'rgba(102, 126, 234, 0.15)',
                boxShadow: '0 0 10px 4px rgba(102, 126, 234, 0.4)',
                offset: 0.25
            },
            {
                backgroundColor: 'rgba(102, 126, 234, 0.25)',
                boxShadow: '0 0 15px 6px rgba(102, 126, 234, 0.5)',
                offset: 0.5
            },
            {
                backgroundColor: 'rgba(102, 126, 234, 0.12)',
                boxShadow: '0 0 8px 3px rgba(102, 126, 234, 0.3)',
                offset: 0.85
            },
            {
                backgroundColor: 'transparent',
                boxShadow: '0 0 0 0 rgba(102, 126, 234, 0)',
                offset: 1
            }
        ];

        // Параметры анимации
        const timing = {
            duration: 2000,
            easing: 'ease-out',
            fill: 'forwards'
        };

        try {
            // Запускаем анимацию
            const animation = element.animate(keyframes, timing);

            console.log('Animation started');

            // Восстанавливаем оригинальные стили после анимации
            animation.onfinish = () => {
                console.log('Animation finished');
                element.style.backgroundColor = originalBackground;
                element.style.boxShadow = originalBoxShadow;
                element.style.transition = originalTransition;
            };

            animation.oncancel = () => {
                console.log('Animation cancelled');
                element.style.backgroundColor = originalBackground;
                element.style.boxShadow = originalBoxShadow;
                element.style.transition = originalTransition;
            };

        } catch (error) {
            console.error('Animation error:', error);

            // Fallback: используем CSS класс
            element.classList.add('highlight-flash');
            setTimeout(() => {
                element.classList.remove('highlight-flash');
            }, 2000);
        }
    }

    /**
     * Рендеринг дерева
     * Делегирует выполнение в TreeRenderer
     * @param {Object} [node=AppState.treeData] - Корневой узел для рендеринга
     */
    render(node = AppState.treeData) {
        this.renderer.render(node);
    }
}

// Создаем глобальный экземпляр менеджера дерева
const treeManager = new TreeManager('tree');
