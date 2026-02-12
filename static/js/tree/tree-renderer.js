/**
 * Модуль рендеринга дерева элементов
 *
 * Отвечает за создание DOM-структуры дерева на основе данных из AppState.
 * Обрабатывает события взаимодействия с узлами.
 * Все константы вынесены в AppConfig для централизованного управления.
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
     *
     * Создает HTML-структуру дерева на основе данных из AppState.
     *
     * @param {Object} [node=AppState.treeData] - Корневой узел для отрисовки
     */
    render(node = AppState.treeData) {
        this.manager.container.innerHTML = '';
        const ul = this.createTreeElement(node);
        this.manager.container.appendChild(ul);
    }

    /**
     * Создание элемента списка для дерева
     *
     * Генерирует ul с дочерними элементами узла.
     *
     * @param {Object} node - Узел с дочерними элементами
     * @returns {HTMLUListElement} Элемент списка с деревом
     */
    createTreeElement(node) {
        const ul = document.createElement('ul');
        ul.className = 'tree';

        if (node.children?.length) {
            node.children.forEach(child => {
                ul.appendChild(this.createNodeElement(child));
            });
        }

        return ul;
    }

    /**
     * Создание элемента узла дерева
     *
     * Создает полный HTML-элемент узла со всеми обработчиками и иконками.
     *
     * @param {Object} node - Данные узла (id, label, type, children и т.д.)
     * @returns {HTMLLIElement} Готовый элемент узла дерева
     */
    createNodeElement(node) {
        const li = this._createBaseLiElement(node);

        // Добавляем элементы узла
        li.appendChild(this._createToggleIcon(node, li));
        li.appendChild(this._createLabel(node));
        this._addNodeTypeIcon(li, node.type);

        // Настраиваем обработчики
        this._setupNodeEventHandlers(li, node);

        // Рекурсивно создаем дочерние элементы
        if (node.children?.length) {
            li.appendChild(this._createChildrenContainer(node));
        }

        return li;
    }

    /**
     * Создает базовый li элемент с классами и атрибутами
     * @private
     * @param {Object} node - Данные узла
     * @returns {HTMLLIElement} Базовый элемент li
     */
    _createBaseLiElement(node) {
        const li = document.createElement('li');
        li.className = 'tree-item';
        li.dataset.nodeId = node.id;

        if (node.protected) {
            li.classList.add('protected');
        }

        this._addNodeTypeClass(li, node.type);

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

        const icons = AppConfig.tree.interaction.toggleIcons;
        toggle.textContent = node.children?.length > 0 ? icons.expanded : '';

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            li.classList.toggle('collapsed');
            toggle.textContent = li.classList.contains('collapsed')
                ? icons.collapsed
                : icons.expanded;
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
        label.contentEditable = false;

        const isContentType = ['table', 'textblock', 'violation'].includes(node.type);

        if (isContentType) {
            // Для content-типов: один span с customLabel или number
            label.textContent = node.customLabel || node.number || node.label;
        } else {
            // Для item-узлов: два span-а (номер + текст)
            if (node.number) {
                const numberSpan = document.createElement('span');
                numberSpan.className = 'tree-node-number';
                numberSpan.textContent = node.number + '. ';
                numberSpan.contentEditable = false;
                label.appendChild(numberSpan);
            }

            const textSpan = document.createElement('span');
            textSpan.className = 'tree-node-text';
            textSpan.textContent = node.label;
            label.appendChild(textSpan);

            // Бейдж ТБ для узлов под разделом 5
            if (TreeUtils.isUnderSection5(node)) {
                label.appendChild(this._createTbBadge(node));
            }

            // Бейдж фактуры для leaf-узлов под разделом 5
            if (TreeUtils.isTbLeaf(node) && node.invoice) {
                label.appendChild(this._createInvoiceBadge());
            }
        }

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
     * Добавляет иконку типа узла
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {string} type - Тип узла (table, textblock, violation)
     */
    _addNodeTypeIcon(li, type) {
        const config = AppConfig.tree.icons[type];
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
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {Object} node - Данные узла
     */
    _setupNodeEventHandlers(li, node) {
        const label = li.querySelector('.tree-label');
        const handleCtrlClick = () => this.manager.handleCtrlClick(node, li);

        // Обработчики для метки
        if (node.protected) {
            this._setupProtectedLabelHandlers(label, li, handleCtrlClick);
        } else {
            this._setupEditableLabelHandlers(label, li, node, handleCtrlClick);
        }

        // Обработчик для всего li
        this._setupLiClickHandler(li, label, handleCtrlClick);

        // Контекстное меню
        this._setupContextMenuHandler(li, node);
    }

    /**
     * Настраивает обработчики для редактируемых меток
     * @private
     * @param {HTMLElement} label - Элемент метки
     * @param {HTMLElement} li - Элемент узла
     * @param {Object} node - Данные узла
     * @param {Function} handleCtrlClick - Обработчик Ctrl+Click
     */
    _setupEditableLabelHandlers(label, li, node, handleCtrlClick) {
        let clickCount = 0;
        let clickTimer = null;
        const doubleClickDelay = AppConfig.tree.interaction.doubleClickDelay;

        label.addEventListener('click', (e) => {
            e.stopPropagation();

            // Игнорируем клики по нередактируемому номеру
            if (e.target.closest('.tree-node-number')) {
                this.manager.selectNode(li);
                return;
            }

            // Обработка Ctrl+Click
            if (e.ctrlKey || e.metaKey) {
                handleCtrlClick();
                return;
            }

            // Обработка двойного клика
            clickCount++;

            if (clickCount === 1) {
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                    this.manager.selectNode(li);
                }, doubleClickDelay);
            } else if (clickCount === 2) {
                clearTimeout(clickTimer);
                clickCount = 0;
                // Для item-узлов передаём .tree-node-text, для остальных — весь label
                const editTarget = label.querySelector('.tree-node-text') || label;
                ItemsTitleEditing.startEditingTreeNode(editTarget, node, this.manager);
            }
        });

        label.style.cursor = 'pointer';
    }

    /**
     * Настраивает обработчики для защищенных меток
     * @private
     * @param {HTMLElement} label - Элемент метки
     * @param {HTMLElement} li - Элемент узла
     * @param {Function} handleCtrlClick - Обработчик Ctrl+Click
     */
    _setupProtectedLabelHandlers(label, li, handleCtrlClick) {
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
            // Игнорируем клики по метке и служебным элементам
            if (e.target === label || e.target.closest('.tree-label') || this._isIgnoredElement(e.target)) {
                return;
            }

            e.stopPropagation();

            if (e.ctrlKey || e.metaKey) {
                handleCtrlClick();
                return;
            }

            this.manager.selectNode(li);
        });
    }

    /**
     * Проверяет, является ли элемент служебным (иконка)
     * @private
     * @param {HTMLElement} element - Проверяемый элемент
     * @returns {boolean} true если элемент служебный
     */
    _isIgnoredElement(element) {
        const ignoredClasses = AppConfig.tree.interaction.ignoredClickClasses;
        return ignoredClasses.some(cls => element.classList.contains(cls));
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

            this.manager.selectNode(li);
            ContextMenuManager.show(e.clientX, e.clientY, node.id, 'tree');
        });
    }

    /**
     * Создает бейдж ТБ для узла дерева
     * @private
     * @param {Object} node - Узел дерева
     * @returns {HTMLElement} Элемент бейджа
     */
    _createTbBadge(node) {
        const badge = document.createElement('span');
        badge.className = 'tb-badge';

        const isLeaf = TreeUtils.isTbLeaf(node);

        if (isLeaf) {
            const tbList = node.tb || [];
            if (tbList.length > 0) {
                badge.classList.add('tb-badge--assigned');
                badge.textContent = tbList.join(', ');
                badge.title = tbList.map(abbr => {
                    const bank = AppConfig.territorialBanks.find(b => b.abbr === abbr);
                    return bank ? `${bank.name} (${abbr})` : abbr;
                }).join(', ');
            } else {
                badge.classList.add('tb-badge--empty');
                badge.textContent = 'ТБ';
                badge.title = 'Назначить территориальный банк';
            }

            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                if (AppConfig.readOnlyMode?.isReadOnly) return;
                this._showTbDropdown(badge, node);
            });
        } else {
            const computed = TreeUtils.getComputedTb(node);
            if (computed.length > 0) {
                badge.classList.add('tb-badge--computed');
                badge.textContent = computed.join(', ');
                badge.title = 'Вычислено из дочерних пунктов: ' + computed.join(', ');
            } else {
                badge.classList.add('tb-badge--empty');
                badge.textContent = 'ТБ';
                badge.title = 'ТБ не назначен дочерним пунктам';
                badge.style.cursor = 'default';
            }
        }

        return badge;
    }

    /**
     * Создает бейдж фактуры
     * @private
     * @returns {HTMLElement} Элемент бейджа
     */
    _createInvoiceBadge() {
        const badge = document.createElement('span');
        badge.className = 'invoice-badge';
        badge.textContent = '📎';
        badge.title = 'Фактура прикреплена';
        badge.contentEditable = false;
        return badge;
    }

    /**
     * Показывает дропдаун для выбора ТБ
     * @private
     * @param {HTMLElement} badge - Элемент бейджа
     * @param {Object} node - Узел дерева
     */
    _showTbDropdown(badge, node) {
        // Закрываем предыдущий дропдаун если есть
        this._closeTbDropdown();

        const dropdown = document.createElement('div');
        dropdown.className = 'tb-dropdown';

        const currentTb = node.tb || [];

        AppConfig.territorialBanks.forEach(bank => {
            const item = document.createElement('label');
            item.className = 'tb-dropdown-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = currentTb.includes(bank.abbr);
            checkbox.addEventListener('change', () => {
                this._onTbCheckboxChange(node, bank.abbr, checkbox.checked);
                // Обновляем бейдж в дереве
                this._updateTbBadgeInTree(node);
                // Обновляем селектор на шаге 2 если виден
                this._syncTbToStep2(node);
            });

            const nameSpan = document.createElement('span');
            nameSpan.className = 'tb-dropdown-item-name';
            nameSpan.textContent = bank.name;

            const abbrSpan = document.createElement('span');
            abbrSpan.className = 'tb-dropdown-item-abbr';
            abbrSpan.textContent = bank.abbr;

            item.appendChild(checkbox);
            item.appendChild(nameSpan);
            item.appendChild(abbrSpan);
            dropdown.appendChild(item);
        });

        // Позиционируем дропдаун
        document.body.appendChild(dropdown);
        const rect = badge.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.left = `${rect.left}px`;

        // Корректируем позицию если выходит за экран
        const dropdownRect = dropdown.getBoundingClientRect();
        if (dropdownRect.right > window.innerWidth) {
            dropdown.style.left = `${window.innerWidth - dropdownRect.width - 8}px`;
        }
        if (dropdownRect.bottom > window.innerHeight) {
            dropdown.style.top = `${rect.top - dropdownRect.height - 4}px`;
        }

        // Закрытие при клике вне
        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== badge) {
                this._closeTbDropdown();
                document.removeEventListener('mousedown', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);

        this._currentTbDropdown = dropdown;
        this._currentTbDropdownCloseHandler = closeHandler;
    }

    /**
     * Закрывает текущий дропдаун ТБ
     * @private
     */
    _closeTbDropdown() {
        if (this._currentTbDropdown) {
            this._currentTbDropdown.remove();
            this._currentTbDropdown = null;
        }
        if (this._currentTbDropdownCloseHandler) {
            document.removeEventListener('mousedown', this._currentTbDropdownCloseHandler);
            this._currentTbDropdownCloseHandler = null;
        }
    }

    /**
     * Обработчик изменения чекбокса ТБ
     * @private
     * @param {Object} node - Узел дерева
     * @param {string} abbr - Аббревиатура банка
     * @param {boolean} checked - Выбран ли
     */
    _onTbCheckboxChange(node, abbr, checked) {
        if (!node.tb) node.tb = [];

        if (checked) {
            if (!node.tb.includes(abbr)) {
                node.tb.push(abbr);
            }
        } else {
            node.tb = node.tb.filter(t => t !== abbr);
        }

        // Помечаем изменения
        StorageManager.markAsUnsaved();
    }

    /**
     * Обновляет бейдж ТБ в дереве для узла и его родителей
     * @private
     * @param {Object} node - Узел дерева
     */
    _updateTbBadgeInTree(node) {
        // Обновляем бейдж текущего узла
        const li = this.manager.container.querySelector(`[data-node-id="${node.id}"]`);
        if (li) {
            const oldBadge = li.querySelector(':scope > .tree-label .tb-badge');
            if (oldBadge) {
                const newBadge = this._createTbBadge(node);
                oldBadge.replaceWith(newBadge);
            }
        }

        // Обновляем бейджи родительских узлов (computed TB)
        let parent = TreeUtils.findParentNode(node.id);
        while (parent && parent.id !== 'root') {
            if (TreeUtils.isUnderSection5(parent)) {
                const parentLi = this.manager.container.querySelector(`[data-node-id="${parent.id}"]`);
                if (parentLi) {
                    const parentBadge = parentLi.querySelector(':scope > .tree-label .tb-badge');
                    if (parentBadge) {
                        const newParentBadge = this._createTbBadge(parent);
                        parentBadge.replaceWith(newParentBadge);
                    }
                }
            }
            parent = TreeUtils.findParentNode(parent.id);
        }
    }

    /**
     * Синхронизирует изменения ТБ из дерева к шагу 2
     * @private
     * @param {Object} node - Узел дерева
     */
    _syncTbToStep2(node) {
        const itemBlock = document.querySelector(`.item-block[data-node-id="${node.id}"]`);
        if (!itemBlock) return;

        const oldSelector = itemBlock.querySelector(':scope > .item-header .tb-selector');
        if (oldSelector) {
            const newSelector = ItemsRenderer._createTbSelector(node);
            oldSelector.replaceWith(newSelector);
        }

        // Обновляем родительские TB-селекторы в items
        ItemsRenderer._updateParentTbInItems(node);
    }
}
