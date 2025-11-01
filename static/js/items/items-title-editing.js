/**
 * Модуль для редактирования заголовков элементов документа.
 * Обеспечивает inline-редактирование заголовков пунктов, названий таблиц.
 */
class ItemsTitleEditing {
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
     * Запускает режим редактирования заголовка узла дерева.
     * Универсальный метод для редактирования любых типов узлов в дереве.
     * @param {HTMLElement} labelElement - DOM-элемент метки узла
     * @param {Object} node - Узел дерева
     * @param {TreeManager} treeManager - Экземпляр менеджера дерева
     */
    static startEditingTreeNode(labelElement, node, treeManager) {
        const item = labelElement.closest('.tree-item');
        if (item.classList.contains('editing')) return;

        item.classList.add('editing');
        labelElement.contentEditable = true;
        treeManager.editingElement = labelElement;

        const originalLabel = node.label;

        if (node.type === 'table' || node.type === 'textblock' || node.type === 'violation') {
            const currentLabel = node.customLabel || node.label;
            labelElement.textContent = currentLabel;
        }

        labelElement.focus();
        const range = document.createRange();
        range.selectNodeContents(labelElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        const finishEditing = (cancel = false) => {
            labelElement.contentEditable = false;
            item.classList.remove('editing');
            treeManager.editingElement = null;

            if (cancel) {
                labelElement.textContent = originalLabel;
                return;
            }

            const newLabel = labelElement.textContent.trim();

            if (node.type === 'table' || node.type === 'textblock' || node.type === 'violation') {
                if (newLabel && newLabel !== node.label) {
                    node.customLabel = newLabel;
                    node.label = newLabel;
                } else if (!newLabel) {
                    delete node.customLabel;
                    node.label = node.number || originalLabel;
                    AppState.generateNumbering();
                    labelElement.textContent = node.label;
                }
                treeManager.render();
                PreviewManager.update();
            } else {
                if (newLabel && newLabel !== originalLabel) {
                    node.label = newLabel;
                    AppState.generateNumbering();
                    treeManager.render();
                    PreviewManager.update();
                } else if (!newLabel) {
                    labelElement.textContent = originalLabel;
                } else {
                    labelElement.textContent = node.label;
                }
            }
        };

        const blurHandler = () => finishEditing(false);
        const keydownHandler = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                labelElement.removeEventListener('blur', blurHandler);
                labelElement.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                labelElement.removeEventListener('blur', blurHandler);
                labelElement.removeEventListener('keydown', keydownHandler);
                finishEditing(true);
            }
        };

        labelElement.addEventListener('blur', blurHandler);
        labelElement.addEventListener('keydown', keydownHandler);
    }
}
