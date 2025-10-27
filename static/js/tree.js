/**
 * Менеджер дерева элементов акта
 * Управляет отображением и взаимодействием с древовидной структурой документа
 */
class TreeManager {
    constructor(containerId) {
        // Получаем контейнер для дерева
        this.container = document.getElementById(containerId);
        // Текущий выбранный узел
        this.selectedNode = null;
        // Элемент, который сейчас редактируется
        this.editingElement = null;
        // Запускаем обработчики для снятия выделения
        this.initDeselectionHandlers();
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
     * Рендеринг дерева
     * Создает HTML-структуру дерева на основе данных из AppState
     * @param {Object} node - Корневой узел для отрисовки (по умолчанию используется AppState.treeData)
     */
    render(node = AppState.treeData) {
        // Очищаем контейнер
        this.container.innerHTML = '';
        // Создаем элемент ul с деревом
        const ul = this.createTreeElement(node);
        // Добавляем дерево в контейнер
        this.container.appendChild(ul);
    }

    /**
     * Создание элемента <ul> для дерева
     * Генерирует список с дочерними элементами узла
     * @param {Object} node - Узел с дочерними элементами
     * @returns {HTMLUListElement} Элемент списка с деревом
     */
    createTreeElement(node) {
        const ul = document.createElement('ul');
        ul.className = 'tree';

        // Если есть дочерние элементы, создаем для них узлы
        if (node.children) {
            node.children.forEach(child => {
                const li = this.createNodeElement(child);
                ul.appendChild(li);
            });
        }

        return ul;
    }

    /**
     * Создание элемента узла дерева
     * Создает полный HTML-элемент узла со всеми обработчиками и иконками
     * @param {Object} node - Данные узла (id, label, type, children и т.д.)
     * @returns {HTMLLIElement} Готовый элемент узла дерева
     */
    createNodeElement(node) {
        const li = document.createElement('li');
        li.className = 'tree-item';
        // Сохраняем ID узла в data-атрибуте
        li.dataset.nodeId = node.id;

        // Добавляем класс для защищенных элементов (нельзя редактировать/удалять)
        if (node.protected) {
            li.classList.add('protected');
        }

        // Добавляем специальный класс для таблиц
        if (node.type === 'table') {
            li.classList.add('table-node');
        }

        // Создаем иконку для раскрытия/сворачивания узла
        const toggle = document.createElement('span');
        toggle.className = 'toggle-icon';
        // Показываем иконку только если есть дочерние элементы
        toggle.textContent = (node.children && node.children.length > 0) ? '▼' : '';
        li.appendChild(toggle);

        // Обработчик клика для сворачивания/раскрытия узла
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            li.classList.toggle('collapsed');
            // Меняем иконку в зависимости от состояния
            toggle.textContent = li.classList.contains('collapsed') ? '▶' : '▼';
        });

        // Создаем метку (название) узла
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = node.label;
        // По умолчанию метка не редактируется
        label.contentEditable = false;
        li.appendChild(label);

        // Добавляем иконку в зависимости от типа элемента
        if (node.type === 'table') {
            const tableIcon = document.createElement('span');
            tableIcon.className = 'table-icon';
            tableIcon.textContent = '📊';
            tableIcon.style.marginLeft = '5px';
            tableIcon.contentEditable = false;
            li.appendChild(tableIcon);
        } else if (node.type === 'textblock') {
            const textBlockIcon = document.createElement('span');
            textBlockIcon.className = 'textblock-icon';
            textBlockIcon.textContent = '📝';
            textBlockIcon.style.marginLeft = '5px';
            textBlockIcon.contentEditable = false;
            li.classList.add('textblock-node');
            li.appendChild(textBlockIcon);
        } else if (node.type === 'violation') {
            const violationIcon = document.createElement('span');
            violationIcon.className = 'violation-icon';
            violationIcon.textContent = '⚠️';
            violationIcon.style.marginLeft = '5px';
            violationIcon.contentEditable = false;
            li.classList.add('violation-node');
            li.appendChild(violationIcon);
        }

        /**
         * Обработчик Ctrl+Click для перехода к элементу в превью
         * При зажатом Ctrl/Cmd переключает на шаг 2 и прокручивает к элементу
         */
        const handleCtrlClick = () => {
            this.selectNode(li);
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
        };

        // Настройка обработчиков кликов для незащищенных элементов
        if (!node.protected) {
            // Переменные для отслеживания двойного клика
            let clickCount = 0;
            let clickTimer = null;

            // Обработчик кликов по метке
            label.addEventListener('click', (e) => {
                e.stopPropagation();

                // Обработка Ctrl+Click
                if (e.ctrlKey || e.metaKey) {
                    handleCtrlClick();
                    return;
                }

                // Отслеживаем двойной клик для редактирования
                clickCount++;
                if (clickCount === 1) {
                    // Первый клик - запускаем таймер
                    clickTimer = setTimeout(() => {
                        clickCount = 0;
                        this.selectNode(li);
                    }, 300);
                } else if (clickCount === 2) {
                    // Второй клик - начинаем редактирование
                    clearTimeout(clickTimer);
                    clickCount = 0;
                    this.startEditing(label, node);
                }
            });

            // Показываем курсор-указатель на метке
            label.style.cursor = 'pointer';
        } else {
            // Для защищенных элементов только выделение и Ctrl+Click
            label.addEventListener('click', (e) => {
                e.stopPropagation();

                if (e.ctrlKey || e.metaKey) {
                    handleCtrlClick();
                    return;
                }

                this.selectNode(li);
            });
        }

        // Обработчик клика по всему элементу li
        li.addEventListener('click', (e) => {
            // Игнорируем клики по служебным элементам
            if (e.target === label || e.target === toggle ||
                e.target.classList.contains('table-icon') ||
                e.target.classList.contains('textblock-icon') ||
                e.target.classList.contains('violation-icon')) {
                return;
            }

            e.stopPropagation();

            // Обработка Ctrl+Click
            if (e.ctrlKey || e.metaKey) {
                handleCtrlClick();
                return;
            }

            this.selectNode(li);
        });

        // Обработчик контекстного меню (правый клик)
        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Выделяем элемент
            this.selectNode(li);
            // Показываем контекстное меню
            ContextMenuManager.show(e.clientX, e.clientY, node.id, 'tree');
        });

        // Рекурсивно создаем дочерние элементы
        if (node.children && node.children.length > 0) {
            const childrenUl = document.createElement('ul');
            childrenUl.className = 'tree-children';
            node.children.forEach(child => {
                childrenUl.appendChild(this.createNodeElement(child));
            });
            li.appendChild(childrenUl);
        }

        return li;
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
     * Начало редактирования узла
     * Включает режим редактирования для метки узла с возможностью сохранения по Enter или отмены по Escape
     * @param {HTMLElement} labelElement - Элемент метки для редактирования
     * @param {Object} node - Объект данных узла
     */
    startEditing(labelElement, node) {
        const item = labelElement.closest('.tree-item');
        // Добавляем класс для визуального обозначения режима редактирования
        item.classList.add('editing');
        // Делаем метку редактируемой
        labelElement.contentEditable = true;
        this.editingElement = labelElement;

        // Сохраняем оригинальное название для возможности отмены
        const originalLabel = node.label;

        // Для специальных типов узлов показываем пользовательское название или автосгенерированное
        if (node.type === 'table' || node.type === 'textblock' || node.type === 'violation') {
            const currentLabel = node.customLabel || node.label;
            labelElement.textContent = currentLabel;
        }

        // Устанавливаем фокус и выделяем весь текст
        labelElement.focus();
        const range = document.createRange();
        range.selectNodeContents(labelElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        /**
         * Завершение редактирования
         * @param {boolean} cancel - Флаг отмены изменений
         */
        const finishEditing = (cancel = false) => {
            // Выключаем режим редактирования
            labelElement.contentEditable = false;
            item.classList.remove('editing');
            this.editingElement = null;

            // Если отменяем - возвращаем оригинальный текст
            if (cancel) {
                labelElement.textContent = originalLabel;
                return;
            }

            const newLabel = labelElement.textContent.trim();

            // Обработка для специальных типов узлов (table, textblock, violation)
            if (node.type === 'table' || node.type === 'textblock' || node.type === 'violation') {
                if (newLabel && newLabel !== node.label) {
                    // Сохраняем пользовательское название
                    node.customLabel = newLabel;
                    node.label = newLabel;
                } else if (!newLabel) {
                    // Если пустое, удаляем пользовательское название и возвращаем автогенерируемое
                    delete node.customLabel;
                    node.label = node.number || originalLabel;
                    AppState.generateNumbering();
                    labelElement.textContent = node.label;
                }
                // Обновляем дерево и превью
                treeManager.render();
                PreviewManager.update();
            } else {
                // Обработка для обычных пунктов
                if (newLabel && newLabel !== originalLabel) {
                    // Сохраняем новое название и обновляем нумерацию
                    node.label = newLabel;
                    AppState.generateNumbering();
                    treeManager.render();
                    PreviewManager.update();
                } else if (!newLabel) {
                    // Если пустое, возвращаем оригинальное название
                    labelElement.textContent = originalLabel;
                } else {
                    labelElement.textContent = node.label;
                }
            }
        };

        // Обработчик потери фокуса - сохраняем изменения
        const blurHandler = () => finishEditing(false);

        // Обработчик клавиш
        const keydownHandler = (e) => {
            if (e.key === 'Enter') {
                // Enter - сохраняем изменения
                e.preventDefault();
                e.stopPropagation();
                labelElement.removeEventListener('blur', blurHandler);
                labelElement.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Escape') {
                // Escape - отменяем изменения
                e.preventDefault();
                e.stopPropagation();
                labelElement.removeEventListener('blur', blurHandler);
                labelElement.removeEventListener('keydown', keydownHandler);
                finishEditing(true);
            }
        };

        // Подключаем обработчики
        labelElement.addEventListener('blur', blurHandler);
        labelElement.addEventListener('keydown', keydownHandler);
    }
}

// Создаем глобальный экземпляр менеджера дерева
const treeManager = new TreeManager('tree');
