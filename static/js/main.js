// Главный файл приложения

class App {
    static init() {
        // Инициализация состояния
        AppState.initializeTree();
        AppState.generateNumbering();

        // Инициализация хранилища размеров таблиц между шагами
        if (!AppState.tableUISizes) AppState.tableUISizes = {}; // { [tableId]: { cellSizes: {[row-col]: {width,height}}, colWidths: number[], rowHeights: number[] } }

        // Рендер дерева
        treeManager.render();

        // Обновить предпросмотр (на шаге 1 всегда резать текст до 30 символов)
        PreviewManager.update({previewTrim: 30});

        // Навигация между шагами
        this.setupNavigation();

        // Контекстное меню
        ContextMenuManager.init();
    }

    static setupNavigation() {
        const nextBtn = document.getElementById('nextBtn');
        const backBtn = document.getElementById('backBtn');
        const generateBtn = document.getElementById('generateBtn');

        nextBtn.addEventListener('click', () => {
            this.goToStep(2);
        });

        backBtn.addEventListener('click', () => {
            this.goToStep(1);
        });

        generateBtn.addEventListener('click', async () => {
            generateBtn.disabled = true;
            generateBtn.textContent = '⏳ Генерация...';
            const success = await APIClient.generateAct();
            generateBtn.disabled = false;
            generateBtn.textContent = '🚀 Сформировать акт';
            if (success) {
                alert('✅ Акт успешно сформирован!');
            }
        });

        // Клик по шагам в заголовке
        document.querySelectorAll('.step').forEach(step => {
            step.addEventListener('click', () => {
                const stepNum = parseInt(step.dataset.step);
                this.goToStep(stepNum);
            });
        });
    }

    static goToStep(stepNum) {
        AppState.currentStep = stepNum;

        // Обновить активный шаг в заголовке
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active');
            if (parseInt(step.dataset.step) === stepNum) {
                step.classList.add('active');
            }
        });

        // Показать нужный контент
        document.querySelectorAll('.step-content').forEach(content => {
            content.classList.add('hidden');
        });

        const currentContent = document.getElementById(`step${stepNum}`);
        if (currentContent) currentContent.classList.remove('hidden');

        // Если переходим на шаг 2
        if (stepNum === 2) {
            // Инициализировать глобальную панель инструментов
            textBlockManager.initGlobalToolbar();
            // Рендерить пункты с таблицами и текстовыми блоками
            ItemsRenderer.renderAll();
        } else {
            // На шаге 1 скрыть панель
            textBlockManager.hideToolbar();
        }

        // На шаге 1 — предпросмотр с усечением текста до 30 символов
        if (stepNum === 1) {
            PreviewManager.update({previewTrim: 30});
        }
    }
}

// Рендер на шаге 2 с сохранением/восстановлением размеров
class ItemsRenderer {
    static renderAll() {
        const container = document.getElementById('itemsContainer');
        if (!container) return;
        container.innerHTML = '';

        // Очистить выделение таблиц
        tableManager.clearSelection();

        // Рендерим все пункты первого уровня и их детей
        if (AppState.treeData && AppState.treeData.children) {
            AppState.treeData.children.forEach(item => {
                const itemElement = this.renderItem(item, 1);
                container.appendChild(itemElement);
            });
        }

        // После рендера - подключить события таблиц и восстановить размеры
        this.attachTableEvents();

        // Восстановить UI размеры после рендера, если есть сохранённые
        setTimeout(() => {
            document.querySelectorAll('.table-section').forEach(section => {
                const tableId = section.dataset.tableId;
                const tableEl = section.querySelector('.editable-table');
                this.applyPersistedSizes(tableId, tableEl);
            });
        }, 0);
    }

    static renderItem(node, level) {
        const itemDiv = document.createElement('div');
        itemDiv.className = `item-block level-${level}`;
        itemDiv.dataset.nodeId = node.id;

        // Если это таблица - рендерим только таблицу
        if (node.type === 'table') {
            const table = AppState.tables[node.tableId];
            if (table) {
                const tableSection = this.renderTable(table, node);
                itemDiv.appendChild(tableSection);
            }
            return itemDiv;
        }

        // Если это текстовый блок - рендерим только текстовый блок (БЕЗ заголовка)
        if (node.type === 'textblock') {
            const textBlock = AppState.textBlocks[node.textBlockId];
            if (textBlock) {
                const textBlockSection = textBlockManager.createTextBlockElement(textBlock, node);
                itemDiv.appendChild(textBlockSection);
            }
            return itemDiv;
        }

        // Заголовок пункта
        const header = document.createElement('div');
        header.className = 'item-header';
        const title = document.createElement('h' + Math.min(level + 1, 6));
        title.className = 'item-title';
        title.textContent = node.label;
        title.contentEditable = false;

        // Двойной клик для редактирования (только для не-protected пунктов)
        if (!node.protected) {
            let clickCount = 0;
            let clickTimer = null;

            title.addEventListener('click', (e) => {
                clickCount++;

                if (clickCount === 1) {
                    clickTimer = setTimeout(() => {
                        clickCount = 0;
                    }, 300);
                } else if (clickCount === 2) {
                    clearTimeout(clickTimer);
                    clickCount = 0;
                    this.startEditingItemTitle(title, node);
                }
            });

            title.style.cursor = 'pointer';
        }

        header.appendChild(title);
        itemDiv.appendChild(header);

        // Контент пункта (текстовое поле)
        const contentDiv = document.createElement('div');
        contentDiv.className = 'item-content';
        const textarea = document.createElement('textarea');
        textarea.className = 'item-textarea';
        textarea.placeholder = 'Введите текст для этого пункта...';
        textarea.value = node.content || '';
        textarea.rows = 3;
        textarea.addEventListener('change', () => {
            node.content = textarea.value;
        });
        contentDiv.appendChild(textarea);
        itemDiv.appendChild(contentDiv);

        // Дочерние элементы (рекурсивно) - включая таблицы
        if (node.children && node.children.length > 0) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'item-children';
            node.children.forEach(child => {
                const childElement = this.renderItem(child, child.type === 'table' ? level : level + 1);
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

        // Заголовок таблицы (редактируемый через двойной клик)
        const tableTitle = document.createElement('h4');
        tableTitle.className = 'table-title';
        tableTitle.contentEditable = false;
        tableTitle.textContent = node.label || 'Таблица';
        tableTitle.style.marginBottom = '10px';
        tableTitle.style.fontWeight = 'bold';
        tableTitle.style.cursor = 'pointer';

        // Двойной клик для редактирования заголовка таблицы
        let clickCount = 0;
        let clickTimer = null;

        tableTitle.addEventListener('click', (e) => {
            clickCount++;

            if (clickCount === 1) {
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300);
            } else if (clickCount === 2) {
                clearTimeout(clickTimer);
                clickCount = 0;
                this.startEditingTableTitle(tableTitle, node);
            }
        });

        section.appendChild(tableTitle);

        const tableEl = document.createElement('table');
        tableEl.className = 'editable-table';

        // Определить максимальное количество колонок (с учетом colspan)
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

        table.rows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            row.cells.forEach((cell, colIndex) => {
                if (cell.merged) return; // Пропустить объединенные

                const cellEl = document.createElement(cell.isHeader ? 'th' : 'td');
                cellEl.textContent = cell.content;
                if (cell.colspan > 1) cellEl.colSpan = cell.colspan;
                if (cell.rowspan > 1) cellEl.rowSpan = cell.rowspan;
                cellEl.dataset.row = rowIndex;
                cellEl.dataset.col = colIndex;
                cellEl.dataset.tableId = table.id;

                // Определить, является ли это последней видимой колонкой
                const colspan = cell.colspan || 1;
                const cellEndCol = colIndex + colspan - 1;
                const isLastColumn = (cellEndCol === maxCols - 1);

                // Добавить правую ручку изменения размера только если это НЕ последняя колонка
                if (!isLastColumn) {
                    const resizeHandle = document.createElement('div');
                    resizeHandle.className = 'resize-handle';
                    cellEl.appendChild(resizeHandle);
                }

                // Нижняя ручка изменения размера строк (всегда добавляем)
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

    // Новый метод для редактирования заголовка пункта на шаге 2
    static startEditingItemTitle(titleElement, node) {
        if (titleElement.classList.contains('editing')) return;

        titleElement.classList.add('editing');
        titleElement.contentEditable = true;

        // Извлечь только текст без нумерации
        const labelMatch = node.label.match(/^[\d.]+\s+(.+)$/);
        const baseLabel = labelMatch ? labelMatch[1] : node.label;

        // Показать только базовое название для редактирования
        titleElement.textContent = baseLabel;
        titleElement.focus();

        // Выделить весь текст
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        const finishEditing = () => {
            titleElement.contentEditable = false;
            titleElement.classList.remove('editing');
            const newBaseLabel = titleElement.textContent.trim();

            if (newBaseLabel && newBaseLabel !== baseLabel) {
                // Обновить только базовое название, сохранив структуру номера
                const numberMatch = node.label.match(/^([\d.]+)\s+/);
                if (numberMatch) {
                    node.label = numberMatch[1] + ' ' + newBaseLabel;
                } else {
                    node.label = newBaseLabel;
                }

                // Перегенерировать нумерацию (она восстановит правильный номер)
                AppState.generateNumbering();

                // Обновить отображение с новым label
                titleElement.textContent = node.label;

                // Обновить дерево и превью
                treeManager.render();
                PreviewManager.update();
            } else if (!newBaseLabel) {
                // Если пустой - вернуть полное старое значение
                titleElement.textContent = node.label;
            } else {
                // Если не изменилось - вернуть полное значение
                titleElement.textContent = node.label;
            }
        };

        titleElement.addEventListener('blur', finishEditing, { once: true });

        titleElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleElement.blur();
            }
            if (e.key === 'Escape') {
                titleElement.textContent = node.label;
                titleElement.blur();
            }
        }, { once: true });
    }

    static startEditingTableTitle(titleElement, node) {
        if (titleElement.classList.contains('editing')) return;

        titleElement.classList.add('editing');
        titleElement.contentEditable = true;

        // Показываем кастомное название, если есть, иначе пустое поле
        const currentLabel = node.customLabel || '';
        titleElement.textContent = currentLabel;
        titleElement.focus();

        // Выделить весь текст
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        const finishEditing = () => {
            titleElement.contentEditable = false;
            titleElement.classList.remove('editing');

            const newLabel = titleElement.textContent.trim();
            if (newLabel) {
                // Сохраняем кастомное название
                node.customLabel = newLabel;
                node.label = newLabel;
            } else {
                // Если пустое - удаляем кастомное название, вернется дефолтное
                delete node.customLabel;
                node.label = node.number || 'Таблица';
            }

            // Перегенерировать нумерацию (обновит node.number под капотом)
            AppState.generateNumbering();

            // Обновить отображение
            titleElement.textContent = node.label;

            // Обновить дерево и превью
            treeManager.render();
            PreviewManager.update();
        };

        titleElement.addEventListener('blur', finishEditing, { once: true });
        titleElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleElement.blur();
            }
            if (e.key === 'Escape') {
                // Отменить редактирование
                titleElement.textContent = node.label;
                titleElement.blur();
            }
        }, { once: true });
    }

    static attachTableEvents() {
        const container = document.getElementById('itemsContainer');
        if (!container) return;

        // Выбор ячеек
        container.querySelectorAll('td, th').forEach(cell => {
            cell.addEventListener('click', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) return;

                if (!e.ctrlKey) tableManager.clearSelection();
                tableManager.selectCell(cell);
            });

            // Двойной клик для редактирования
            cell.addEventListener('dblclick', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) return;
                this.startEditingCell(cell);
            });

            // Правый клик для контекстного меню (НЕ сбрасывать выделение)
            cell.addEventListener('contextmenu', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) return;
                e.preventDefault();
                if (!cell.classList.contains('selected') && tableManager.selectedCells.length === 0) {
                    tableManager.selectCell(cell);
                }
                ContextMenuManager.show(e.clientX, e.clientY, null, 'cell');
            });
        });

        // Изменение размера колонок
        container.querySelectorAll('.resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startColumnResize(e);
            });
        });

        // Изменение размера строк
        container.querySelectorAll('.row-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startRowResize(e);
            });
        });
    }

    // Редактирование ячейки
    static startEditingCell(cellEl) {
        const originalContent = cellEl.textContent;
        cellEl.classList.add('editing');

        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalContent;

        cellEl.textContent = '';
        cellEl.appendChild(input);
        input.focus();

        const finishEditing = () => {
            const newValue = input.value.trim();
            cellEl.textContent = newValue;
            cellEl.classList.remove('editing');

            // Обновить в состоянии
            const tableId = cellEl.dataset.tableId;
            const row = parseInt(cellEl.dataset.row);
            const col = parseInt(cellEl.dataset.col);
            const table = AppState.tables[tableId];

            if (table && table.rows[row] && table.rows[row].cells[col]) {
                table.rows[row].cells[col].content = newValue;
            }
        };

        input.addEventListener('blur', finishEditing, {once: true});
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cellEl.textContent = originalContent;
                cellEl.classList.remove('editing');
            }
        }, {once: true});
    }

    // Ресайз колонки с компенсацией соседней колонки справа
    static startColumnResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const section = table.closest('.table-section');
        const startX = e.clientX;
        const startWidth = cell.offsetWidth;
        const colIndex = parseInt(cell.dataset.col);

        // Найти следующую видимую колонку справа для компенсации
        const allRows = table.querySelectorAll('tr');
        const firstRow = allRows[0];
        const firstRowCells = firstRow.querySelectorAll('td, th');

        let nextColIndex = null;
        let nextCell = null;
        let nextStartWidth = 0;

        // Найти следующую колонку (не объединенную с текущей)
        for (let i = 0; i < firstRowCells.length; i++) {
            const testCell = firstRowCells[i];
            const testColIndex = parseInt(testCell.dataset.col);
            if (testColIndex > colIndex) {
                nextColIndex = testColIndex;
                nextCell = testCell;
                nextStartWidth = testCell.offsetWidth;
                break;
            }
        }

        // Ограничения
        const minWidth = 80;
        const maxWidth = 800;

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Визуальная линия
        const resizeLine = document.createElement('div');
        resizeLine.style.position = 'fixed';
        resizeLine.style.top = '0';
        resizeLine.style.bottom = '0';
        resizeLine.style.width = '2px';
        resizeLine.style.backgroundColor = '#667eea';
        resizeLine.style.zIndex = '9999';
        resizeLine.style.pointerEvents = 'none';
        resizeLine.style.left = e.clientX + 'px';
        document.body.appendChild(resizeLine);

        const onMouseMove = (ev) => {
            const diff = ev.clientX - startX;
            let newWidth = startWidth + diff;

            // Ограничить текущую колонку
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

            // Если есть следующая колонка, компенсировать изменение
            let nextNewWidth = nextStartWidth;
            if (nextColIndex !== null && nextCell) {
                // Вычислить новую ширину следующей колонки (уменьшить на столько, на сколько увеличилась текущая)
                const actualDiff = newWidth - startWidth;
                nextNewWidth = nextStartWidth - actualDiff;

                // Если следующая колонка станет слишком узкой, ограничить текущую
                if (nextNewWidth < minWidth) {
                    nextNewWidth = minWidth;
                    newWidth = startWidth + (nextStartWidth - minWidth);
                }

                // Если следующая колонка станет слишком широкой
                if (nextNewWidth > maxWidth) {
                    nextNewWidth = maxWidth;
                    newWidth = startWidth + (nextStartWidth - maxWidth);
                }
            }

            // Обновить позицию линии
            resizeLine.style.left = (startX + (newWidth - startWidth)) + 'px';

            // Применить новую ширину к текущей колонке
            allRows.forEach(row => {
                const cellsInRow = row.querySelectorAll('td, th');
                cellsInRow.forEach(rowCell => {
                    const cellColIndex = parseInt(rowCell.dataset.col);
                    const colspan = rowCell.colSpan || 1;

                    if (cellColIndex === colIndex) {
                        // Текущая изменяемая колонка
                        rowCell.style.width = newWidth + 'px';
                        rowCell.style.minWidth = newWidth + 'px';
                        rowCell.style.maxWidth = newWidth + 'px';
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (cellColIndex < colIndex && (cellColIndex + colspan > colIndex)) {
                        // Объединенная ячейка, перекрывающая текущую колонку
                        const currentCellWidth = rowCell.offsetWidth;
                        const delta = (newWidth - startWidth);
                        const newCellWidth = currentCellWidth + delta;
                        rowCell.style.width = newCellWidth + 'px';
                        rowCell.style.minWidth = newCellWidth + 'px';
                        rowCell.style.maxWidth = newCellWidth + 'px';
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (nextColIndex !== null && cellColIndex === nextColIndex) {
                        // Следующая колонка - компенсировать изменение
                        rowCell.style.width = nextNewWidth + 'px';
                        rowCell.style.minWidth = nextNewWidth + 'px';
                        rowCell.style.maxWidth = nextNewWidth + 'px';
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (nextColIndex !== null && cellColIndex < nextColIndex && (cellColIndex + colspan > nextColIndex)) {
                        // Объединенная ячейка, перекрывающая следующую колонку
                        const currentCellWidth = rowCell.offsetWidth;
                        const delta = (nextNewWidth - nextStartWidth);
                        const newCellWidth = currentCellWidth + delta;
                        rowCell.style.width = newCellWidth + 'px';
                        rowCell.style.minWidth = newCellWidth + 'px';
                        rowCell.style.maxWidth = newCellWidth + 'px';
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    }
                });
            });
        };

        const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.body.removeChild(resizeLine);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            // Сохранить размеры в AppState.tableUISizes
            if (section) {
                const tableId = section.dataset.tableId;
                ItemsRenderer.persistTableSizes(tableId, table);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    // Ресайз строки
    static startRowResize(e) {
        const cell = e.target.parentElement;
        const row = cell.parentElement;
        const table = cell.closest('table');
        const startY = e.clientY;
        const startHeight = row.offsetHeight;
        const rowIndex = parseInt(cell.dataset.row);

        const minHeight = 28;
        const maxHeight = 600;

        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        const resizeLine = document.createElement('div');
        resizeLine.style.position = 'fixed';
        resizeLine.style.left = '0';
        resizeLine.style.right = '0';
        resizeLine.style.height = '2px';
        resizeLine.style.backgroundColor = '#667eea';
        resizeLine.style.zIndex = '9999';
        resizeLine.style.pointerEvents = 'none';
        resizeLine.style.top = e.clientY + 'px';
        document.body.appendChild(resizeLine);

        const onMouseMove = (ev) => {
            const diff = ev.clientY - startY;
            let newHeight = startHeight + diff;
            newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

            resizeLine.style.top = (startY + (newHeight - startHeight)) + 'px';

            const allRows = table.querySelectorAll('tr');
            allRows.forEach((tableRow) => {
                const cellsInRow = tableRow.querySelectorAll('td, th');
                cellsInRow.forEach(rowCell => {
                    const cellRowIndex = parseInt(rowCell.dataset.row);
                    const rowspan = rowCell.rowSpan || 1;

                    if (cellRowIndex === rowIndex) {
                        rowCell.style.height = newHeight + 'px';
                        rowCell.style.minHeight = newHeight + 'px';
                    } else if (cellRowIndex < rowIndex && (cellRowIndex + rowspan > rowIndex)) {
                        // объединенная по строкам ячейка - добавляем дельту одной строки
                        const currentCellHeight = rowCell.offsetHeight;
                        const delta = (newHeight - startHeight);
                        const newCellHeight = currentCellHeight + delta;
                        rowCell.style.height = Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newCellHeight)) + 'px';
                        rowCell.style.minHeight = Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newCellHeight)) + 'px';
                    }
                });
            });

            row.style.height = newHeight + 'px';
            row.style.minHeight = newHeight + 'px';
        };

        const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.body.removeChild(resizeLine);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const section = table.closest('.table-section');
            if (section) {
                const tableId = section.dataset.tableId;
                ItemsRenderer.persistTableSizes(tableId, table);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    // Сохранение UI размеров в AppState.tableUISizes[tableId]
    static persistTableSizes(tableId, tableElement) {
        if (!tableId || !tableElement) return;
        if (!AppState.tableUISizes) AppState.tableUISizes = {};

        const sizes = {};
        tableElement.querySelectorAll('th, td').forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            if (row == null || col == null) return;

            const key = `${row}-${col}`;
            sizes[key] = {
                width: cell.style.width || '',
                height: cell.style.height || '',
                minWidth: cell.style.minWidth || '',
                minHeight: cell.style.minHeight || '',
                wordBreak: cell.style.wordBreak || '',
                overflowWrap: cell.style.overflowWrap || ''
            };
        });

        AppState.tableUISizes[tableId] = {
            cellSizes: sizes
        };
    }

    // Применение сохранённых размеров
    static applyPersistedSizes(tableId, tableElement) {
        if (!tableId || !tableElement) return;

        const saved = AppState.tableUISizes && AppState.tableUISizes[tableId];
        if (!saved || !saved.cellSizes) return;

        tableElement.querySelectorAll('th, td').forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            if (row == null || col == null) return;

            const key = `${row}-${col}`;
            const s = saved.cellSizes[key];

            if (s) {
                if (s.width) cell.style.width = s.width;
                if (s.height) cell.style.height = s.height;
                if (s.minWidth) cell.style.minWidth = s.minWidth;
                if (s.minHeight) cell.style.minHeight = s.minHeight;
                cell.style.wordBreak = s.wordBreak || 'normal';
                cell.style.overflowWrap = s.overflowWrap || 'anywhere';
            } else {
                // Значения по умолчанию
                cell.style.minWidth = '80px';
                cell.style.minHeight = '28px';
                cell.style.wordBreak = 'normal';
                cell.style.overflowWrap = 'anywhere';
            }
        });
    }

    // Вспомогательные для контекстного меню
    static preserveTableSizes(tableElement) {
        const sizes = {};
        const cells = tableElement.querySelectorAll('th, td');

        cells.forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            const key = `${row}-${col}`;

            sizes[key] = {
                width: cell.style.width || '',
                height: cell.style.height || '',
                minWidth: cell.style.minWidth || '',
                minHeight: cell.style.minHeight || '',
                wordBreak: cell.style.wordBreak || '',
                overflowWrap: cell.style.overflowWrap || ''
            };
        });

        return sizes;
    }

    static applyTableSizes(tableElement, sizes) {
        if (!sizes) return;

        const cells = tableElement.querySelectorAll('th, td');
        cells.forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            const key = `${row}-${col}`;

            if (sizes[key]) {
                if (sizes[key].width) cell.style.width = sizes[key].width;
                if (sizes[key].height) cell.style.height = sizes[key].height;
                if (sizes[key].minWidth) cell.style.minWidth = sizes[key].minWidth;
                if (sizes[key].minHeight) cell.style.minHeight = sizes[key].minHeight;
                cell.style.wordBreak = sizes[key].wordBreak || 'normal';
                cell.style.overflowWrap = sizes[key].overflowWrap || 'anywhere';
            }
        });
    }
}

// Контекстное меню
class ContextMenuManager {
    static menu = null;
    static cellMenu = null;
    static currentNodeId = null;

    static init() {
        this.menu = document.getElementById('contextMenu');
        this.cellMenu = document.getElementById('cellContextMenu');

        document.addEventListener('click', () => {
            this.hide();
        });

        this.menu?.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.handleTreeAction(action);
                this.hide();
            });
        });

        this.cellMenu?.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                if (item.classList.contains('disabled')) {
                    return;
                }
                this.handleCellAction(action);
                this.hide();
            });
        });
    }

    static show(x, y, nodeId, type) {
        this.hide();
        const menu = type === 'cell' ? this.cellMenu : this.menu;
        this.currentNodeId = nodeId;

        if (type === 'cell') {
            const selectedCellsCount = tableManager.selectedCells.length;
            const mergeCellsItem = this.cellMenu?.querySelector('[data-action="merge-cells"]');
            const unmergeCellItem = this.cellMenu?.querySelector('[data-action="unmerge-cell"]');

            if (mergeCellsItem) {
                if (selectedCellsCount < 2) mergeCellsItem.classList.add('disabled');
                else mergeCellsItem.classList.remove('disabled');
            }

            if (unmergeCellItem) {
                if (selectedCellsCount === 1) {
                    const cell = tableManager.selectedCells[0];
                    const isMerged = cell.colSpan > 1 || cell.rowSpan > 1;
                    if (isMerged) unmergeCellItem.classList.remove('disabled');
                    else unmergeCellItem.classList.add('disabled');
                } else {
                    unmergeCellItem.classList.add('disabled');
                }
            }
        }

        if (!menu) return;

        menu.style.left = '-9999px';
        menu.style.top = '-9999px';
        menu.classList.remove('hidden');

        setTimeout(() => {
            const menuRect = menu.getBoundingClientRect();
            const menuWidth = menuRect.width;
            const menuHeight = menuRect.height;
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

            let finalX = x;
            let finalY = y;

            if (finalX + menuWidth > viewportWidth) finalX = x - menuWidth;
            if (finalX < 0) finalX = 10;
            if (finalY + menuHeight > viewportHeight) finalY = y - menuHeight;
            if (finalY < 0) finalY = 10;

            menu.style.left = finalX + 'px';
            menu.style.top = finalY + 'px';
        }, 1);
    }

    static hide() {
        if (this.menu) this.menu.classList.add('hidden');
        if (this.cellMenu) this.cellMenu.classList.add('hidden');
    }

    static handleTreeAction(action) {
        const nodeId = this.currentNodeId;
        if (!nodeId) return;
        const node = AppState.findNodeById(nodeId);
        if (!node) return;

        switch (action) {
            case 'add-child': {
                // Запретить добавление дочерних элементов к таблицам
                if (node.type === 'table') {
                    alert('❌ Нельзя добавить дочерний пункт к таблице');
                    return;
                }

                const childResult = AppState.addNode(nodeId, 'Новый подпункт', true);
                if (childResult.success) {
                    treeManager.render();
                    PreviewManager.update({previewTrim: 30});
                    if (AppState.currentStep === 2) ItemsRenderer.renderAll();
                } else {
                    alert('❌ ' + childResult.reason);
                }
                break;
            }

            case 'add-sibling': {
                const siblingResult = AppState.addNode(nodeId, 'Новый пункт', false);
                if (siblingResult.success) {
                    treeManager.render();
                    PreviewManager.update({previewTrim: 30});
                    if (AppState.currentStep === 2) ItemsRenderer.renderAll();
                } else {
                    alert('❌ ' + siblingResult.reason);
                }
                break;
            }

            case 'add-table': {
                // Запретить добавление таблицы к таблице
                if (node.type === 'table') {
                    alert('❌ Нельзя добавить таблицу к таблице');
                    return;
                }

                const tableResult = AppState.addTableToNode(nodeId);
                if (tableResult.success) {
                    treeManager.render();
                    PreviewManager.update({previewTrim: 30});
                    if (AppState.currentStep === 2) ItemsRenderer.renderAll();
                } else {
                    alert('❌ ' + tableResult.reason);
                }
                break;
            }

            case 'add-textblock': {
                // Запретить добавление текстового блока к таблице или текстовому блоку
                if (node.type === 'table' || node.type === 'textblock') {
                    alert('❌ Нельзя добавить текстовый блок к таблице или другому текстовому блоку');
                    return;
                }

                const textBlockResult = AppState.addTextBlockToNode(nodeId);
                if (textBlockResult.success) {
                    treeManager.render();
                    PreviewManager.update({previewTrim: 30});
                    if (AppState.currentStep === 2) ItemsRenderer.renderAll();
                } else {
                    alert('❌ ' + textBlockResult.reason);
                }
                break;
            }

            case 'delete': {
                if (node.protected) {
                    alert('❌ Этот пункт защищен от удаления');
                    return;
                }

                if (confirm('Удалить этот пункт?')) {
                    AppState.deleteNode(nodeId);
                    treeManager.render();
                    PreviewManager.update({previewTrim: 30});
                    if (AppState.currentStep === 2) ItemsRenderer.renderAll();
                }
                break;
            }
        }
    }

    static handleCellAction(action) {
        // Сохранить текущие размеры до операции
        let tableSizes = {};
        if (tableManager.selectedCells.length > 0) {
            const table = tableManager.selectedCells[0].closest('table');
            tableSizes = ItemsRenderer.preserveTableSizes(table);
        }

        switch (action) {
            case 'merge-cells': {
                tableManager.mergeCells();
                if (AppState.currentStep === 2) {
                    ItemsRenderer.renderAll();
                    // Восстановить размеры после рендера
                    setTimeout(() => {
                        const tables = document.querySelectorAll('.editable-table');
                        tables.forEach(tbl => {
                            ItemsRenderer.applyTableSizes(tbl, tableSizes);
                            const section = tbl.closest('.table-section');
                            if (section) ItemsRenderer.persistTableSizes(section.dataset.tableId, tbl);
                        });
                    }, 50);
                } else {
                    tableManager.renderAll();
                }
                PreviewManager.update({previewTrim: 30});
                break;
            }

            case 'unmerge-cell': {
                tableManager.unmergeCells();
                if (AppState.currentStep === 2) {
                    ItemsRenderer.renderAll();
                    setTimeout(() => {
                        const tables = document.querySelectorAll('.editable-table');
                        tables.forEach(tbl => {
                            ItemsRenderer.applyTableSizes(tbl, tableSizes);
                            const section = tbl.closest('.table-section');
                            if (section) ItemsRenderer.persistTableSizes(section.dataset.tableId, tbl);
                        });
                    }, 50);
                } else {
                    tableManager.renderAll();
                }
                PreviewManager.update({previewTrim: 30});
                break;
            }
        }
    }
}

// Запуск приложения при загрузке
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
