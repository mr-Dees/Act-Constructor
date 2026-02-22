/**
 * Модуль для редактирования заголовков элементов документа.
 * Обеспечивает inline-редактирование заголовков пунктов, названий таблиц и узлов дерева.
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
        if (titleElement.classList.contains('editing')) return;

        const originalLabel = node.label;

        this._initializeEditing(titleElement, node.label);

        const finishEditing = (cancel = false) => {
            this._cleanupEditing(titleElement);

            if (cancel) {
                titleElement.textContent = originalLabel;
                return;
            }

            this._saveItemTitle(titleElement, node, originalLabel);
        };

        this._attachEditingHandlers(titleElement, finishEditing);
    }

    /**
     * Инициализирует режим редактирования элемента.
     * Делает элемент редактируемым, устанавливает текст и фокус.
     * @param {HTMLElement} element - Элемент для редактирования
     * @param {string} text - Начальный текст
     * @private
     */
    static _initializeEditing(element, text) {
        element.classList.add('editing');
        element.contentEditable = 'true';
        element.textContent = text;
        element.focus();

        this._selectAllText(element);
    }

    /**
     * Выделяет весь текст в элементе для удобного редактирования.
     * @param {HTMLElement} element - Элемент с текстом
     * @private
     */
    static _selectAllText(element) {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    /**
     * Очищает режим редактирования элемента.
     * Убирает contentEditable и класс editing.
     * @param {HTMLElement} element - Элемент для очистки
     * @private
     */
    static _cleanupEditing(element) {
        element.contentEditable = 'false';
        element.classList.remove('editing');
    }

    /**
     * Сохраняет отредактированный заголовок пункта.
     * Восстанавливает нумерацию и обновляет UI.
     * @param {HTMLElement} titleElement - Элемент заголовка
     * @param {Object} node - Узел дерева
     * @param {string} baseLabel - Исходная базовая метка
     * @param {string} originalLabel - Исходная полная метка
     * @private
     */
    static _saveItemTitle(titleElement, node, originalLabel) {
        const newLabel = titleElement.textContent.trim();

        if (!newLabel) {
            // Возвращаем старую метку если новая пустая
            titleElement.textContent = originalLabel;
            return;
        }

        if (newLabel !== originalLabel) {
            node.label = newLabel;
            this._updateUI(node, titleElement);
        } else {
            titleElement.textContent = node.label;
        }
    }

    /**
     * Обновляет UI после изменения метки.
     * Перегенерирует нумерацию, обновляет дерево и предпросмотр.
     * @param {Object} node - Узел дерева
     * @param {HTMLElement} titleElement - Элемент заголовка
     * @private
     */
    static _updateUI(node, titleElement) {
        titleElement.textContent = node.label;
        treeManager.render();
        PreviewManager.update();
    }

    /**
     * Запускает режим редактирования заголовка таблицы.
     * Позволяет задать пользовательское название таблицы (customLabel).
     * Если название очищено, возвращает автоматическую нумерацию.
     * @param {HTMLElement} titleElement - DOM-элемент заголовка таблицы
     * @param {Object} node - Узел дерева таблицы
     */
    static startEditingTableTitle(titleElement, node) {
        if (titleElement.classList.contains('editing')) return;

        const currentLabel = node.customLabel || node.number || node.label;
        this._initializeEditing(titleElement, currentLabel);

        const finishEditing = (cancel = false) => {
            this._cleanupEditing(titleElement);

            if (cancel) {
                titleElement.textContent = currentLabel;
                return;
            }

            this._saveTableTitle(titleElement, node, currentLabel);
        };

        this._attachEditingHandlers(titleElement, finishEditing);
    }

    /**
     * Сохраняет отредактированный заголовок таблицы.
     * Устанавливает customLabel или удаляет его при пустом значении.
     * @param {HTMLElement} titleElement - Элемент заголовка таблицы
     * @param {Object} node - Узел дерева таблицы
     * @param {string} originalLabel - Исходная метка
     * @private
     */
    static _saveTableTitle(titleElement, node, originalLabel) {
        const newLabel = titleElement.textContent.trim();

        if (newLabel) {
            // Сохраняем пользовательское название
            node.customLabel = newLabel;
        } else {
            // Удаляем кастомное название (вернется автонумерация)
            delete node.customLabel;
        }

        titleElement.textContent = node.customLabel || node.number || node.label;
        treeManager.render();
        PreviewManager.update();
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
        treeManager.editingElement = labelElement;

        const originalLabel = node.label;
        const isSpecialType = ['table', 'textblock', 'violation'].includes(node.type);

        // Для специальных типов используем customLabel
        if (isSpecialType) {
            labelElement.textContent = node.customLabel || node.number || node.label;
        }

        this._initializeEditing(labelElement, labelElement.textContent);

        const finishEditing = (cancel = false) => {
            this._cleanupTreeNodeEditing(labelElement, item, treeManager);

            if (cancel) {
                if (isSpecialType) {
                    labelElement.textContent = node.customLabel || node.number || node.label;
                } else {
                    labelElement.textContent = originalLabel;
                }
                return;
            }

            this._saveTreeNodeLabel(labelElement, node, originalLabel, isSpecialType);
        };

        this._attachEditingHandlers(labelElement, finishEditing);
    }

    /**
     * Очищает режим редактирования узла дерева.
     * Убирает классы и сбрасывает состояние менеджера дерева.
     * @param {HTMLElement} labelElement - Элемент метки
     * @param {HTMLElement} item - Элемент узла дерева
     * @param {TreeManager} treeManager - Экземпляр менеджера дерева
     * @private
     */
    static _cleanupTreeNodeEditing(labelElement, item, treeManager) {
        labelElement.contentEditable = 'false';
        item.classList.remove('editing');
        treeManager.editingElement = null;
    }

    /**
     * Сохраняет отредактированную метку узла дерева.
     * Обрабатывает специальные и обычные типы узлов по-разному.
     * @param {HTMLElement} labelElement - Элемент метки
     * @param {Object} node - Узел дерева
     * @param {string} originalLabel - Исходная метка
     * @param {boolean} isSpecialType - Является ли узел специальным типом
     * @private
     */
    static _saveTreeNodeLabel(labelElement, node, originalLabel, isSpecialType) {
        const newLabel = labelElement.textContent.trim();

        if (isSpecialType) {
            this._saveSpecialNodeLabel(labelElement, node, newLabel, originalLabel);
        } else {
            this._saveRegularNodeLabel(labelElement, node, newLabel, originalLabel);
        }
    }

    /**
     * Сохраняет метку специального узла (таблица, текстовый блок, нарушение).
     * Устанавливает customLabel или восстанавливает автоматическую нумерацию.
     * @param {HTMLElement} labelElement - Элемент метки
     * @param {Object} node - Узел дерева
     * @param {string} newLabel - Новая метка
     * @param {string} originalLabel - Исходная метка
     * @private
     */
    static _saveSpecialNodeLabel(labelElement, node, newLabel, originalLabel) {
        if (newLabel && newLabel !== (node.customLabel || node.number || node.label)) {
            node.customLabel = newLabel;
        } else if (!newLabel) {
            delete node.customLabel;
        }

        labelElement.textContent = node.customLabel || node.number || node.label;
        this._updateTreeUI();
    }

    /**
     * Сохраняет метку обычного узла.
     * Обновляет label и перегенерирует нумерацию.
     * @param {HTMLElement} labelElement - Элемент метки
     * @param {Object} node - Узел дерева
     * @param {string} newLabel - Новая метка
     * @param {string} originalLabel - Исходная метка
     * @private
     */
    static _saveRegularNodeLabel(labelElement, node, newLabel, originalLabel) {
        if (newLabel && newLabel !== originalLabel) {
            node.label = newLabel;
            this._updateTreeUI();
        } else if (!newLabel) {
            labelElement.textContent = originalLabel;
        } else {
            labelElement.textContent = node.label;
        }
    }

    /**
     * Обновляет UI дерева и предпросмотра.
     * Вызывается после изменения структуры или меток дерева.
     * @private
     */
    static _updateTreeUI() {
        treeManager.render();
        PreviewManager.update();
    }

    /**
     * Привязывает обработчики событий для редактирования.
     * Обрабатывает потерю фокуса (blur) и нажатия клавиш (Enter/Escape).
     * @param {HTMLElement} element - Редактируемый элемент
     * @param {Function} finishCallback - Callback для завершения редактирования
     * @private
     */
    static _attachEditingHandlers(element, finishCallback) {
        const blurHandler = () => finishCallback(false);

        const keydownHandler = (e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                element.removeEventListener('blur', blurHandler);
                element.removeEventListener('keydown', keydownHandler);
                finishCallback(e.key === 'Escape');
            }
        };

        element.addEventListener('blur', blurHandler);
        element.addEventListener('keydown', keydownHandler);
    }
}
