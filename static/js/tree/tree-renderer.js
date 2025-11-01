/**
 * Модуль рендеринга дерева элементов
 * Отвечает за создание DOM-структуры дерева
 */
class TreeRenderer {
    constructor(manager) {
        this.manager = manager;
    }

    /**
     * Рендеринг дерева
     * Создает HTML-структуру дерева на основе данных из AppState
     * @param {Object} node - Корневой узел для отрисовки
     */
    render(node = AppState.treeData) {
        // Очищаем контейнер
        this.manager.container.innerHTML = '';
        // Создаем элемент ul с деревом
        const ul = this.createTreeElement(node);
        // Добавляем дерево в контейнер
        this.manager.container.appendChild(ul);
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
        this.addNodeTypeIcon(li, node.type);

        // Настраиваем обработчики событий для узла
        this.setupNodeEventHandlers(li, label, node);

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
     * Добавление иконки типа узла
     * @param {HTMLElement} li - Элемент узла
     * @param {string} type - Тип узла (table, textblock, violation)
     */
    addNodeTypeIcon(li, type) {
        let icon = null;
        let className = '';
        let emoji = '';

        switch (type) {
            case 'table':
                className = 'table-icon';
                emoji = '📊';
                break;
            case 'textblock':
                className = 'textblock-icon';
                emoji = '📝';
                li.classList.add('textblock-node');
                break;
            case 'violation':
                className = 'violation-icon';
                emoji = '⚠️';
                li.classList.add('violation-node');
                break;
        }

        if (className && emoji) {
            icon = document.createElement('span');
            icon.className = className;
            icon.textContent = emoji;
            icon.style.marginLeft = '5px';
            icon.contentEditable = false;
            li.appendChild(icon);
        }
    }

    /**
     * Настройка обработчиков событий для узла дерева
     * @param {HTMLElement} li - Элемент узла
     * @param {HTMLElement} label - Элемент метки
     * @param {Object} node - Данные узла
     */
    setupNodeEventHandlers(li, label, node) {
        const handleCtrlClick = () => {
            this.manager.handleCtrlClick(node, li);
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
                        this.manager.selectNode(li);
                    }, 300);
                } else if (clickCount === 2) {
                    // Второй клик - начинаем редактирование
                    clearTimeout(clickTimer);
                    clickCount = 0;
                    // Используем метод из items-title-editing.js
                    ItemsTitleEditing.startEditingTreeNode(label, node, this.manager);
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

                this.manager.selectNode(li);
            });
        }

        // Обработчик клика по всему элементу li
        li.addEventListener('click', (e) => {
            // Игнорируем клики по служебным элементам
            if (e.target === label || e.target.classList.contains('toggle-icon') ||
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

            this.manager.selectNode(li);
        });

        // Обработчик контекстного меню (правый клик)
        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Выделяем элемент
            this.manager.selectNode(li);
            // Показываем контекстное меню
            ContextMenuManager.show(e.clientX, e.clientY, node.id, 'tree');
        });
    }
}
