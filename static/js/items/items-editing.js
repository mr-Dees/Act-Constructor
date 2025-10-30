/**
 * Модуль для редактирования элементов (заголовки, ячейки таблиц)
 */
class ItemsEditing {
    /**
     * Начало редактирования заголовка элемента
     * @param {HTMLElement} titleElement - Элемент заголовка
     * @param {Object} node - Узел дерева
     */
    static startEditingItemTitle(titleElement, node) {
        // Если уже редактируется - выходим
        if (titleElement.classList.contains('editing')) {
            return;
        }

        titleElement.classList.add('editing');
        titleElement.contentEditable = 'true';

        // Извлекаем текст без нумерации
        const labelMatch = node.label.match(/^\d+(?:\.\d+)*\.\s*(.+)$/);
        const baseLabel = labelMatch ? labelMatch[1] : node.label;
        const originalLabel = node.label;

        titleElement.textContent = baseLabel;
        titleElement.focus();

        // Выделяем весь текст
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        /**
         * Завершение редактирования
         * @param {boolean} cancel - Отменить изменения
         */
        const finishEditing = (cancel = false) => {
            titleElement.contentEditable = 'false';
            titleElement.classList.remove('editing');

            if (cancel) {
                titleElement.textContent = originalLabel;
                return;
            }

            const newBaseLabel = titleElement.textContent.trim();
            if (newBaseLabel && newBaseLabel !== baseLabel) {
                // Сохраняем нумерацию
                const numberMatch = node.label.match(/^(\d+(?:\.\d+)*\.)\s*/);
                if (numberMatch) {
                    node.label = numberMatch[1] + ' ' + newBaseLabel;
                } else {
                    node.label = newBaseLabel;
                }

                AppState.generateNumbering();
                titleElement.textContent = node.label;
                treeManager.render();
                PreviewManager.update();
            } else if (!newBaseLabel) {
                // Возвращаем старую метку если новая пустая
                titleElement.textContent = originalLabel;
            } else {
                titleElement.textContent = node.label;
            }
        };

        // Завершение редактирования при потере фокуса
        const blurHandler = () => {
            finishEditing(false);
        };

        // Обработка клавиш
        const keydownHandler = (e) => {
            if (e.key === 'Enter') {
                // Enter - сохранить
                e.preventDefault();
                e.stopPropagation();
                titleElement.removeEventListener('blur', blurHandler);
                titleElement.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Escape') {
                // Escape - отменить
                e.preventDefault();
                e.stopPropagation();
                titleElement.removeEventListener('blur', blurHandler);
                titleElement.removeEventListener('keydown', keydownHandler);
                finishEditing(true);
            }
        };

        titleElement.addEventListener('blur', blurHandler);
        titleElement.addEventListener('keydown', keydownHandler);
    }

    /**
     * Начало редактирования заголовка таблицы
     * @param {HTMLElement} titleElement - Элемент заголовка таблицы
     * @param {Object} node - Узел дерева таблицы
     */
    static startEditingTableTitle(titleElement, node) {
        // Если уже редактируется - выходим
        if (titleElement.classList.contains('editing')) {
            return;
        }

        titleElement.classList.add('editing');
        titleElement.contentEditable = 'true';

        const currentLabel = node.customLabel || node.label;
        const originalLabel = currentLabel;

        titleElement.textContent = currentLabel;
        titleElement.focus();

        // Выделяем весь текст
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        /**
         * Завершение редактирования
         * @param {boolean} cancel - Отменить изменения
         */
        const finishEditing = (cancel = false) => {
            titleElement.contentEditable = 'false';
            titleElement.classList.remove('editing');

            if (cancel) {
                titleElement.textContent = originalLabel;
                return;
            }

            const newLabel = titleElement.textContent.trim();
            if (newLabel) {
                // Сохраняем новое название
                node.customLabel = newLabel;
                node.label = newLabel;
            } else {
                // Удаляем кастомное название если пустое
                delete node.customLabel;
                node.label = node.number || originalLabel;
            }

            AppState.generateNumbering();
            titleElement.textContent = node.label;
            treeManager.render();
            PreviewManager.update();
        };

        // Завершение редактирования при потере фокуса
        const blurHandler = () => {
            finishEditing(false);
        };

        // Обработка клавиш
        const keydownHandler = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                titleElement.removeEventListener('blur', blurHandler);
                titleElement.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                titleElement.removeEventListener('blur', blurHandler);
                titleElement.removeEventListener('keydown', keydownHandler);
                finishEditing(true);
            }
        };

        titleElement.addEventListener('blur', blurHandler);
        titleElement.addEventListener('keydown', keydownHandler);
    }

    /**
     * Начало редактирования содержимого ячейки
     * @param {HTMLElement} cellEl - Элемент ячейки
     */
    static startEditingCell(cellEl) {
        const originalContent = cellEl.textContent;
        cellEl.classList.add('editing');

        // Создаем textarea для многострочного ввода
        const textarea = document.createElement('textarea');
        textarea.value = originalContent;
        textarea.style.width = '100%';
        textarea.style.height = '100%';
        textarea.style.minHeight = '28px';
        textarea.style.border = 'none';
        textarea.style.outline = 'none';
        textarea.style.resize = 'none';
        textarea.style.padding = '4px';
        textarea.style.fontFamily = 'inherit';
        textarea.style.fontSize = 'inherit';

        cellEl.textContent = '';
        cellEl.appendChild(textarea);
        textarea.focus();

        /**
         * Завершение редактирования
         * @param {boolean} cancel - Отменить изменения
         */
        const finishEditing = (cancel = false) => {
            if (cancel) {
                cellEl.textContent = originalContent;
            } else {
                const newValue = textarea.value.trim();
                cellEl.textContent = newValue;

                // Обновляем данные в AppState
                const tableId = cellEl.dataset.tableId;
                const row = parseInt(cellEl.dataset.row);
                const col = parseInt(cellEl.dataset.col);
                const table = AppState.tables[tableId];

                if (table && table.rows[row] && table.rows[row].cells[col]) {
                    table.rows[row].cells[col].content = newValue;
                }

                PreviewManager.update();
            }

            cellEl.classList.remove('editing');
        };

        // Завершение редактирования при потере фокуса
        const blurHandler = () => {
            finishEditing(false);
        };

        // Обработка клавиш
        const keydownHandler = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // Enter без Shift - сохранить
                e.preventDefault();
                e.stopPropagation();
                textarea.removeEventListener('blur', blurHandler);
                textarea.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Enter' && e.shiftKey) {
                // Shift+Enter - перенос строки
                e.stopPropagation();
            } else if (e.key === 'Escape') {
                // Escape - отменить
                e.preventDefault();
                e.stopPropagation();
                textarea.removeEventListener('blur', blurHandler);
                textarea.removeEventListener('keydown', keydownHandler);
                finishEditing(true);
            }
        };

        textarea.addEventListener('blur', blurHandler);
        textarea.addEventListener('keydown', keydownHandler);
    }
}
