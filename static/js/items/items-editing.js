/**
 * Модуль для редактирования элементов документа.
 * Обеспечивает inline-редактирование заголовков пунктов, названий таблиц
 * и содержимого ячеек таблиц с поддержкой многострочного ввода.
 * Поддерживает горячие клавиши: Enter для сохранения, Escape для отмены.
 */
class ItemsEditing {
    /**
     * Запускает режим редактирования заголовка обычного пункта документа.
     * Извлекает базовую метку без нумерации, позволяет отредактировать,
     * затем восстанавливает нумерацию и обновляет дерево и предпросмотр.
     * @param {HTMLElement} titleElement - DOM-элемент заголовка для редактирования
     * @param {Object} node - Узел дерева, связанный с заголовком
     */
    static startEditingItemTitle(titleElement, node) {
        // Предотвращаем повторный вход в режим редактирования
        if (titleElement.classList.contains('editing')) {
            return;
        }

        titleElement.classList.add('editing');
        titleElement.contentEditable = 'true';

        // Извлекаем базовую метку без нумерации (убираем "1.2.3. ")
        const labelMatch = node.label.match(/^\d+(?:\.\d+)*\.\s*(.+)$/);
        const baseLabel = labelMatch ? labelMatch[1] : node.label;
        const originalLabel = node.label;

        titleElement.textContent = baseLabel;
        titleElement.focus();

        // Выделяем весь текст для удобного редактирования
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        /**
         * Завершает редактирование заголовка и сохраняет или отменяет изменения.
         * При сохранении восстанавливает нумерацию и обновляет UI.
         * @param {boolean} cancel - Если true, отменяет изменения и восстанавливает оригинал
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
                // Сохраняем нумерацию при обновлении метки
                const numberMatch = node.label.match(/^(\d+(?:\.\d+)*\.)\s*/);
                if (numberMatch) {
                    node.label = numberMatch[1] + ' ' + newBaseLabel;
                } else {
                    node.label = newBaseLabel;
                }

                // Перегенерируем нумерацию всего дерева
                AppState.generateNumbering();
                titleElement.textContent = node.label;
                treeManager.render();
                PreviewManager.update();
            } else if (!newBaseLabel) {
                // Возвращаем старую метку если новая пустая (валидация)
                titleElement.textContent = originalLabel;
            } else {
                titleElement.textContent = node.label;
            }
        };

        // Сохранение при потере фокуса (клик вне элемента)
        const blurHandler = () => {
            finishEditing(false);
        };

        // Обработка горячих клавиш
        const keydownHandler = (e) => {
            if (e.key === 'Enter') {
                // Enter - сохранить изменения
                e.preventDefault();
                e.stopPropagation();
                titleElement.removeEventListener('blur', blurHandler);
                titleElement.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Escape') {
                // Escape - отменить изменения
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
     * Запускает режим редактирования заголовка таблицы.
     * Позволяет задать пользовательское название таблицы (customLabel).
     * Если название очищено, возвращает автоматическую нумерацию.
     * @param {HTMLElement} titleElement - DOM-элемент заголовка таблицы
     * @param {Object} node - Узел дерева таблицы
     */
    static startEditingTableTitle(titleElement, node) {
        // Предотвращаем повторный вход в режим редактирования
        if (titleElement.classList.contains('editing')) {
            return;
        }

        titleElement.classList.add('editing');
        titleElement.contentEditable = 'true';

        // Используем пользовательскую метку или автоматическую
        const currentLabel = node.customLabel || node.label;
        const originalLabel = currentLabel;

        titleElement.textContent = currentLabel;
        titleElement.focus();

        // Выделяем весь текст для удобного редактирования
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        /**
         * Завершает редактирование заголовка таблицы.
         * Сохраняет пользовательское название или удаляет его при пустом значении.
         * @param {boolean} cancel - Если true, отменяет изменения
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
                // Сохраняем пользовательское название
                node.customLabel = newLabel;
                node.label = newLabel;
            } else {
                // Удаляем кастомное название если пустое (вернется автонумерация)
                delete node.customLabel;
                node.label = node.number || originalLabel;
            }

            // Обновляем нумерацию и UI
            AppState.generateNumbering();
            titleElement.textContent = node.label;
            treeManager.render();
            PreviewManager.update();
        };

        // Сохранение при потере фокуса
        const blurHandler = () => {
            finishEditing(false);
        };

        // Обработка горячих клавиш
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
     * Запускает режим редактирования содержимого ячейки таблицы.
     * Создает textarea для многострочного ввода с поддержкой Shift+Enter для переноса строк.
     * Сохраняет изменения в матричную grid-структуру таблицы в AppState.
     * @param {HTMLElement} cellEl - DOM-элемент ячейки таблицы
     */
    static startEditingCell(cellEl) {
        const originalContent = cellEl.textContent;
        cellEl.classList.add('editing');

        // Создаем textarea для многострочного редактирования
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
         * Завершает редактирование ячейки и сохраняет или отменяет изменения.
         * Обновляет содержимое в матричной grid-структуре таблицы.
         * @param {boolean} cancel - Если true, отменяет изменения
         */
        const finishEditing = (cancel = false) => {
            if (cancel) {
                cellEl.textContent = originalContent;
            } else {
                const newValue = textarea.value.trim();
                cellEl.textContent = newValue;

                // Обновляем данные в матричной grid-структуре таблицы
                const tableId = cellEl.dataset.tableId;
                const row = parseInt(cellEl.dataset.row);
                const col = parseInt(cellEl.dataset.col);
                const table = AppState.tables[tableId];

                // Проверяем существование ячейки в grid и что она не поглощена объединением
                if (table && table.grid && table.grid[row] && table.grid[row][col]) {
                    if (!table.grid[row][col].isSpanned) {
                        table.grid[row][col].content = newValue;
                    }
                }

                PreviewManager.update();
            }

            cellEl.classList.remove('editing');
        };

        // Сохранение при потере фокуса
        const blurHandler = () => {
            finishEditing(false);
        };

        // Обработка горячих клавиш
        const keydownHandler = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // Enter без Shift - сохранить и выйти из редактирования
                e.preventDefault();
                e.stopPropagation();
                textarea.removeEventListener('blur', blurHandler);
                textarea.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Enter' && e.shiftKey) {
                // Shift+Enter - перенос строки внутри ячейки
                e.stopPropagation();
            } else if (e.key === 'Escape') {
                // Escape - отменить изменения
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
