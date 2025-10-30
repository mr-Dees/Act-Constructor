/**
 * Менеджер отрисовки элементов на втором шаге
 * Координирует рендеринг всех типов элементов
 */
class ItemsRenderer {
    /**
     * Отрисовка всех элементов дерева
     */
    static renderAll() {
        const container = document.getElementById('itemsContainer');
        if (!container) return;

        // Очищаем контейнер
        container.innerHTML = '';

        // Снимаем выделение с ячеек таблиц
        tableManager.clearSelection();

        // Отрисовываем все элементы из дерева
        if (AppState.treeData && AppState.treeData.children) {
            AppState.treeData.children.forEach(item => {
                const itemElement = this.renderItem(item, 1);
                container.appendChild(itemElement);
            });
        }

        // Привязываем события к таблицам
        ItemsTableEvents.attachTableEvents();

        // Восстанавливаем сохраненные размеры ячеек
        setTimeout(() => {
            document.querySelectorAll('.table-section').forEach(section => {
                const tableId = section.dataset.tableId;
                const tableEl = section.querySelector('.editable-table');
                ItemsTableSizes.applyPersistedSizes(tableId, tableEl);
            });
        }, 0);
    }

    /**
     * Рекурсивная отрисовка элемента дерева
     * @param {Object} node - Узел дерева
     * @param {number} level - Уровень вложенности
     * @returns {HTMLElement} Созданный DOM элемент
     */
    static renderItem(node, level) {
        // Создаем контейнер для элемента
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

        // Отрисовка текстового блока
        if (node.type === 'textblock') {
            const textBlock = AppState.textBlocks[node.textBlockId];
            if (textBlock) {
                const textBlockSection = textBlockManager.createTextBlockElement(textBlock, node);
                itemDiv.appendChild(textBlockSection);
            }
            return itemDiv;
        }

        // Отрисовка нарушения
        if (node.type === 'violation') {
            const violation = AppState.violations[node.violationId];
            if (violation) {
                const violationSection = violationManager.createViolationElement(violation, node);
                itemDiv.appendChild(violationSection);
            }
            return itemDiv;
        }

        // Отрисовка обычного заголовка
        const header = document.createElement('div');
        header.className = 'item-header';

        const title = document.createElement(`h${Math.min(level + 1, 6)}`);
        title.className = 'item-title';
        title.textContent = node.label;

        // Добавляем возможность редактирования незащищенных элементов
        if (!node.protected) {
            let clickCount = 0;
            let clickTimer = null;

            // Обработка двойного клика для редактирования
            title.addEventListener('click', (e) => {
                clickCount++;
                if (clickCount === 1) {
                    // Ждем второй клик
                    clickTimer = setTimeout(() => {
                        clickCount = 0;
                    }, 300);
                } else if (clickCount === 2) {
                    // Двойной клик - начинаем редактирование
                    clearTimeout(clickTimer);
                    clickCount = 0;
                    ItemsEditing.startEditingItemTitle(title, node);
                }
            });
            title.style.cursor = 'pointer';
        }

        header.appendChild(title);
        itemDiv.appendChild(header);

        // Отрисовка дочерних элементов
        if (node.children && node.children.length > 0) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'item-children';

            node.children.forEach(child => {
                // Для таблиц и блоков не увеличиваем уровень
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

    /**
     * Отрисовка таблицы
     * @param {Object} table - Данные таблицы
     * @param {Object} node - Узел дерева
     * @returns {HTMLElement} Созданный элемент таблицы
     */
    static renderTable(table, node) {
        const section = document.createElement('div');
        section.className = 'table-section';
        section.dataset.tableId = table.id;

        // Создаем заголовок таблицы
        const tableTitle = document.createElement('h4');
        tableTitle.className = 'table-title';
        tableTitle.contentEditable = false;
        tableTitle.textContent = node.label;
        tableTitle.style.marginBottom = '10px';
        tableTitle.style.fontWeight = 'bold';
        tableTitle.style.cursor = 'pointer';

        let clickCount = 0;
        let clickTimer = null;

        // Обработка двойного клика для редактирования заголовка
        tableTitle.addEventListener('click', (e) => {
            clickCount++;
            if (clickCount === 1) {
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300);
            } else if (clickCount === 2) {
                clearTimeout(clickTimer);
                clickCount = 0;
                ItemsEditing.startEditingTableTitle(tableTitle, node);
            }
        });

        section.appendChild(tableTitle);

        // Создаем HTML таблицу
        const tableEl = document.createElement('table');
        tableEl.className = 'editable-table';

        // Вычисляем максимальное количество колонок с учетом объединенных ячеек
        let maxCols = 0;
        table.rows.forEach(row => {
            let colCount = 0;
            row.cells.forEach(cell => {
                if (!cell.merged) {
                    colCount += (cell.colspan || 1);
                }
            });
            maxCols = Math.max(maxCols, colCount);
        });

        // Отрисовываем строки и ячейки
        table.rows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');

            row.cells.forEach((cell, colIndex) => {
                // Пропускаем объединенные ячейки
                if (cell.merged) return;

                // Создаем ячейку (th или td)
                const cellEl = document.createElement(cell.isHeader ? 'th' : 'td');
                cellEl.textContent = cell.content;

                // Устанавливаем colspan и rowspan
                if (cell.colspan > 1) {
                    cellEl.colSpan = cell.colspan;
                }
                if (cell.rowspan > 1) {
                    cellEl.rowSpan = cell.rowspan;
                }

                // Сохраняем координаты ячейки
                cellEl.dataset.row = rowIndex;
                cellEl.dataset.col = colIndex;
                cellEl.dataset.tableId = table.id;

                // Добавляем ручку изменения ширины для некрайних колонок
                const colspan = cell.colspan || 1;
                const cellEndCol = colIndex + colspan - 1;
                const isLastColumn = cellEndCol >= maxCols - 1;

                if (!isLastColumn) {
                    const resizeHandle = document.createElement('div');
                    resizeHandle.className = 'resize-handle';
                    cellEl.appendChild(resizeHandle);
                }

                // Добавляем ручку изменения высоты строки
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
     * Синхронизация данных из DOM обратно в AppState
     * Вызывается перед сохранением документа
     */
    static syncDataToState() {
        // Синхронизация содержимого таблиц
        document.querySelectorAll('.table-section').forEach(section => {
            const tableId = section.dataset.tableId;
            const table = AppState.tables[tableId];
            if (!table) return;

            const tableEl = section.querySelector('.editable-table');
            if (!tableEl) return;

            const rows = tableEl.querySelectorAll('tr');
            rows.forEach((tr, rowIndex) => {
                const cells = tr.querySelectorAll('td, th');
                cells.forEach((cell, cellIndex) => {
                    const row = parseInt(cell.dataset.row);
                    const col = parseInt(cell.dataset.col);

                    if (table.rows[row] && table.rows[row].cells[col]) {
                        table.rows[row].cells[col].content = cell.textContent.trim();
                    }
                });
            });
        });

        // Синхронизация текстовых блоков
        document.querySelectorAll('.text-block-section').forEach(section => {
            const textBlockId = section.dataset.textBlockId;
            const textBlock = AppState.textBlocks[textBlockId];
            if (!textBlock) return;

            const editor = section.querySelector('.text-block-editor');
            if (editor) {
                textBlock.content = editor.innerHTML;
            }
        });

        // Синхронизация данных нарушений
        document.querySelectorAll('.violation-section').forEach(section => {
            const violationId = section.dataset.violationId;
            const violation = AppState.violations[violationId];
            if (!violation) return;

            // Синхронизация основных полей
            const violatedInput = section.querySelector('input[data-field="violated"]');
            if (violatedInput) {
                violation.violated = violatedInput.value;
            }

            const establishedInput = section.querySelector('textarea[data-field="established"]');
            if (establishedInput) {
                violation.established = establishedInput.value;
            }

            // Синхронизация списка описаний
            const descItems = section.querySelectorAll('.violation-desc-item');
            if (descItems.length > 0) {
                violation.descriptionList.items = Array.from(descItems).map(item => item.value);
            }

            // Синхронизация дополнительных полей
            const additionalTextArea = section.querySelector('textarea[data-field="additionalText"]');
            if (additionalTextArea && violation.additionalText) {
                violation.additionalText.content = additionalTextArea.value;
            }

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
