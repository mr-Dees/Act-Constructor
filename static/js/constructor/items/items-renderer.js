/**
 * Менеджер отрисовки элементов.
 * Координирует рендеринг всех типов элементов документа: обычных пунктов,
 * таблиц, текстовых блоков и нарушений. Обеспечивает синхронизацию данных
 * между DOM и глобальным состоянием приложения.
 */
class ItemsRenderer {
    /**
     * Полная отрисовка всех элементов из дерева документа в контейнер.
     * Очищает предыдущее содержимое, рендерит структуру заново,
     * привязывает события и восстанавливает сохраненные размеры таблиц.
     */
    static renderAll() {
        const container = document.getElementById('itemsContainer');
        if (!container) return;

        container.innerHTML = '';
        tableManager.clearSelection();

        if (AppState.treeData?.children) {
            AppState.treeData.children.forEach(item => {
                container.appendChild(this.renderItem(item, 1));
            });
        }

        tableManager.attachEventListeners();
        this._restoreTableSizes();
    }

    /**
     * Восстанавливает персистентные размеры ячеек таблиц после рендеринга DOM.
     * Выполняется асинхронно для гарантии завершения отрисовки.
     * @private
     */
    static _restoreTableSizes() {
        setTimeout(() => {
            document.querySelectorAll('.table-section').forEach(section => {
                const tableId = section.dataset.tableId;
                const tableEl = section.querySelector('.editable-table');
                tableManager.applyPersistedSizes(tableId, tableEl);
            });
        }, 0);
    }

    /**
     * Рекурсивная отрисовка элемента дерева с обработкой различных типов узлов.
     * Создает соответствующий DOM-элемент в зависимости от типа: обычный пункт,
     * таблица, текстовый блок или нарушение.
     * @param {Object} node - Узел дерева для отрисовки
     * @param {number} level - Уровень вложенности (определяет размер заголовка)
     * @returns {HTMLElement} Созданный DOM-элемент с содержимым узла
     */
    static renderItem(node, level) {
        const itemDiv = this._createItemContainer(node, level);

        // Проверяем специальные типы узлов
        if (node.type === 'table') {
            const table = AppState.tables[node.tableId];
            if (table) {
                itemDiv.appendChild(this.renderTable(table, node));
            }
            return itemDiv;
        }

        if (node.type === 'textblock') {
            const textBlock = AppState.textBlocks[node.textBlockId];
            if (textBlock) {
                itemDiv.appendChild(textBlockManager.createTextBlockElement(textBlock, node));
            }
            return itemDiv;
        }

        if (node.type === 'violation') {
            const violation = AppState.violations[node.violationId];
            if (violation) {
                itemDiv.appendChild(violationManager.createViolationElement(violation, node));
            }
            return itemDiv;
        }

        // Отрисовка обычного пункта
        this._renderRegularItem(itemDiv, node, level);
        return itemDiv;
    }

    /**
     * Создает базовый контейнер для элемента с идентификаторами.
     * @param {Object} node - Узел дерева
     * @param {number} level - Уровень вложенности
     * @returns {HTMLElement} Контейнер элемента
     * @private
     */
    static _createItemContainer(node, level) {
        const itemDiv = document.createElement('div');
        itemDiv.className = `item-block level-${level}`;
        itemDiv.dataset.nodeId = node.id;
        return itemDiv;
    }

    /**
     * Отрисовка обычного пункта документа с заголовком и дочерними элементами.
     * @param {HTMLElement} itemDiv - Контейнер элемента
     * @param {Object} node - Узел дерева
     * @param {number} level - Уровень вложенности
     * @private
     */
    static _renderRegularItem(itemDiv, node, level) {
        const header = this._createItemHeader(node, level);
        itemDiv.appendChild(header);

        if (node.children?.length > 0) {
            itemDiv.appendChild(this._renderChildren(node.children, level));
        }
    }

    /**
     * Создает заголовок пункта с возможностью редактирования.
     * Для незащищенных элементов добавляет обработчик двойного клика.
     * @param {Object} node - Узел дерева
     * @param {number} level - Уровень вложенности
     * @returns {HTMLElement} Заголовок пункта
     * @private
     */
    static _createItemHeader(node, level) {
        const header = document.createElement('div');
        header.className = 'item-header';

        const title = document.createElement(`h${Math.min(level + 1, 6)}`);
        title.className = 'item-title';

        // Номер — нередактируемый
        if (node.number) {
            const numberSpan = document.createElement('span');
            numberSpan.className = 'item-number';
            numberSpan.textContent = node.number + '. ';
            title.appendChild(numberSpan);
        }

        // Текст заголовка — редактируемый
        const textSpan = document.createElement('span');
        textSpan.className = 'item-title-text';
        textSpan.textContent = node.label;
        title.appendChild(textSpan);

        if (!node.protected) {
            this._setupTitleEditing(textSpan, node);
        }

        header.appendChild(title);

        // Селектор ТБ для узлов под разделом 5
        if (TreeUtils.isUnderSection5(node)) {
            header.appendChild(this._createTbSelector(node));
        }

        return header;
    }

    /**
     * Настраивает редактирование заголовка по двойному клику.
     * Использует таймер для определения двойного клика (300мс).
     * @param {HTMLElement} title - Элемент заголовка
     * @param {Object} node - Узел дерева
     * @private
     */
    static _setupTitleEditing(textSpan, node) {
        let clickCount = 0;
        let clickTimer = null;

        textSpan.addEventListener('click', () => {
            clickCount++;

            if (clickCount === 1) {
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300);
            } else if (clickCount === 2) {
                clearTimeout(clickTimer);
                clickCount = 0;
                ItemsTitleEditing.startEditingItemTitle(textSpan, node);
            }
        });

        textSpan.style.cursor = 'pointer';
    }

    /**
     * Создает селектор ТБ для узла на Шаге 2
     * @param {Object} node - Узел дерева
     * @returns {HTMLElement} Контейнер с селектором ТБ
     * @private
     */
    static _createTbSelector(node) {
        const container = document.createElement('div');
        container.className = 'tb-selector';

        const label = document.createElement('span');
        label.className = 'tb-selector-label';
        label.textContent = 'ТБ:';
        container.appendChild(label);

        const isLeaf = TreeUtils.isTbLeaf(node);

        if (isLeaf) {
            // Кликабельный бейдж (аналогично tree-renderer)
            const badge = document.createElement('span');
            const tbList = node.tb || [];

            if (tbList.length > 0) {
                badge.className = 'tb-selector-badge tb-selector-badge--assigned';
                badge.textContent = tbList.join(', ');
                badge.title = tbList.map(abbr => {
                    const bank = AppConfig.territorialBanks.find(b => b.abbr === abbr);
                    return bank ? `${bank.name} (${abbr})` : abbr;
                }).join(', ');
            } else {
                badge.className = 'tb-selector-badge tb-selector-badge--empty';
                badge.textContent = 'Выбрать';
                badge.title = 'Назначить территориальный банк';
            }

            if (!AppConfig.readOnlyMode?.isReadOnly) {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._showTbDropdownInItems(badge, node);
                });
            }

            container.appendChild(badge);
        } else {
            // Read-only для не-leaf: показываем вычисленные ТБ
            const computed = TreeUtils.getComputedTb(node);
            if (computed.length > 0) {
                const badgesContainer = document.createElement('div');
                badgesContainer.className = 'tb-selector-badges';

                computed.forEach(abbr => {
                    const b = document.createElement('span');
                    b.className = 'tb-selector-badge tb-selector-badge--computed';
                    b.textContent = abbr;
                    const bank = AppConfig.territorialBanks.find(x => x.abbr === abbr);
                    if (bank) b.title = bank.name;
                    badgesContainer.appendChild(b);
                });

                container.appendChild(badgesContainer);
            } else {
                const empty = document.createElement('span');
                empty.className = 'tb-selector-empty';
                empty.textContent = 'не назначен';
                container.appendChild(empty);
            }
        }

        return container;
    }

    /**
     * Показывает дропдаун для выбора ТБ на Шаге 2
     * @param {HTMLElement} badge - Элемент бейджа
     * @param {Object} node - Узел дерева
     * @private
     */
    static _showTbDropdownInItems(badge, node) {
        // Закрываем предыдущий дропдаун
        this._closeTbDropdownInItems();

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
                // Обновляем node.tb
                if (!node.tb) node.tb = [];
                if (checkbox.checked) {
                    if (!node.tb.includes(bank.abbr)) node.tb.push(bank.abbr);
                } else {
                    node.tb = node.tb.filter(t => t !== bank.abbr);
                }

                StorageManager.markAsUnsaved();

                // Обновляем бейдж в items
                this._updateTbBadgeInItems(badge, node);
                // Обновляем бейджи родителей в items
                this._updateParentTbInItems(node);
                // Перерисовываем дерево
                treeManager.render();
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

        document.body.appendChild(dropdown);
        const rect = badge.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.left = `${rect.left}px`;

        // Корректировка позиции
        const dRect = dropdown.getBoundingClientRect();
        if (dRect.right > window.innerWidth) {
            dropdown.style.left = `${window.innerWidth - dRect.width - 8}px`;
        }
        if (dRect.bottom > window.innerHeight) {
            dropdown.style.top = `${rect.top - dRect.height - 4}px`;
        }

        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== badge) {
                this._closeTbDropdownInItems();
                document.removeEventListener('mousedown', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);

        this._currentTbDropdown = dropdown;
        this._currentTbCloseHandler = closeHandler;
    }

    /**
     * Закрывает текущий дропдаун ТБ на Шаге 2
     * @private
     */
    static _closeTbDropdownInItems() {
        if (this._currentTbDropdown) {
            this._currentTbDropdown.remove();
            this._currentTbDropdown = null;
        }
        if (this._currentTbCloseHandler) {
            document.removeEventListener('mousedown', this._currentTbCloseHandler);
            this._currentTbCloseHandler = null;
        }
    }

    /**
     * Обновляет бейдж ТБ на Шаге 2 после изменения
     * @param {HTMLElement} badge - Элемент бейджа
     * @param {Object} node - Узел дерева
     * @private
     */
    static _updateTbBadgeInItems(badge, node) {
        const tbList = node.tb || [];
        if (tbList.length > 0) {
            badge.className = 'tb-selector-badge tb-selector-badge--assigned';
            badge.textContent = tbList.join(', ');
            badge.title = tbList.map(abbr => {
                const bank = AppConfig.territorialBanks.find(b => b.abbr === abbr);
                return bank ? `${bank.name} (${abbr})` : abbr;
            }).join(', ');
        } else {
            badge.className = 'tb-selector-badge tb-selector-badge--empty';
            badge.textContent = 'Выбрать';
            badge.title = 'Назначить территориальный банк';
        }
    }

    /**
     * Обновляет TB-селекторы родительских узлов на Шаге 2
     * @param {Object} node - Узел дерева
     * @private
     */
    static _updateParentTbInItems(node) {
        let parent = TreeUtils.findParentNode(node.id);
        while (parent && parent.id !== 'root') {
            if (TreeUtils.isUnderSection5(parent)) {
                const parentBlock = document.querySelector(`.item-block[data-node-id="${parent.id}"]`);
                if (parentBlock) {
                    const oldSelector = parentBlock.querySelector(':scope > .item-header .tb-selector');
                    if (oldSelector) {
                        const newSelector = this._createTbSelector(parent);
                        oldSelector.replaceWith(newSelector);
                    }
                }
            }
            parent = TreeUtils.findParentNode(parent.id);
        }
    }

    /**
     * Рекурсивная отрисовка дочерних элементов.
     * Для таблиц, текстовых блоков и нарушений не увеличивает уровень вложенности.
     * @param {Array} children - Массив дочерних узлов
     * @param {number} parentLevel - Уровень родительского элемента
     * @returns {HTMLElement} Контейнер с дочерними элементами
     * @private
     */
    static _renderChildren(children, parentLevel) {
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'item-children';

        const specialTypes = new Set(['table', 'textblock', 'violation']);

        children.forEach(child => {
            const childLevel = specialTypes.has(child.type) ? parentLevel : parentLevel + 1;
            childrenDiv.appendChild(this.renderItem(child, childLevel));
        });

        return childrenDiv;
    }

    /**
     * Визуализация таблицы для документа.
     * Создает секцию с заголовком (если есть customLabel) и саму таблицу.
     * @param {Object} table - Данные таблицы из AppState.tables
     * @param {Object} node - Узел дерева таблицы
     * @returns {HTMLElement} Блок секции таблицы
     */
    static renderTable(table, node) {
        const section = document.createElement('div');
        section.className = 'table-section';
        section.dataset.tableId = table.id;

        // Показываем заголовок только если есть customLabel
        if (node.customLabel !== '') {
            section.appendChild(this._createTableTitle(table, node));
        }

        section.appendChild(this._createTableElement(table));
        return section;
    }

    /**
     * Создает заголовок таблицы с возможностью редактирования.
     * Для защищенных таблиц показывает уведомление при попытке редактирования.
     * @param {Object} table - Данные таблицы
     * @param {Object} node - Узел дерева таблицы
     * @returns {HTMLElement} Заголовок таблицы
     * @private
     */
    static _createTableTitle(table, node) {
        const tableTitle = document.createElement('h4');
        tableTitle.className = 'table-title';
        tableTitle.contentEditable = false;
        tableTitle.textContent = node.customLabel || node.number || node.label;

        // Применяем стили
        Object.assign(tableTitle.style, {
            marginBottom: '10px',
            fontWeight: 'normal',
            textDecoration: 'underline',
            cursor: table.protected ? 'default' : 'pointer'
        });

        if (!table.protected) {
            this._setupTableTitleEditing(tableTitle, node);
        } else {
            tableTitle.addEventListener('click', () => {
                Notifications.info('Название защищенной таблицы нельзя редактировать');
            });
        }

        return tableTitle;
    }

    /**
     * Настраивает редактирование заголовка таблицы по двойному клику.
     * @param {HTMLElement} tableTitle - Элемент заголовка таблицы
     * @param {Object} node - Узел дерева таблицы
     * @private
     */
    static _setupTableTitleEditing(tableTitle, node) {
        let clickCount = 0;
        let clickTimer = null;

        tableTitle.addEventListener('click', () => {
            clickCount++;

            if (clickCount === 1) {
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300);
            } else if (clickCount === 2) {
                clearTimeout(clickTimer);
                clickCount = 0;
                ItemsTitleEditing.startEditingTableTitle(tableTitle, node);
            }
        });
    }

    /**
     * Создает DOM-элемент таблицы со всеми строками и ячейками.
     * Применяет стили для защищенных таблиц.
     * @param {Object} table - Данные таблицы
     * @returns {HTMLElement} Элемент <table>
     * @private
     */
    static _createTableElement(table) {
        const tableEl = document.createElement('table');
        tableEl.className = 'editable-table';

        if (table.protected) {
            tableEl.classList.add('protected-table');
        }

        // Проверяем наличие grid
        if (!table.grid || table.grid.length === 0) {
            // Создаем пустую таблицу-заглушку
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.textContent = '[Пустая таблица]';
            td.style.padding = '10px';
            td.style.color = '#999';
            td.style.fontStyle = 'italic';
            tr.appendChild(td);
            tableEl.appendChild(tr);
            return tableEl;
        }

        const numCols = table.grid[0]?.length || 0;

        table.grid.forEach((rowData, rowIndex) => {
            const tr = this._createTableRow(rowData, rowIndex, table.id, numCols);
            tableEl.appendChild(tr);
        });

        return tableEl;
    }

    /**
     * Создает строку таблицы со всеми ячейками.
     * Пропускает поглощенные ячейки (isSpanned).
     * @param {Array} rowData - Данные строки (массив ячеек)
     * @param {number} rowIndex - Индекс строки
     * @param {string} tableId - ID таблицы
     * @param {number} numCols - Общее количество колонок
     * @returns {HTMLElement} Элемент <tr>
     * @private
     */
    static _createTableRow(rowData, rowIndex, tableId, numCols) {
        const tr = document.createElement('tr');

        rowData.forEach((cellData, colIndex) => {
            if (cellData.isSpanned) return;

            const cellEl = this._createTableCell(cellData, rowIndex, colIndex, tableId, numCols);
            tr.appendChild(cellEl);
        });

        return tr;
    }

    /**
     * Создает ячейку таблицы с обработчиками изменения размера.
     * Добавляет хендлы для изменения ширины колонок и высоты строк.
     * @param {Object} cellData - Данные ячейки
     * @param {number} rowIndex - Индекс строки
     * @param {number} colIndex - Индекс колонки
     * @param {string} tableId - ID таблицы
     * @param {number} numCols - Общее количество колонок
     * @returns {HTMLElement} Элемент <td> или <th>
     * @private
     */
    static _createTableCell(cellData, rowIndex, colIndex, tableId, numCols) {
        const cellEl = document.createElement(cellData.isHeader ? 'th' : 'td');
        cellEl.textContent = cellData.content || '';

        // Применяем объединение ячеек
        if (cellData.colSpan > 1) cellEl.colSpan = cellData.colSpan;
        if (cellData.rowSpan > 1) cellEl.rowSpan = cellData.rowSpan;

        // Сохраняем координаты ячейки
        Object.assign(cellEl.dataset, {
            row: rowIndex,
            col: colIndex,
            tableId
        });

        // Добавляем хендл изменения ширины колонки (не для последней колонки)
        const colspan = cellData.colSpan || 1;
        const cellEndCol = colIndex + colspan - 1;
        const isLastColumn = cellEndCol >= numCols - 1;

        if (cellData.isHeader && !isLastColumn) {
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            cellEl.appendChild(resizeHandle);
        }

        // Добавляем хендл изменения высоты строки
        const rowResizeHandle = document.createElement('div');
        rowResizeHandle.className = 'row-resize-handle';
        cellEl.appendChild(rowResizeHandle);

        return cellEl;
    }

    /**
     * Перерисовка только конкретной таблицы (оптимизация).
     * Сохраняет и восстанавливает размеры ячеек при перерисовке.
     * @param {string} tableId - ID таблицы для перерисовки
     */
    static renderSingleTable(tableId) {
        const section = document.querySelector(`.table-section[data-table-id="${tableId}"]`);
        if (!section) {
            // Если секция не найдена, делаем полную перерисовку
            this.renderAll();
            return;
        }

        const table = AppState.tables[tableId];
        if (!table) return;

        const tableNode = this._findNodeById(table.nodeId);
        if (!tableNode) return;

        // Сохраняем размеры перед перерисовкой
        const savedSizes = tableManager.preserveTableSizes(section.querySelector('.editable-table'));

        // Перерисовываем таблицу
        const newTableSection = this.renderTable(table, tableNode);
        section.replaceWith(newTableSection);

        tableManager.attachEventListeners();
        this._restoreSingleTableSizes(tableId, savedSizes);
    }

    /**
     * Поиск узла в дереве по ID (рекурсивный обход).
     * @param {string} id - ID узла для поиска
     * @param {Object} [node=AppState.treeData] - Узел, с которого начинать поиск
     * @returns {Object|null} Найденный узел или null
     * @private
     */
    static _findNodeById(id, node = AppState.treeData) {
        if (node.id === id) return node;

        if (node.children) {
            for (const child of node.children) {
                const found = this._findNodeById(id, child);
                if (found) return found;
            }
        }

        return null;
    }

    /**
     * Восстанавливает размеры для конкретной таблицы после перерисовки.
     * Выполняется асинхронно для гарантии завершения отрисовки.
     * @param {string} tableId - ID таблицы
     * @param {Object} savedSizes - Сохраненные размеры ячеек
     * @private
     */
    static _restoreSingleTableSizes(tableId, savedSizes) {
        setTimeout(() => {
            const newSection = document.querySelector(`.table-section[data-table-id="${tableId}"]`);
            if (newSection) {
                const tableEl = newSection.querySelector('.editable-table');
                tableManager.applyTableSizes(tableEl, savedSizes);
                tableManager.persistTableSizes(tableId, tableEl);
            }
        }, 0);
    }

    /**
     * Синхронизация данных из DOM обратно в глобальное состояние AppState.
     * Извлекает актуальные значения из редактируемых элементов (таблицы, текстовые блоки,
     * нарушения) и обновляет соответствующие объекты в состоянии.
     * Вызывается перед сохранением или экспортом документа.
     */
    static syncDataToState() {
        this._syncTables();
        this._syncTextBlocks();
        this._syncViolations();
    }

    /**
     * Синхронизация содержимого всех таблиц из DOM в AppState.
     * Обновляет текст ячеек в матричной структуре grid.
     * @private
     */
    static _syncTables() {
        document.querySelectorAll('.table-section').forEach(section => {
            const tableId = section.dataset.tableId;
            const table = AppState.tables[tableId];
            if (!table) return;

            const tableEl = section.querySelector('.editable-table');
            if (!tableEl) return;

            // Обновляем содержимое ячеек
            tableEl.querySelectorAll('tr').forEach(tr => {
                tr.querySelectorAll('td, th').forEach(cell => {
                    const row = parseInt(cell.dataset.row);
                    const col = parseInt(cell.dataset.col);

                    const cellData = table.grid?.[row]?.[col];
                    if (cellData && !cellData.isSpanned) {
                        cellData.content = cell.textContent.trim();
                    }
                });
            });
        });
    }

    /**
     * Синхронизация содержимого всех текстовых блоков из DOM в AppState.
     * Сохраняет HTML-контент для поддержки форматирования.
     * @private
     */
    static _syncTextBlocks() {
        document.querySelectorAll('.text-block-section').forEach(section => {
            const textBlockId = section.dataset.textBlockId;
            const textBlock = AppState.textBlocks[textBlockId];
            if (!textBlock) return;

            const editor = section.querySelector('.text-block-editor');
            if (editor) {
                textBlock.content = editor.innerHTML;
            }
        });
    }

    /**
     * Синхронизация данных всех нарушений из DOM в AppState.
     * Обновляет поля ввода, списки описаний и опциональные поля.
     * @private
     */
    static _syncViolations() {
        document.querySelectorAll('.violation-section').forEach(section => {
            const violationId = section.dataset.violationId;
            const violation = AppState.violations[violationId];
            if (!violation) return;

            this._syncViolationFields(section, violation);
        });
    }

    /**
     * Синхронизация полей конкретного нарушения.
     * Обновляет основные поля, список описаний и опциональные блоки.
     * @param {HTMLElement} section - Секция нарушения
     * @param {Object} violation - Объект нарушения из AppState
     * @private
     */
    static _syncViolationFields(section, violation) {
        // Синхронизация основных полей
        const violatedInput = section.querySelector('input[data-field="violated"]');
        if (violatedInput) {
            violation.violated = violatedInput.value;
        }

        const establishedInput = section.querySelector('textarea[data-field="established"]');
        if (establishedInput) {
            violation.established = establishedInput.value;
        }

        // Синхронизация списка описаний (метрик)
        const descItems = section.querySelectorAll('.violation-desc-item');
        if (descItems.length > 0) {
            violation.descriptionList.items = Array.from(descItems, item => item.value);
        }

        // Синхронизация опциональных полей
        this._syncOptionalViolationFields(section, violation);
    }

    /**
     * Синхронизация опциональных полей нарушения (причины, последствия, ответственные).
     * @param {HTMLElement} section - Секция нарушения
     * @param {Object} violation - Объект нарушения из AppState
     * @private
     */
    static _syncOptionalViolationFields(section, violation) {
        const optionalFields = ['reasons', 'consequences', 'responsible'];

        optionalFields.forEach(field => {
            const textarea = section.querySelector(`textarea[data-field="${field}"]`);
            if (textarea && violation[field]) {
                violation[field].content = textarea.value;
            }
        });
    }
}
