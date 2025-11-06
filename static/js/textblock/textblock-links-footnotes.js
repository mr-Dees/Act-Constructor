/**
 * Расширение TextBlockManager для работы с гиперссылками и сносками
 */

Object.assign(TextBlockManager.prototype, {
    /**
     * Текущий активный popup и tooltip
     */
    currentPopup: null,
    currentTooltip: null,
    tooltipTimeout: null,

    /**
     * Создает или редактирует гиперссылку
     */
    createOrEditLink() {
        if (!this.activeEditor) return;

        const selection = window.getSelection();

        // Проверяем, есть ли выделенный текст
        if (!selection || selection.isCollapsed) {
            alert('Выделите текст для создания гиперссылки');
            return;
        }

        // Проверяем, не находимся ли мы уже внутри ссылки
        let existingLink = this.findParentLink(selection.anchorNode);
        const isEditing = !!existingLink;

        // Получаем текущий URL, если редактируем
        const currentUrl = existingLink ? existingLink.getAttribute('data-link-url') : '';

        // Показываем диалог ввода URL
        const url = prompt('Введите URL гиперссылки:', currentUrl);

        if (url === null) return; // Отмена

        if (!url.trim()) {
            // Если URL пустой - удаляем ссылку
            if (existingLink) {
                this.removeLinkOrFootnote(existingLink);
            }
            return;
        }

        // Сохраняем выделение
        const range = selection.getRangeAt(0);
        let selectedText = range.toString();

        if (isEditing) {
            // Обновляем существующую ссылку
            existingLink.setAttribute('data-link-url', url);
            this.attachLinkFootnoteHandlers();
        } else {
            // Убираем пробелы в конце выделенного текста
            const trailingSpaces = selectedText.match(/\s+$/);
            const trailingSpaceText = trailingSpaces ? trailingSpaces[0] : '';
            selectedText = selectedText.trimEnd();

            if (!selectedText) {
                alert('Текст ссылки не может состоять только из пробелов');
                return;
            }

            // Создаем новую ссылку
            const linkId = 'link_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            const linkSpan = document.createElement('span');
            linkSpan.className = 'text-link';
            linkSpan.setAttribute('data-link-id', linkId);
            linkSpan.setAttribute('data-link-url', url);
            linkSpan.contentEditable = 'false';
            linkSpan.textContent = selectedText;

            // Заменяем выделение на ссылку
            range.deleteContents();
            range.insertNode(linkSpan);

            // Применяем форматирование от окружающего текста
            this.inheritFormattingToElement(linkSpan);

            // Добавляем обратно пробелы, которые были в конце
            let spaceNode = null;
            if (trailingSpaceText) {
                spaceNode = document.createTextNode(trailingSpaceText);
                linkSpan.parentNode.insertBefore(spaceNode, linkSpan.nextSibling);
            }

            // Проверяем, нужен ли еще пробел после ссылки
            const nextNode = spaceNode ? spaceNode.nextSibling : linkSpan.nextSibling;
            const needsSpace = !spaceNode &&
                (!nextNode ||
                    (nextNode.nodeType === 3 && !nextNode.textContent.startsWith(' ')) ||
                    (nextNode.nodeType === 1));

            if (needsSpace) {
                const space = document.createTextNode(' ');
                if (spaceNode) {
                    spaceNode.parentNode.insertBefore(space, spaceNode.nextSibling);
                } else {
                    linkSpan.parentNode.insertBefore(space, linkSpan.nextSibling);
                }
                spaceNode = space;
            }

            // Устанавливаем курсор после пробела или ссылки
            if (spaceNode) {
                range.setStartAfter(spaceNode);
                range.setEndAfter(spaceNode);
            } else {
                range.setStartAfter(linkSpan);
                range.setEndAfter(linkSpan);
            }

            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);

            // Обновляем обработчики событий
            this.attachLinkFootnoteHandlers();
        }

        // Сохраняем изменения
        const textBlockId = this.activeEditor.dataset.textBlockId;
        this.saveContent(textBlockId, this.activeEditor.innerHTML);
    },

    /**
     * Создает или редактирует сноску
     */
    createOrEditFootnote() {
        if (!this.activeEditor) return;

        const selection = window.getSelection();

        // Проверяем, есть ли выделенный текст
        if (!selection || selection.isCollapsed) {
            alert('Выделите текст для создания сноски');
            return;
        }

        // Проверяем, не находимся ли мы уже внутри сноски
        let existingFootnote = this.findParentFootnote(selection.anchorNode);
        const isEditing = !!existingFootnote;

        // Получаем текущий текст сноски, если редактируем
        const currentNote = existingFootnote ? existingFootnote.getAttribute('data-footnote-text') : '';

        // Показываем диалог ввода текста сноски
        const noteText = prompt('Введите текст сноски:', currentNote);

        if (noteText === null) return; // Отмена

        if (!noteText.trim()) {
            // Если текст пустой - удаляем сноску
            if (existingFootnote) {
                this.removeLinkOrFootnote(existingFootnote);
            }
            return;
        }

        // Сохраняем выделение
        const range = selection.getRangeAt(0);
        let selectedText = range.toString();

        if (isEditing) {
            // Обновляем существующую сноску
            existingFootnote.setAttribute('data-footnote-text', noteText);
            this.attachLinkFootnoteHandlers();
        } else {
            // Убираем пробелы в конце выделенного текста
            const trailingSpaces = selectedText.match(/\s+$/);
            const trailingSpaceText = trailingSpaces ? trailingSpaces[0] : '';
            selectedText = selectedText.trimEnd();

            if (!selectedText) {
                alert('Текст сноски не может состоять только из пробелов');
                return;
            }

            // Создаем новую сноску
            const footnoteId = 'footnote_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            const footnoteSpan = document.createElement('span');
            footnoteSpan.className = 'text-footnote';
            footnoteSpan.setAttribute('data-footnote-id', footnoteId);
            footnoteSpan.setAttribute('data-footnote-text', noteText);
            footnoteSpan.contentEditable = 'false';
            footnoteSpan.textContent = selectedText;

            // Заменяем выделение на сноску
            range.deleteContents();
            range.insertNode(footnoteSpan);

            // Применяем форматирование от окружающего текста
            this.inheritFormattingToElement(footnoteSpan);

            // Добавляем обратно пробелы, которые были в конце
            let spaceNode = null;
            if (trailingSpaceText) {
                spaceNode = document.createTextNode(trailingSpaceText);
                footnoteSpan.parentNode.insertBefore(spaceNode, footnoteSpan.nextSibling);
            }

            // Проверяем, нужен ли еще пробел после сноски
            const nextNode = spaceNode ? spaceNode.nextSibling : footnoteSpan.nextSibling;
            const needsSpace = !spaceNode &&
                (!nextNode ||
                    (nextNode.nodeType === 3 && !nextNode.textContent.startsWith(' ')) ||
                    (nextNode.nodeType === 1));

            if (needsSpace) {
                const space = document.createTextNode(' ');
                if (spaceNode) {
                    spaceNode.parentNode.insertBefore(space, spaceNode.nextSibling);
                } else {
                    footnoteSpan.parentNode.insertBefore(space, footnoteSpan.nextSibling);
                }
                spaceNode = space;
            }

            // Устанавливаем курсор после пробела или сноски
            if (spaceNode) {
                range.setStartAfter(spaceNode);
                range.setEndAfter(spaceNode);
            } else {
                range.setStartAfter(footnoteSpan);
                range.setEndAfter(footnoteSpan);
            }

            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);

            // Обновляем обработчики событий
            this.attachLinkFootnoteHandlers();
        }

        // Сохраняем изменения
        const textBlockId = this.activeEditor.dataset.textBlockId;
        this.saveContent(textBlockId, this.activeEditor.innerHTML);
    },

    /**
     * Включает режим inline-редактирования по двойному клику
     */
    enableInlineEditing(element) {
        const originalText = element.textContent;

        // Добавляем класс для визуального эффекта
        element.classList.add('editing-mode');

        // Делаем элемент редактируемым
        element.contentEditable = 'true';

        // Фокусируемся и выделяем весь текст
        setTimeout(() => {
            element.focus();

            // Выделяем весь текст
            const range = document.createRange();
            range.selectNodeContents(element);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }, 0);

        // Функция завершения редактирования
        const finishEditing = (save = true) => {
            if (!element.classList.contains('editing-mode')) return;

            element.classList.remove('editing-mode');
            element.contentEditable = 'false';

            if (save) {
                const newText = element.textContent.trim();

                if (!newText) {
                    // Если текст пустой, восстанавливаем оригинальный
                    element.textContent = originalText;
                } else {
                    // Сохраняем изменения
                    if (this.activeEditor) {
                        const textBlockId = this.activeEditor.dataset.textBlockId;
                        this.saveContent(textBlockId, this.activeEditor.innerHTML);
                    }
                }
            } else {
                // Отмена - восстанавливаем оригинальный текст
                element.textContent = originalText;
            }

            // Убираем фокус
            element.blur();

            // Удаляем обработчики
            document.removeEventListener('click', outsideClickHandler);
            document.removeEventListener('keydown', keyHandler);
        };

        // Обработчик клика вне элемента
        const outsideClickHandler = (e) => {
            if (!element.contains(e.target)) {
                finishEditing(true);
            }
        };

        // Обработчик клавиш
        const keyHandler = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finishEditing(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishEditing(false);
            }
        };

        // Добавляем обработчики с небольшой задержкой
        setTimeout(() => {
            document.addEventListener('click', outsideClickHandler);
            document.addEventListener('keydown', keyHandler);
        }, 100);
    },

    /**
     * Находит родительский элемент ссылки
     */
    findParentLink(node) {
        if (!node) return null;

        let current = node.nodeType === 3 ? node.parentElement : node;

        while (current && current !== this.activeEditor) {
            if (current.classList && current.classList.contains('text-link')) {
                return current;
            }
            current = current.parentElement;
        }

        return null;
    },

    /**
     * Находит родительский элемент сноски
     */
    findParentFootnote(node) {
        if (!node) return null;

        let current = node.nodeType === 3 ? node.parentElement : node;

        while (current && current !== this.activeEditor) {
            if (current.classList && current.classList.contains('text-footnote')) {
                return current;
            }
            current = current.parentElement;
        }

        return null;
    },

    /**
     * Удаляет ссылку или сноску, сохраняя только размер шрифта
     */
    removeLinkOrFootnote(element) {
        if (!element) return;

        const text = element.textContent;
        const prevNode = element.previousSibling;
        const nextNode = element.nextSibling;

        // Получаем только размер шрифта элемента перед удалением
        const computedStyle = window.getComputedStyle(element);
        const fontSize = computedStyle.fontSize;

        // Проверяем окружение элемента
        const hasPrevText = prevNode && prevNode.nodeType === 3 && prevNode.textContent.trim();
        const hasNextText = nextNode && nextNode.nodeType === 3 && nextNode.textContent.trim();
        const prevEndsWithSpace = prevNode && prevNode.nodeType === 3 && /\s$/.test(prevNode.textContent);
        const nextStartsWithSpace = nextNode && nextNode.nodeType === 3 && /^\s/.test(nextNode.textContent);

        // Определяем, нужен ли пробел для предотвращения слипания
        const needsSpaceBefore = hasPrevText && !prevEndsWithSpace;
        const needsSpaceAfter = hasNextText && !nextStartsWithSpace;

        // Формируем итоговый текст с учетом пробелов
        let replacementText = text;
        if (needsSpaceBefore) {
            replacementText = ' ' + replacementText;
        }
        if (needsSpaceAfter) {
            replacementText = replacementText + ' ';
        }

        // Создаем span только с размером шрифта
        const formattedSpan = document.createElement('span');
        formattedSpan.textContent = replacementText;

        // Применяем только размер шрифта
        if (fontSize) {
            formattedSpan.style.fontSize = fontSize;
        }

        // Заменяем ссылку/сноску на span только с fontSize
        element.parentNode.replaceChild(formattedSpan, element);

        // Сохраняем изменения
        if (this.activeEditor) {
            const textBlockId = this.activeEditor.dataset.textBlockId;
            this.saveContent(textBlockId, this.activeEditor.innerHTML);
        }
    },

    /**
     * Показывает контекстное меню по ПКМ с редактируемыми полями
     */
    showLinkFootnotePopup(element, x, y) {
        // Удаляем существующие popup'ы
        this.hideLinkFootnotePopup();
        this.hideTooltip();

        const isLink = element.classList.contains('text-link');
        const content = isLink
            ? element.getAttribute('data-link-url')
            : element.getAttribute('data-footnote-text');
        const displayText = element.textContent;

        if (!content) return;

        // Создаем popup с редактируемыми полями
        const popup = document.createElement('div');
        popup.className = 'link-footnote-popup';
        popup.innerHTML = `
            <div class="link-footnote-popup-header">
                <span class="link-footnote-popup-label">${isLink ? '🔗 Ссылка' : '📑 Сноска'}</span>
                <button class="popup-delete-btn" title="Удалить">🗑️</button>
            </div>
            <div class="link-footnote-popup-content">
                <div class="popup-field">
                    <label class="popup-field-label">Отображаемый текст:</label>
                    <input type="text" class="link-footnote-popup-text-input" value="${this.escapeHtml(displayText)}">
                </div>
                <div class="popup-field">
                    <label class="popup-field-label">${isLink ? 'URL:' : 'Текст сноски:'}</label>
                    <textarea class="link-footnote-popup-input" rows="3">${this.escapeHtml(content)}</textarea>
                </div>
            </div>
        `;

        document.body.appendChild(popup);

        // Позиционируем popup
        let left = x;
        let top = y;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const popupRect = popup.getBoundingClientRect();

        if (left + popupRect.width > viewportWidth) {
            left = viewportWidth - popupRect.width - 10;
        }
        if (left < 10) {
            left = 10;
        }

        if (top + popupRect.height > viewportHeight) {
            top = viewportHeight - popupRect.height - 10;
        }
        if (top < 10) {
            top = 10;
        }

        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;

        // Получаем поля для редактирования
        const textInput = popup.querySelector('.link-footnote-popup-text-input');
        const textarea = popup.querySelector('.link-footnote-popup-input');

        // Фокусируемся на первом поле и выделяем текст
        setTimeout(() => {
            textInput.focus();
            textInput.select();
        }, 0);

        // Функция сохранения изменений
        const saveChanges = () => {
            const newDisplayText = textInput.value.trim();
            const newValue = textarea.value.trim();

            if (!newDisplayText) {
                alert('Отображаемый текст не может быть пустым');
                return false;
            }

            if (!newValue) {
                alert(isLink ? 'URL не может быть пустым' : 'Текст сноски не может быть пустым');
                return false;
            }

            // Обновляем отображаемый текст
            element.textContent = newDisplayText;

            // Обновляем URL или текст сноски
            if (isLink) {
                element.setAttribute('data-link-url', newValue);
            } else {
                element.setAttribute('data-footnote-text', newValue);
            }

            // Сохраняем изменения
            if (this.activeEditor) {
                const textBlockId = this.activeEditor.dataset.textBlockId;
                this.saveContent(textBlockId, this.activeEditor.innerHTML);
            }

            return true;
        };

        // Обработчики клавиш
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                textarea.focus();
                textarea.select();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.hideLinkFootnotePopup();
            }
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (saveChanges()) {
                    this.hideLinkFootnotePopup();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.hideLinkFootnotePopup();
            }
        });

        // Кнопка удаления
        popup.querySelector('.popup-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideLinkFootnotePopup();
            this.removeLinkOrFootnote(element);
        });

        this.currentPopup = popup;

        // Управление закрытием popup
        let selectionStartedInside = false;

        popup.addEventListener('mousedown', (e) => {
            selectionStartedInside = true;
        });

        const globalMouseDownHandler = (e) => {
            if (!popup.contains(e.target)) {
                selectionStartedInside = false;
            }
        };

        document.addEventListener('mousedown', globalMouseDownHandler);

        const clickHandler = (e) => {
            if (!popup.contains(e.target) && !selectionStartedInside) {
                const textChanged = textInput.value.trim() !== displayText;
                const valueChanged = textarea.value.trim() !== content;

                if (textChanged || valueChanged) {
                    saveChanges();
                }

                this.hideLinkFootnotePopup();
                document.removeEventListener('click', clickHandler);
                document.removeEventListener('mousedown', globalMouseDownHandler);
            }

            selectionStartedInside = false;
        };

        setTimeout(() => {
            document.addEventListener('click', clickHandler);
        }, 0);

        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.hideLinkFootnotePopup();
                document.removeEventListener('keydown', escapeHandler);
                document.removeEventListener('click', clickHandler);
                document.removeEventListener('mousedown', globalMouseDownHandler);
            }
        };

        document.addEventListener('keydown', escapeHandler);

        popup._cleanupHandlers = () => {
            document.removeEventListener('keydown', escapeHandler);
            document.removeEventListener('click', clickHandler);
            document.removeEventListener('mousedown', globalMouseDownHandler);
        };
    },

    /**
     * Скрывает popup
     */
    hideLinkFootnotePopup() {
        if (this.currentPopup) {
            if (this.currentPopup._cleanupHandlers) {
                this.currentPopup._cleanupHandlers();
            }

            this.currentPopup.remove();
            this.currentPopup = null;
        }
    },

    /**
     * Показывает кастомный tooltip при наведении
     */
    showTooltip(element, event) {
        this.hideTooltip();

        const isLink = element.classList.contains('text-link');
        const content = isLink
            ? element.getAttribute('data-link-url')
            : element.getAttribute('data-footnote-text');

        if (!content) return;

        const tooltip = document.createElement('div');
        tooltip.className = 'link-footnote-tooltip';
        tooltip.textContent = content;

        document.body.appendChild(tooltip);

        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        let top = rect.bottom + 8;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (left + tooltipRect.width > viewportWidth) {
            left = viewportWidth - tooltipRect.width - 10;
        }
        if (left < 10) {
            left = 10;
        }

        if (top + tooltipRect.height > viewportHeight) {
            top = rect.top - tooltipRect.height - 8;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;

        this.currentTooltip = tooltip;
    },

    /**
     * Скрывает tooltip
     */
    hideTooltip() {
        if (this.currentTooltip) {
            this.currentTooltip.remove();
            this.currentTooltip = null;
        }
        if (this.tooltipTimeout) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
    },

    /**
     * Экранирует HTML для безопасного отображения
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Привязывает обработчики событий к ссылкам и сноскам
     */
    attachLinkFootnoteHandlers() {
        if (!this.activeEditor) return;

        const links = this.activeEditor.querySelectorAll('.text-link');
        const footnotes = this.activeEditor.querySelectorAll('.text-footnote');

        [...links, ...footnotes].forEach(element => {
            // Удаляем старые обработчики
            if (element._contextmenuHandler) {
                element.removeEventListener('contextmenu', element._contextmenuHandler);
            }
            if (element._mouseenterHandler) {
                element.removeEventListener('mouseenter', element._mouseenterHandler);
            }
            if (element._mouseleaveHandler) {
                element.removeEventListener('mouseleave', element._mouseleaveHandler);
            }
            if (element._dblclickHandler) {
                element.removeEventListener('dblclick', element._dblclickHandler);
            }

            // Обработчик контекстного меню (ПКМ)
            element._contextmenuHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showLinkFootnotePopup(element, e.clientX, e.clientY);
            };

            // Обработчик двойного клика (ЛКМ x2)
            element._dblclickHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.enableInlineEditing(element);
            };

            // Обработчик наведения для tooltip
            element._mouseenterHandler = (e) => {
                if (element.classList.contains('editing-mode')) return;

                this.tooltipTimeout = setTimeout(() => {
                    this.showTooltip(element, e);
                }, 700);
            };

            // Обработчик ухода мыши
            element._mouseleaveHandler = () => {
                this.hideTooltip();
            };

            // Привязываем обработчики
            element.addEventListener('contextmenu', element._contextmenuHandler);
            element.addEventListener('dblclick', element._dblclickHandler);
            element.addEventListener('mouseenter', element._mouseenterHandler);
            element.addEventListener('mouseleave', element._mouseleaveHandler);

            // Предотвращаем случайное редактирование
            element.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, true);
        });
    }
});

/**
 * Расширяем обработчик фокуса редактора
 */
const originalHandleEditorFocus = TextBlockManager.prototype.handleEditorFocus;
TextBlockManager.prototype.handleEditorFocus = function (editor, textBlock) {
    originalHandleEditorFocus.call(this, editor, textBlock);
    this.attachLinkFootnoteHandlers();

    // Применяем форматирование к существующим ссылкам и сноскам при загрузке
    setTimeout(() => {
        this.applyFormattingToNewNodes(editor);
    }, 100);
};
