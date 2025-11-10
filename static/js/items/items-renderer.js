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

        // Очищаем контейнер перед новым рендерингом
        container.innerHTML = '';

        // Снимаем выделение с ячеек таблиц для корректного состояния
        tableManager.clearSelection();

        // Отрисовываем все элементы первого уровня из дерева
        if (AppState.treeData && AppState.treeData.children) {
            AppState.treeData.children.forEach(item => {
                const itemElement = this.renderItem(item, 1);
                container.appendChild(itemElement);
            });
        }

        // Привязываем обработчики событий к таблицам
        tableManager.attachEventListeners();

        // Восстанавливаем персистентные размеры ячеек таблиц после рендеринга DOM
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
        // Создаем контейнер для элемента с классом уровня вложенности
        const itemDiv = document.createElement('div');
        itemDiv.className = `item-block level-${level}`;
        itemDiv.dataset.nodeId = node.id;

        // Отрисовка таблицы
        if (node.type === 'table') {
            const table = AppState.tables[node.tableId];
            if (table) {
                const tableSection = this.renderTable(table, node);
                itemDiv.appendChild(tableSection);
            }
            return itemDiv;
        }

        // Отрисовка текстового блока с редактором
        if (node.type === 'textblock') {
            const textBlock = AppState.textBlocks[node.textBlockId];
            if (textBlock) {
                const textBlockSection = textBlockManager.createTextBlockElement(textBlock, node);
                itemDiv.appendChild(textBlockSection);
            }
            return itemDiv;
        }

        // Отрисовка нарушения с полями ввода
        if (node.type === 'violation') {
            const violation = AppState.violations[node.violationId];
            if (violation) {
                const violationSection = violationManager.createViolationElement(violation, node);
                itemDiv.appendChild(violationSection);
            }
            return itemDiv;
        }

        // Отрисовка заголовка обычного пункта
        const header = document.createElement('div');
        header.className = 'item-header';

        const title = document.createElement(`h${Math.min(level + 1, 6)}`);
        title.className = 'item-title';
        title.textContent = node.label;

        // Добавляем возможность редактирования незащищенных элементов по двойному клику
        if (!node.protected) {
            let clickCount = 0;
            let clickTimer = null;

            // Обработка двойного клика для перехода в режим редактирования
            title.addEventListener('click', (e) => {
                clickCount++;
                if (clickCount === 1) {
                    // Ждем второй клик в течение 300мс
                    clickTimer = setTimeout(() => {
                        clickCount = 0;
                    }, 300);
                } else if (clickCount === 2) {
                    // Двойной клик зафиксирован - начинаем редактирование
                    clearTimeout(clickTimer);
                    clickCount = 0;
                    ItemsTitleEditing.startEditingItemTitle(title, node);
                }
            });

            title.style.cursor = 'pointer';
        }

        header.appendChild(title);
        itemDiv.appendChild(header);

        // Рекурсивная отрисовка дочерних элементов
        if (node.children && node.children.length > 0) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'item-children';

            node.children.forEach(child => {
                // Для таблиц, текстовых блоков и нарушений не увеличиваем уровень вложенности
                const childElement = this.renderItem(
                    child,
                    (child.type === 'table' || child.type === 'textblock' || child.type === 'violation') ? level : level + 1
                );
                childrenDiv.appendChild(childElement);
            });

            itemDiv.appendChild(childrenDiv);
        }

        return itemDiv;
    }

    static renderTable(table, node) {
        const section = document.createElement('div');
        section.className = 'table-section';
        section.dataset.tableId = table.id;

        const shouldShowTitle = node.customLabel !== '';

        if (shouldShowTitle) {
            const tableTitle = document.createElement('h4');
            tableTitle.className = 'table-title';
            tableTitle.contentEditable = false;
            tableTitle.textContent = node.label;
            tableTitle.style.marginBottom = '10px';

            // ИСПРАВЛЕНИЕ: подчеркиваем название защищенной таблицы, а не жирное
            if (table.protected) {
                tableTitle.style.fontWeight = 'normal';  // Обычный шрифт
                tableTitle.style.textDecoration = 'underline';  // Подчеркнутый
                tableTitle.style.cursor = 'default';
            } else {
                tableTitle.style.fontWeight = 'bold';  // Жирный для незащищенных
                tableTitle.style.cursor = 'pointer';
            }

            let clickCount = 0;
            let clickTimer = null;

            tableTitle.addEventListener('click', (e) => {
                if (table.protected) {
                    Notifications.info('Название защищенной таблицы нельзя редактировать');
                    return;
                }

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

            section.appendChild(tableTitle);
        }

        const tableEl = document.createElement('table');
        tableEl.className = 'editable-table';

        if (table.protected) {
            tableEl.classList.add('protected-table');
        }

        const numCols = table.grid[0] ? table.grid[0].length : 0;

        table.grid.forEach((rowData, rowIndex) => {
            const tr = document.createElement('tr');

            rowData.forEach((cellData, colIndex) => {
                if (cellData.isSpanned) return;

                const cellEl = document.createElement(cellData.isHeader ? 'th' : 'td');
                cellEl.textContent = cellData.content || '';

                if (cellData.colSpan > 1) {
                    cellEl.colSpan = cellData.colSpan;
                }
                if (cellData.rowSpan > 1) {
                    cellEl.rowSpan = cellData.rowSpan;
                }

                cellEl.dataset.row = rowIndex;
                cellEl.dataset.col = colIndex;
                cellEl.dataset.tableId = table.id;

                // УДАЛЕНО: больше не стилизуем заголовки ячеек
                // Заголовки остаются с обычным стилем (жирный шрифт из CSS)

                const colspan = cellData.colSpan || 1;
                const cellEndCol = colIndex + colspan - 1;
                const isLastColumn = cellEndCol >= numCols - 1;

                if (cellData.isHeader && !isLastColumn) {
                    const resizeHandle = document.createElement('div');
                    resizeHandle.className = 'resize-handle';
                    cellEl.appendChild(resizeHandle);
                }

                const rowResizeHandle = document.createElement('div');
                rowResizeHandle.className = 'row-resize-handle';
                cellEl.appendChild(rowResizeHandle);

                tr.appendChild(cellEl);
            });

            tableEl.appendChild(tr);
        });

        section.appendChild(tableEl);
        return section;
    }

    /**
     * Перерисовка только конкретной таблицы (оптимизация).
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

        // Находим узел таблицы в дереве
        const findNodeById = (id, node = AppState.treeData) => {
            if (node.id === id) return node;
            if (node.children) {
                for (let child of node.children) {
                    const found = findNodeById(id, child);
                    if (found) return found;
                }
            }
            return null;
        };

        const tableNode = findNodeById(table.nodeId);
        if (!tableNode) return;

        // Сохраняем размеры перед перерисовкой
        const savedSizes = tableManager.preserveTableSizes(section.querySelector('.editable-table'));

        // Перерисовываем только эту таблицу
        const newTableSection = this.renderTable(table, tableNode);
        section.replaceWith(newTableSection);

        // Привязываем обработчики событий
        tableManager.attachEventListeners();

        // Восстанавливаем размеры
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
        // Синхронизация содержимого таблиц с матричной структурой
        document.querySelectorAll('.table-section').forEach(section => {
            const tableId = section.dataset.tableId;
            const table = AppState.tables[tableId];
            if (!table) return;

            const tableEl = section.querySelector('.editable-table');
            if (!tableEl) return;

            // Обновляем содержимое ячеек из DOM-элементов
            const rows = tableEl.querySelectorAll('tr');
            rows.forEach((tr, rowIndex) => {
                const cells = tr.querySelectorAll('td, th');
                cells.forEach((cell) => {
                    const row = parseInt(cell.dataset.row);
                    const col = parseInt(cell.dataset.col);

                    // Проверяем существование ячейки в grid и что она не поглощена объединением
                    if (table.grid && table.grid[row] && table.grid[row][col]) {
                        if (!table.grid[row][col].isSpanned) {
                            table.grid[row][col].content = cell.textContent.trim();
                        }
                    }
                });
            });
        });

        // Синхронизация содержимого текстовых блоков с HTML-форматированием
        document.querySelectorAll('.text-block-section').forEach(section => {
            const textBlockId = section.dataset.textBlockId;
            const textBlock = AppState.textBlocks[textBlockId];
            if (!textBlock) return;

            const editor = section.querySelector('.text-block-editor');
            if (editor) {
                // Сохраняем HTML-контент для поддержки форматирования
                textBlock.content = editor.innerHTML;
            }
        });

        // Синхронизация данных нарушений из полей ввода
        document.querySelectorAll('.violation-section').forEach(section => {
            const violationId = section.dataset.violationId;
            const violation = AppState.violations[violationId];
            if (!violation) return;

            // Синхронизация основных полей "Нарушено" и "Установлено"
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
                violation.descriptionList.items = Array.from(descItems).map(item => item.value);
            }

            // Синхронизация опциональных полей
            const reasonsArea = section.querySelector('textarea[data-field="reasons"]');
            if (reasonsArea && violation.reasons) {
                violation.reasons.content = reasonsArea.value;
            }

            const consequencesArea = section.querySelector('textarea[data-field="consequences"]');
            if (consequencesArea && violation.consequences) {
                violation.consequences.content = consequencesArea.value;
            }

            const responsibleArea = section.querySelector('textarea[data-field="responsible"]');
            if (responsibleArea && violation.responsible) {
                violation.responsible.content = responsibleArea.value;
            }
        });
    }
}
