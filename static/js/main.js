// Главный файл приложения

class App {
    static init() {
        // Инициализация состояния
        AppState.initializeTree();

        // Генерировать нумерацию при инициализации
        AppState.generateNumbering();

        // Рендер дерева
        treeManager.render();

        // Обновить предпросмотр
        PreviewManager.update();

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
        if (currentContent) {
            currentContent.classList.remove('hidden');
        }

        // Если переходим на шаг 2, отрендерить пункты с таблицами
        if (stepNum === 2) {
            ItemsRenderer.renderAll();
        }

        // Обновить предпросмотр
        if (stepNum === 1) {
            PreviewManager.update();
        }
    }
}

// Новый класс для рендеринга пунктов на шаге 2
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

        // После рендера - подключить события таблиц
        this.attachTableEvents();
    }

    static renderItem(node, level) {
        const itemDiv = document.createElement('div');
        itemDiv.className = `item-block level-${level}`;
        itemDiv.dataset.nodeId = node.id;

        // Заголовок пункта
        const header = document.createElement('div');
        header.className = 'item-header';

        const title = document.createElement('h' + Math.min(level + 1, 6));
        title.className = 'item-title';
        title.textContent = node.label;
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

        // Сохранение контента при изменении
        textarea.addEventListener('change', () => {
            node.content = textarea.value;
        });

        contentDiv.appendChild(textarea);
        itemDiv.appendChild(contentDiv);

        // Таблицы пункта
        if (node.tableIds && node.tableIds.length > 0) {
            const tablesDiv = document.createElement('div');
            tablesDiv.className = 'item-tables';

            node.tableIds.forEach(tableId => {
                const table = AppState.tables[tableId];
                if (table) {
                    const tableSection = this.renderTable(table, node);
                    tablesDiv.appendChild(tableSection);
                }
            });

            itemDiv.appendChild(tablesDiv);
        }

        // Дочерние пункты (рекурсивно)
        if (node.children && node.children.length > 0) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'item-children';

            node.children.forEach(child => {
                const childElement = this.renderItem(child, level + 1);
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

        const tableEl = document.createElement('table');
        tableEl.className = 'editable-table';

        table.rows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');

            row.cells.forEach((cell, colIndex) => {
                if (cell.merged) return; // Пропустить объединенные

                const cellEl = document.createElement(cell.isHeader ? 'th' : 'td');
                cellEl.textContent = cell.content;

                if (cell.colspan > 1) {
                    cellEl.colSpan = cell.colspan;
                }

                if (cell.rowspan > 1) {
                    cellEl.rowSpan = cell.rowspan;
                }

                cellEl.dataset.row = rowIndex;
                cellEl.dataset.col = colIndex;
                cellEl.dataset.tableId = table.id;

                // Добавить ручки изменения размера для всех ячеек
                const resizeHandle = document.createElement('div');
                resizeHandle.className = 'resize-handle';
                cellEl.appendChild(resizeHandle);

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

    static attachTableEvents() {
        const container = document.getElementById('itemsContainer');
        if (!container) return;

        // Выбор ячеек
        container.querySelectorAll('td, th').forEach(cell => {
            cell.addEventListener('click', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) return;

                if (!e.ctrlKey) {
                    tableManager.clearSelection();
                }

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

                // Если ячейка не выделена и нет других выделенных - выделить её
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

        input.addEventListener('blur', finishEditing, { once: true });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
            if (e.key === 'Escape') {
                cellEl.textContent = originalContent;
                cellEl.classList.remove('editing');
            }
        }, { once: true });
    }

    static startColumnResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const startX = e.clientX;
        const startWidth = cell.offsetWidth;
        const colIndex = parseInt(cell.dataset.col);

        // Ограничения
        const minWidth = 50;
        const maxWidth = 500;

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Создать визуальную подсказку
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

        let currentWidth = startWidth;

        const onMouseMove = (e) => {
            const diff = e.clientX - startX;
            let newWidth = startWidth + diff;

            // Применить ограничения
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
            currentWidth = newWidth;

            // Обновить положение линии
            resizeLine.style.left = (startX + (newWidth - startWidth)) + 'px';

            // Найти все ячейки в этой колонке (включая объединенные)
            const allRows = table.querySelectorAll('tr');
            allRows.forEach(row => {
                const cellsInRow = row.querySelectorAll('td, th');
                let currentColIndex = 0;

                cellsInRow.forEach(rowCell => {
                    const cellColIndex = parseInt(rowCell.dataset.col);
                    const colspan = rowCell.colSpan || 1;

                    // Если ячейка начинается в изменяемой колонке или охватывает её
                    if (cellColIndex === colIndex ||
                        (cellColIndex < colIndex && cellColIndex + colspan > colIndex)) {

                        // Если это объединенная ячейка, пропорционально изменить ширину
                        if (colspan > 1 && cellColIndex < colIndex) {
                            // Частичное изменение для объединенной ячейки
                            const currentCellWidth = rowCell.offsetWidth;
                            const widthPerColumn = currentCellWidth / colspan;
                            const newCellWidth = currentCellWidth + (newWidth - startWidth);
                            rowCell.style.width = Math.max(minWidth * colspan, Math.min(maxWidth * colspan, newCellWidth)) + 'px';
                        } else {
                            // Обычная ячейка в этой колонке
                            rowCell.style.width = newWidth + 'px';
                        }
                    }

                    currentColIndex += colspan;
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
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    static startRowResize(e) {
        const cell = e.target.parentElement;
        const row = cell.parentElement;
        const table = cell.closest('table');
        const startY = e.clientY;
        const startHeight = row.offsetHeight;
        const rowIndex = parseInt(cell.dataset.row);

        // Ограничения
        const minHeight = 30;
        const maxHeight = 200;

        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Создать визуальную подсказку
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

        let currentHeight = startHeight;

        const onMouseMove = (e) => {
            const diff = e.clientY - startY;
            let newHeight = startHeight + diff;

            // Применить ограничения
            newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
            currentHeight = newHeight;

            // Обновить положение линии
            resizeLine.style.top = (startY + (newHeight - startHeight)) + 'px';

            // Найти все строки, которые затрагиваются этим изменением
            const allRows = table.querySelectorAll('tr');
            allRows.forEach((tableRow, index) => {
                const cellsInRow = tableRow.querySelectorAll('td, th');

                cellsInRow.forEach(rowCell => {
                    const cellRowIndex = parseInt(rowCell.dataset.row);
                    const rowspan = rowCell.rowSpan || 1;

                    // Если ячейка начинается в изменяемой строке или охватывает её
                    if (cellRowIndex === rowIndex ||
                        (cellRowIndex < rowIndex && cellRowIndex + rowspan > rowIndex)) {

                        if (rowspan > 1 && cellRowIndex < rowIndex) {
                            // Пропорциональное изменение для объединенной по строкам ячейки
                            const currentCellHeight = rowCell.offsetHeight;
                            const heightPerRow = currentCellHeight / rowspan;
                            const newCellHeight = currentCellHeight + (newHeight - startHeight);
                            rowCell.style.height = Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newCellHeight)) + 'px';
                        } else if (cellRowIndex === rowIndex) {
                            // Ячейка в изменяемой строке
                            rowCell.style.height = newHeight + 'px';
                        }
                    }
                });
            });

            // Изменить высоту самой строки
            row.style.height = newHeight + 'px';
        };

        const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.body.removeChild(resizeLine);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    static preserveTableSizes(tableElement) {
        const sizes = {};

        // Сохранить размеры колонок
        const cells = tableElement.querySelectorAll('th, td');
        cells.forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            const key = `${row}-${col}`;

            sizes[key] = {
                width: cell.style.width || '',
                height: cell.style.height || ''
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
                if (sizes[key].width) {
                    cell.style.width = sizes[key].width;
                }
                if (sizes[key].height) {
                    cell.style.height = sizes[key].height;
                }
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

        // Закрытие при клике вне меню
        document.addEventListener('click', () => {
            this.hide();
        });

        // Обработчики для пунктов меню дерева
        this.menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.handleTreeAction(action);
                this.hide();
            });
        });

        // Обработчики для пунктов меню ячеек
        this.cellMenu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;

                // Проверить, не заблокирован ли пункт
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

        // Для контекстного меню ячеек - управление доступностью пунктов
        if (type === 'cell') {
            const selectedCellsCount = tableManager.selectedCells.length;

            const mergeCellsItem = this.cellMenu.querySelector('[data-action="merge-cells"]');
            const unmergeCellItem = this.cellMenu.querySelector('[data-action="unmerge-cell"]');

            if (mergeCellsItem) {
                if (selectedCellsCount < 2) {
                    mergeCellsItem.classList.add('disabled');
                } else {
                    mergeCellsItem.classList.remove('disabled');
                }
            }

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
        }

        // Показать меню временно за пределами экрана для измерения
        menu.style.left = '-9999px';
        menu.style.top = '-9999px';
        menu.classList.remove('hidden');

        // Получить размеры после рендера
        setTimeout(() => {
            const menuRect = menu.getBoundingClientRect();
            const menuWidth = menuRect.width;
            const menuHeight = menuRect.height;

            // Размеры окна
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

            let finalX = x;
            let finalY = y;

            // Проверка по горизонтали
            if (finalX + menuWidth > viewportWidth) {
                finalX = x - menuWidth;
            }

            if (finalX < 0) {
                finalX = 10;
            }

            // Проверка по вертикали
            if (finalY + menuHeight > viewportHeight) {
                finalY = y - menuHeight;
            }

            if (finalY < 0) {
                finalY = 10;
            }

            // Установить финальную позицию
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
            case 'add-child':
                const childResult = AppState.addNode(nodeId, 'Новый подпункт', true);
                if (childResult.success) {
                    treeManager.render();
                    PreviewManager.update();
                    // Перерендерить шаг 2 если мы на нем
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert('❌ ' + childResult.reason);
                }
                break;

            case 'add-sibling':
                const siblingResult = AppState.addNode(nodeId, 'Новый пункт', false);
                if (siblingResult.success) {
                    treeManager.render();
                    PreviewManager.update();
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert('❌ ' + siblingResult.reason);
                }
                break;

            case 'add-table':
                const tableResult = AppState.addTableToNode(nodeId);
                if (tableResult.success) {
                    treeManager.render();
                    PreviewManager.update();
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert('❌ ' + tableResult.reason);
                }
                break;

            case 'delete':
                if (node.protected) {
                    alert('❌ Этот пункт защищен от удаления');
                    return;
                }

                if (confirm('Удалить этот пункт?')) {
                    AppState.deleteNode(nodeId);
                    treeManager.render();
                    PreviewManager.update();
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                }
                break;
        }
    }

    static handleCellAction(action) {
        // Сохранить размеры перед операцией
        let tableSizes = {};
        if (tableManager.selectedCells.length > 0) {
            const table = tableManager.selectedCells[0].closest('table');
            tableSizes = ItemsRenderer.preserveTableSizes(table);
        }

        switch (action) {
            case 'merge-cells':
                tableManager.mergeCells();
                if (AppState.currentStep === 2) {
                    ItemsRenderer.renderAll();
                    // Восстановить размеры после рендера
                    setTimeout(() => {
                        const tables = document.querySelectorAll('.editable-table');
                        tables.forEach(table => {
                            ItemsRenderer.applyTableSizes(table, tableSizes);
                        });
                    }, 100);
                } else {
                    tableManager.renderAll();
                }
                PreviewManager.update();
                break;

            case 'unmerge-cell':
                tableManager.unmergeCells();
                if (AppState.currentStep === 2) {
                    ItemsRenderer.renderAll();
                    // Восстановить размеры после рендера
                    setTimeout(() => {
                        const tables = document.querySelectorAll('.editable-table');
                        tables.forEach(table => {
                            ItemsRenderer.applyTableSizes(table, tableSizes);
                        });
                    }, 100);
                } else {
                    tableManager.renderAll();
                }
                PreviewManager.update();
                break;
        }
    }
}

// Запуск приложения при загрузке
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
