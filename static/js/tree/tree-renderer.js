/**
 * Модуль рендеринга дерева элементов
 *
 * Отвечает за создание DOM-структуры дерева на основе данных из AppState.
 * Обрабатывает события взаимодействия с узлами.
 */
class TreeRenderer {
    /**
     * @param {TreeManager} manager - Экземпляр менеджера дерева
     */
    constructor(manager) {
        /** @type {TreeManager} */
        this.manager = manager;
    }

    /**
     * Рендеринг дерева
     * Создает HTML-структуру дерева на основе данных из AppState
     * @param {Object} [node=AppState.treeData] - Корневой узел для отрисовки
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
        if (node.children?.length) {
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

        // Добавляем специальные классы для типов узлов
        this._addNodeTypeClass(li, node.type);

        // Создаем toggle для раскрытия/сворачивания
        const toggle = this._createToggleIcon(node, li);
        li.appendChild(toggle);

        // Создаем метку (название) узла
        const label = this._createLabel(node);
        li.appendChild(label);

        // Добавляем иконку типа узла
        this.addNodeTypeIcon(li, node.type);

        // Настраиваем обработчики событий для узла
        this.setupNodeEventHandlers(li, label, node);

        // Рекурсивно создаем дочерние элементы
        if (node.children?.length) {
            const childrenUl = this._createChildrenContainer(node);
            li.appendChild(childrenUl);
        }

        return li;
    }

    /**
     * Добавляет CSS класс в зависимости от типа узла
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {string} type - Тип узла
     */
    _addNodeTypeClass(li, type) {
        const typeClassMap = {
            table: 'table-node',
            textblock: 'textblock-node',
            violation: 'violation-node'
        };

        const className = typeClassMap[type];
        if (className) {
            li.classList.add(className);
        }
    }

    /**
     * Создает иконку для раскрытия/сворачивания узла
     * @private
     * @param {Object} node - Узел данных
     * @param {HTMLElement} li - Элемент узла
     * @returns {HTMLElement} Элемент toggle
     */
    _createToggleIcon(node, li) {
        const toggle = document.createElement('span');
        toggle.className = 'toggle-icon';

        // Показываем иконку только если есть дочерние элементы
        toggle.textContent = (node.children?.length > 0) ? '▼' : '';

        // Обработчик клика для сворачивания/раскрытия узла
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            li.classList.toggle('collapsed');

            // Меняем иконку в зависимости от состояния
            toggle.textContent = li.classList.contains('collapsed') ? '▶' : '▼';
        });

        return toggle;
    }

    /**
     * Создает метку узла
     * @private
     * @param {Object} node - Узел данных
     * @returns {HTMLElement} Элемент метки
     */
    _createLabel(node) {
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = node.label;
        label.contentEditable = false;
        return label;
    }

    /**
     * Создает контейнер для дочерних элементов
     * @private
     * @param {Object} node - Узел данных
     * @returns {HTMLElement} Контейнер с дочерними элементами
     */
    _createChildrenContainer(node) {
        const childrenUl = document.createElement('ul');
        childrenUl.className = 'tree-children';

        node.children.forEach(child => {
            childrenUl.appendChild(this.createNodeElement(child));
        });

        return childrenUl;
    }

    /**
     * Добавление иконки типа узла
     * @param {HTMLElement} li - Элемент узла
     * @param {string} type - Тип узла (table, textblock, violation)
     */
    addNodeTypeIcon(li, type) {
        const iconConfig = {
            table: {className: 'table-icon', emoji: '📊'},
            textblock: {className: 'textblock-icon', emoji: '📝'},
            violation: {className: 'violation-icon', emoji: '⚠️'}
        };

        const config = iconConfig[type];
        if (!config) return;

        const icon = document.createElement('span');
        icon.className = config.className;
        icon.textContent = config.emoji;
        icon.style.marginLeft = '5px';
        icon.contentEditable = false;

        li.appendChild(icon);
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

        // Настройка обработчиков кликов
        if (!node.protected) {
            this._setupEditableNodeHandlers(li, label, node, handleCtrlClick);
        } else {
            this._setupProtectedNodeHandlers(li, label, handleCtrlClick);
        }

        // Обработчик клика по всему элементу li
        this._setupLiClickHandler(li, label, handleCtrlClick);

        // Обработчик контекстного меню (правый клик)
        this._setupContextMenuHandler(li, node);
    }

    /**
     * Настраивает обработчики для редактируемых узлов
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {HTMLElement} label - Элемент метки
     * @param {Object} node - Данные узла
     * @param {Function} handleCtrlClick - Обработчик Ctrl+Click
     */
    _setupEditableNodeHandlers(li, label, node, handleCtrlClick) {
        let clickCount = 0;
        let clickTimer = null;

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
                ItemsTitleEditing.startEditingTreeNode(label, node, this.manager);
            }
        });

        label.style.cursor = 'pointer';
    }

    /**
     * Настраивает обработчики для защищенных узлов
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {HTMLElement} label - Элемент метки
     * @param {Function} handleCtrlClick - Обработчик Ctrl+Click
     */
    _setupProtectedNodeHandlers(li, label, handleCtrlClick) {
        label.addEventListener('click', (e) => {
            e.stopPropagation();

            if (e.ctrlKey || e.metaKey) {
                handleCtrlClick();
                return;
            }

            this.manager.selectNode(li);
        });
    }

    /**
     * Настраивает обработчик клика по элементу li
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {HTMLElement} label - Элемент метки
     * @param {Function} handleCtrlClick - Обработчик Ctrl+Click
     */
    _setupLiClickHandler(li, label, handleCtrlClick) {
        li.addEventListener('click', (e) => {
            // Игнорируем клики по служебным элементам
            const ignoredClasses = [
                'toggle-icon',
                'table-icon',
                'textblock-icon',
                'violation-icon'
            ];

            if (e.target === label || ignoredClasses.some(cls => e.target.classList.contains(cls))) {
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
    }

    /**
     * Настраивает обработчик контекстного меню
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {Object} node - Данные узла
     */
    _setupContextMenuHandler(li, node) {
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
