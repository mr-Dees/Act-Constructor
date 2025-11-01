/**
 * Универсальный менеджер контекстных меню
 *
 * Управляет всеми типами контекстных меню в приложении:
 * - Меню дерева элементов (добавление/удаление узлов)
 * - Меню ячеек таблицы (объединение/разъединение)
 * - Меню нарушений (добавление контента)
 *
 * @class ContextMenuManager
 */
class ContextMenuManager {
    /**
     * Основное контекстное меню для дерева элементов
     * @type {HTMLElement|null}
     * @static
     */
    static menu = null;

    /**
     * Контекстное меню для ячеек таблицы
     * @type {HTMLElement|null}
     * @static
     */
    static cellMenu = null;

    /**
     * Динамически созданное меню для нарушений
     * @type {HTMLElement|null}
     * @static
     */
    static violationMenu = null;

    /**
     * ID текущего узла дерева для контекстных операций
     * @type {string|null}
     * @static
     */
    static currentNodeId = null;

    /**
     * Тип активного меню
     * @type {string|null}
     * @static
     */
    static activeMenuType = null;

    /**
     * Инициализация менеджера контекстных меню
     *
     * Выполняет:
     * - Получение элементов меню из DOM
     * - Привязку глобальных обработчиков
     * - Настройку обработчиков для пунктов меню
     *
     * @static
     * @returns {void}
     */
    static init() {
        // Получаем основные меню из HTML
        this.menu = document.getElementById('contextMenu');
        this.cellMenu = document.getElementById('cellContextMenu');

        // Добавляем глобальный обработчик для закрытия меню при клике вне его
        document.addEventListener('click', (e) => {
            // Если клик не по контекстному меню - закрываем все меню
            if (!e.target.closest('.context-menu') &&
                !e.target.closest('.violation-context-menu')) {
                this.hide();
            }
        });

        // Инициализируем обработчики для основного меню дерева
        this.menu?.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.handleTreeAction(action);
                this.hide();
            });
        });

        // Инициализируем обработчики для меню ячеек таблицы
        this.cellMenu?.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;

                // Игнорируем заблокированные пункты
                if (item.classList.contains('disabled')) return;

                this.handleCellAction(action);
                this.hide();
            });
        });
    }

    /**
     * Показывает контекстное меню указанного типа
     *
     * @static
     * @param {number} x - Координата X (в пикселях от левого края экрана)
     * @param {number} y - Координата Y (в пикселях от верхнего края экрана)
     * @param {string|null} nodeId - ID узла дерева (для меню 'tree' и 'cell')
     * @param {string} type - Тип меню: 'tree', 'cell', 'violation'
     * @param {Object} [options={}] - Дополнительные опции для специфичных меню
     * @param {Object} [options.violation] - Объект нарушения (для type='violation')
     * @param {HTMLElement} [options.contentContainer] - Контейнер содержимого (для type='violation')
     * @param {string|null} [options.itemId] - ID элемента для удаления (для type='violation')
     * @param {number} [options.insertPosition] - Позиция для вставки (для type='violation')
     * @returns {void}
     */
    static show(x, y, nodeId, type, options = {}) {
        // Сначала скрываем все активные меню
        this.hide();

        this.currentNodeId = nodeId;
        this.activeMenuType = type;

        // Выбираем нужный тип меню
        switch (type) {
            case 'tree':
                this.showTreeMenu(x, y, nodeId);
                break;
            case 'cell':
                this.showCellMenu(x, y, nodeId);
                break;
            case 'violation':
                this.showViolationMenu(x, y, options);
                break;
        }
    }

    /**
     * Показывает контекстное меню дерева элементов
     *
     * @static
     * @private
     * @param {number} x - Координата X
     * @param {number} y - Координата Y
     * @param {string} nodeId - ID узла дерева
     * @returns {void}
     */
    static showTreeMenu(x, y, nodeId) {
        if (!this.menu) return;

        this.positionMenu(this.menu, x, y);
    }

    /**
     * Показывает контекстное меню для ячеек таблицы
     *
     * Автоматически обновляет доступность пунктов меню в зависимости от:
     * - Количества выбранных ячеек
     * - Состояния объединения ячеек
     *
     * @static
     * @private
     * @param {number} x - Координата X
     * @param {number} y - Координата Y
     * @param {string} nodeId - ID узла (не используется для ячеек)
     * @returns {void}
     */
    static showCellMenu(x, y, nodeId) {
        if (!this.cellMenu) return;

        // Обновляем состояние пунктов меню в зависимости от выбранных ячеек
        const selectedCellsCount = tableManager.selectedCells.length;
        const mergeCellsItem = this.cellMenu.querySelector('[data-action="merge-cells"]');
        const unmergeCellItem = this.cellMenu.querySelector('[data-action="unmerge-cell"]');

        // Управляем доступностью пункта "Объединить ячейки"
        // Доступен только при выборе 2+ ячеек
        if (mergeCellsItem) {
            if (selectedCellsCount >= 2) {
                mergeCellsItem.classList.remove('disabled');
            } else {
                mergeCellsItem.classList.add('disabled');
            }
        }

        // Управляем доступностью пункта "Разъединить ячейку"
        // Доступен только для одной выбранной объединенной ячейки
        if (unmergeCellItem) {
            if (selectedCellsCount === 1) {
                const cell = tableManager.selectedCells[0];
                const isMerged = cell.colSpan > 1 || cell.rowSpan > 1;

                if (isMerged) {
                    unmergeCellItem.classList.remove('disabled');
                } else {
                    unmergeCellItem.classList.add('disabled');
                }
            } else {
                unmergeCellItem.classList.add('disabled');
            }
        }

        this.positionMenu(this.cellMenu, x, y);
    }

    /**
     * Показывает контекстное меню для нарушений
     *
     * Создает динамическое меню с пунктами:
     * - Добавление кейса
     * - Добавление изображения
     * - Добавление текста
     * - Удаление элемента (если клик по элементу)
     *
     * @static
     * @private
     * @param {number} x - Координата X
     * @param {number} y - Координата Y
     * @param {Object} options - Опции для меню нарушений
     * @param {Object} options.violation - Объект нарушения
     * @param {HTMLElement} options.contentContainer - Контейнер содержимого
     * @param {string|null} [options.itemId=null] - ID элемента для удаления
     * @param {number} [options.insertPosition=0] - Позиция для вставки новых элементов
     * @returns {void}
     */
    static showViolationMenu(x, y, options = {}) {
        const {
            violation,
            contentContainer,
            itemId = null,
            insertPosition = 0
        } = options;

        // Удаляем существующее меню нарушений, если есть
        const existingMenu = document.querySelector('.violation-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // Создаем новое меню
        const menu = this.createViolationMenu(violation, contentContainer, itemId, insertPosition);

        // Позиционируем меню
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        document.body.appendChild(menu);

        // Корректируем позицию, чтобы меню не выходило за границы экрана
        setTimeout(() => {
            const menuRect = menu.getBoundingClientRect();
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

            let finalX = x;
            let finalY = y;

            // Проверяем выход за правый край
            if (finalX + menuRect.width > viewportWidth) {
                finalX = x - menuRect.width;
            }
            if (finalX < 0) finalX = 10;

            // Проверяем выход за нижний край
            if (finalY + menuRect.height > viewportHeight) {
                finalY = y - menuRect.height;
            }
            if (finalY < 0) finalY = 10;

            menu.style.left = `${finalX}px`;
            menu.style.top = `${finalY}px`;
        }, 1);

        this.violationMenu = menu;
    }

    /**
     * Создает DOM-элемент контекстного меню для нарушений
     *
     * @static
     * @private
     * @param {Object} violation - Объект нарушения
     * @param {HTMLElement} contentContainer - Контейнер содержимого
     * @param {string|null} itemId - ID элемента для удаления (null если добавление)
     * @param {number} insertPosition - Позиция для вставки новых элементов
     * @returns {HTMLElement} DOM-элемент меню
     */
    static createViolationMenu(violation, contentContainer, itemId, insertPosition) {
        const menu = document.createElement('div');
        menu.className = 'violation-context-menu';
        menu.style.cssText = `
            position: fixed;
            background: white;
            border: 1px solid var(--border, #e0e0e0);
            border-radius: var(--radius, 4px);
            box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.15));
            z-index: 10000;
            min-width: 200px;
            padding: 4px 0;
            font-family: inherit;
        `;

        // Пункты меню для добавления элементов
        const addMenuItems = [
            {label: '📝 Добавить кейс', action: 'case', type: 'add'},
            {label: '🖼️ Добавить изображение', action: 'image', type: 'add'},
            {label: '📄 Добавить текст', action: 'text', type: 'add'}
        ];

        // Добавляем пункты для добавления
        addMenuItems.forEach(item => {
            const menuItem = this.createViolationMenuItem(item.label, () => {
                this.handleViolationAction(violation, item.action, contentContainer, insertPosition);
                menu.remove();
            });
            menu.appendChild(menuItem);
        });

        // Если клик был по элементу, добавляем разделитель и опцию удаления
        if (itemId !== null) {
            // Разделитель
            const separator = document.createElement('div');
            separator.style.cssText = `
                height: 1px;
                background-color: var(--border, #e0e0e0);
                margin: 4px 0;
            `;
            menu.appendChild(separator);

            // Пункт удаления
            const deleteItem = this.createViolationMenuItem('🗑️ Удалить', () => {
                this.handleViolationDelete(violation, itemId, contentContainer);
                menu.remove();
            }, true);
            menu.appendChild(deleteItem);
        }

        return menu;
    }

    /**
     * Создает элемент пункта меню для нарушений
     *
     * @static
     * @private
     * @param {string} label - Текст пункта меню
     * @param {Function} clickHandler - Обработчик клика
     * @param {boolean} [isDanger=false] - Флаг опасного действия (красный цвет)
     * @returns {HTMLElement} DOM-элемент пункта меню
     */
    static createViolationMenuItem(label, clickHandler, isDanger = false) {
        const menuItem = document.createElement('div');
        menuItem.className = 'violation-context-menu-item';
        menuItem.textContent = label;

        const dangerColor = isDanger ? 'color: var(--danger, #dc3545);' : '';
        menuItem.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            transition: background-color 0.2s;
            font-size: 0.875rem;
            ${dangerColor}
        `;

        // Hover эффект
        menuItem.addEventListener('mouseenter', () => {
            const bgColor = isDanger
                ? 'rgba(220, 53, 69, 0.1)'
                : 'var(--primary-subtle, #f0f0f0)';
            menuItem.style.backgroundColor = bgColor;
        });

        menuItem.addEventListener('mouseleave', () => {
            menuItem.style.backgroundColor = 'transparent';
        });

        menuItem.addEventListener('click', (e) => {
            e.stopPropagation();
            clickHandler();
        });

        return menuItem;
    }

    /**
     * Позиционирует меню с учетом границ экрана
     *
     * Автоматически корректирует позицию меню, чтобы оно:
     * - Не выходило за правый край экрана
     * - Не выходило за нижний край экрана
     * - Оставалось видимым с отступом 10px от краев
     *
     * @static
     * @private
     * @param {HTMLElement} menu - DOM-элемент меню
     * @param {number} x - Начальная координата X
     * @param {number} y - Начальная координата Y
     * @returns {void}
     */
    static positionMenu(menu, x, y) {
        if (!menu) return;

        // Временно позиционируем за пределами экрана для измерения размеров
        menu.style.left = '-9999px';
        menu.style.top = '-9999px';
        menu.classList.remove('hidden');

        // Ждем отрисовки для получения реальных размеров
        setTimeout(() => {
            const menuRect = menu.getBoundingClientRect();
            const menuWidth = menuRect.width;
            const menuHeight = menuRect.height;
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

            let finalX = x;
            let finalY = y;

            // Корректируем позицию по горизонтали
            if (finalX + menuWidth > viewportWidth) {
                finalX = x - menuWidth; // Показываем слева от курсора
            }
            if (finalX < 0) finalX = 10; // Минимальный отступ от левого края

            // Корректируем позицию по вертикали
            if (finalY + menuHeight > viewportHeight) {
                finalY = y - menuHeight; // Показываем выше курсора
            }
            if (finalY < 0) finalY = 10; // Минимальный отступ от верхнего края

            menu.style.left = `${finalX}px`;
            menu.style.top = `${finalY}px`;
        }, 1);
    }

    /**
     * Скрывает все активные контекстные меню
     *
     * @static
     * @returns {void}
     */
    static hide() {
        // Скрываем основное меню дерева
        if (this.menu) {
            this.menu.classList.add('hidden');
        }

        // Скрываем меню ячеек таблицы
        if (this.cellMenu) {
            this.cellMenu.classList.add('hidden');
        }

        // Удаляем динамически созданные меню нарушений
        const violationMenus = document.querySelectorAll('.violation-context-menu');
        violationMenus.forEach(menu => menu.remove());

        this.violationMenu = null;
        this.activeMenuType = null;
    }

    /**
     * Обрабатывает действия контекстного меню дерева элементов
     *
     * Поддерживаемые действия:
     * - add-child: Добавление дочернего элемента
     * - add-sibling: Добавление соседнего элемента
     * - add-table: Добавление таблицы
     * - add-textblock: Добавление текстового блока
     * - add-violation: Добавление нарушения
     * - delete: Удаление элемента
     *
     * @static
     * @param {string} action - Тип действия
     * @returns {void}
     */
    static handleTreeAction(action) {
        const nodeId = this.currentNodeId;
        if (!nodeId) return;

        const node = AppState.findNodeById(nodeId);
        if (!node) return;

        switch (action) {
            case 'add-child':
                // Таблицы не могут иметь дочерних элементов
                if (node.type === 'table') {
                    alert('Нельзя добавлять дочерние элементы к таблице');
                    return;
                }

                const childResult = AppState.addNode(nodeId, '', true);
                if (childResult.success) {
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert(childResult.reason);
                }
                break;

            case 'add-sibling':
                const siblingResult = AppState.addNode(nodeId, '', false);
                if (siblingResult.success) {
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert(siblingResult.reason);
                }
                break;

            case 'add-table':
                // Таблицы не могут быть добавлены к таблицам
                if (node.type === 'table') {
                    alert('Нельзя добавлять таблицу к таблице');
                    return;
                }

                const tableResult = AppState.addTableToNode(nodeId);
                if (tableResult.success) {
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert(tableResult.reason);
                }
                break;

            case 'add-textblock':
                // Текстовые блоки нельзя добавить к таблицам и текстовым блокам
                if (node.type === 'table' || node.type === 'textblock') {
                    alert('Нельзя добавлять текстовый блок к этому элементу');
                    return;
                }

                const textBlockResult = AppState.addTextBlockToNode(nodeId);
                if (textBlockResult.success) {
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert(textBlockResult.reason);
                }
                break;

            case 'add-violation':
                // Нарушения нельзя добавить к таблицам, текстовым блокам и нарушениям
                if (node.type === 'table' || node.type === 'textblock' || node.type === 'violation') {
                    alert('Нельзя добавлять нарушение к этому элементу');
                    return;
                }

                const violationResult = AppState.addViolationToNode(nodeId);
                if (violationResult.success) {
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert(violationResult.reason);
                }
                break;

            case 'delete':
                // Защищенные элементы нельзя удалить
                if (node.protected) {
                    alert('Нельзя удалить защищенный элемент');
                    return;
                }

                if (confirm('Удалить этот элемент?')) {
                    AppState.deleteNode(nodeId);
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                }
                break;
        }
    }

    /**
     * Обрабатывает действия контекстного меню ячеек таблицы
     *
     * Поддерживаемые действия:
     * - merge-cells: Объединение выбранных ячеек
     * - unmerge-cell: Разъединение объединенной ячейки
     *
     * При выполнении операций сохраняет и восстанавливает размеры таблиц
     *
     * @static
     * @param {string} action - Тип действия
     * @returns {void}
     */
    static handleCellAction(action) {
        let tableSizes = {};

        // Сохраняем текущие размеры таблицы перед операцией
        if (tableManager.selectedCells.length > 0) {
            const table = tableManager.selectedCells[0].closest('table');
            tableSizes = tableManager.preserveTableSizes(table);
        }

        switch (action) {
            case 'merge-cells':
                tableManager.mergeCells();

                if (AppState.currentStep === 2) {
                    ItemsRenderer.renderAll();

                    // Восстанавливаем размеры таблиц после рендера
                    setTimeout(() => {
                        const tables = document.querySelectorAll('.editable-table');
                        tables.forEach(tbl => {
                            tableManager.applyTableSizes(tbl, tableSizes);
                            const section = tbl.closest('.table-section');
                            if (section) {
                                tableManager.persistTableSizes(section.dataset.tableId, tbl);
                            }
                        });
                    }, 50);
                } else {
                    tableManager.renderAll();
                    PreviewManager.update('previewTrim', 30);
                }
                break;

            case 'unmerge-cell':
                tableManager.unmergeCells();

                if (AppState.currentStep === 2) {
                    ItemsRenderer.renderAll();

                    // Восстанавливаем размеры таблиц после рендера
                    setTimeout(() => {
                        const tables = document.querySelectorAll('.editable-table');
                        tables.forEach(tbl => {
                            tableManager.applyTableSizes(tbl, tableSizes);
                            const section = tbl.closest('.table-section');
                            if (section) {
                                tableManager.persistTableSizes(section.dataset.tableId, tbl);
                            }
                        });
                    }, 50);
                } else {
                    tableManager.renderAll();
                    PreviewManager.update('previewTrim', 30);
                }
                break;
        }
    }

    /**
     * Обрабатывает действия добавления элементов в нарушения
     *
     * @static
     * @param {Object} violation - Объект нарушения
     * @param {string} action - Тип действия ('case', 'image', 'text')
     * @param {HTMLElement} contentContainer - Контейнер содержимого
     * @param {number} insertPosition - Позиция для вставки элемента
     * @returns {void}
     */
    static handleViolationAction(violation, action, contentContainer, insertPosition) {
        if (!violation || !contentContainer) return;

        switch (action) {
            case 'case':
                // Добавление кейса
                if (typeof violationManager !== 'undefined' && violationManager.addContentItemAtPosition) {
                    violationManager.addContentItemAtPosition(violation, 'case', contentContainer, insertPosition);
                }
                break;

            case 'image':
                // Добавление изображения
                if (typeof violationManager !== 'undefined' && violationManager.triggerImageUploadAtPosition) {
                    violationManager.triggerImageUploadAtPosition(violation, contentContainer, insertPosition);
                }
                break;

            case 'text':
                // Добавление произвольного текста
                if (typeof violationManager !== 'undefined' && violationManager.addContentItemAtPosition) {
                    violationManager.addContentItemAtPosition(violation, 'freeText', contentContainer, insertPosition);
                }
                break;
        }
    }

    /**
     * Обрабатывает удаление элемента из нарушения
     *
     * Выполняет:
     * - Поиск элемента по ID
     * - Удаление из массива
     * - Обновление порядка оставшихся элементов
     * - Перерисовку интерфейса
     *
     * @static
     * @param {Object} violation - Объект нарушения
     * @param {string} itemId - ID элемента для удаления
     * @param {HTMLElement} contentContainer - Контейнер содержимого
     * @returns {void}
     */
    static handleViolationDelete(violation, itemId, contentContainer) {
        if (!violation || !itemId || !contentContainer) return;

        // Находим элемент по ID и удаляем его
        const itemIndex = violation.additionalContent.items.findIndex(item => item.id === itemId);
        if (itemIndex !== -1) {
            violation.additionalContent.items.splice(itemIndex, 1);

            // Обновляем order для всех оставшихся элементов
            violation.additionalContent.items.forEach((item, idx) => {
                item.order = idx;
            });

            // Обновляем отображение
            const itemsContainer = contentContainer.querySelector('.additional-content-items');
            if (itemsContainer && typeof violationManager !== 'undefined' && violationManager.renderContentItems) {
                violationManager.renderContentItems(violation, itemsContainer);
            }

            // Обновляем превью
            if (typeof PreviewManager !== 'undefined') {
                PreviewManager.update();
            }
        }
    }
}
