/**
 * Основной менеджер дерева элементов акта
 * Управляет состоянием, выделением и координацией между модулями
 */
class TreeManager {
    constructor(containerId) {
        // Получаем контейнер для дерева
        this.container = document.getElementById(containerId);
        // Текущий выбранный узел
        this.selectedNode = null;
        // Элемент, который сейчас редактируется
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
        this.container.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
        // Убираем класс parent-selected со всех родительских элементов
        this.container.querySelectorAll('.tree-item.parent-selected').forEach(el => el.classList.remove('parent-selected'));
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
        this.container.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
        this.container.querySelectorAll('.tree-item.parent-selected').forEach(el => el.classList.remove('parent-selected'));

        // Выделяем текущий элемент
        itemElement.classList.add('selected');
        this.selectedNode = itemElement.dataset.nodeId;
        AppState.selectedNode = this.selectedNode;

        // Подсвечиваем родительские элементы
        let currentElement = itemElement.parentElement;
        while (currentElement) {
            // Если это ul с классом tree-children, его родитель - li
            if (currentElement.classList && currentElement.classList.contains('tree-children')) {
                const parentLi = currentElement.parentElement;
                if (parentLi && parentLi.classList.contains('tree-item')) {
                    parentLi.classList.add('parent-selected');
                }
            }
            currentElement = currentElement.parentElement;

            // Прерываем, если дошли до основного контейнера
            if (currentElement && currentElement.id === this.container.id) {
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

            // Используем несколько requestAnimationFrame для надежности отрисовки
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        const itemsContainer = document.getElementById('itemsContainer');
                        if (!itemsContainer) return;

                        // Ищем элемент на странице превью
                        const targetElement = itemsContainer.querySelector(`[data-node-id="${targetNodeId}"]`);
                        if (targetElement) {
                            // Получаем высоту шапки для правильного позиционирования
                            const header = document.querySelector('.header');
                            const headerHeight = header ? header.offsetHeight : 60;

                            // Вычисляем позицию для прокрутки
                            const elementRect = targetElement.getBoundingClientRect();
                            const absoluteElementTop = elementRect.top + window.pageYOffset;
                            const scrollToPosition = absoluteElementTop - headerHeight - 20;

                            // Плавно прокручиваем к элементу
                            window.scrollTo({
                                top: scrollToPosition,
                                behavior: 'smooth'
                            });

                            // Добавляем анимацию подсветки элемента
                            targetElement.classList.add('highlight-flash');
                            setTimeout(() => {
                                targetElement.classList.remove('highlight-flash');
                            }, 2000);
                        }
                    }, 100);
                });
            });
        }
    }

    // Делегирующие методы для рендеринга
    /**
     * Рендеринг дерева.
     * Делегирует выполнение в TreeRenderer.
     */
    render(node = AppState.treeData) {
        this.renderer.render(node);
    }
}

// Создаем глобальный экземпляр менеджера дерева
const treeManager = new TreeManager('tree');
