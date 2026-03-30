/**
 * Обработчик контекстного меню для ссылок и сносок
 */
class LinkFootnoteContextMenu {
    constructor() {
        this.currentPopup = null;
        this.textBlockManager = null;
    }

    /**
     * Инициализирует менеджер с ссылкой на TextBlockManager
     */
    init(textBlockManager) {
        this.textBlockManager = textBlockManager;
    }

    /**
     * Показывает контекстное меню по ПКМ с редактируемыми полями
     */
    show(x, y, params = {}) {
        const {element} = params;

        if (!element) {
            console.error('LinkFootnoteContextMenu: element обязателен');
            return;
        }

        this.hide();

        const isLink = element.classList.contains('text-link');
        const content = isLink
            ? element.getAttribute('data-link-url')
            : element.getAttribute('data-footnote-text');
        const displayText = element.textContent;

        if (!content) return;

        this.currentPopup = this.createPopup(element, isLink, content, displayText);
        this.positionPopup(this.currentPopup, x, y);
        this.attachPopupHandlers(this.currentPopup, element, isLink, content, displayText);

        document.body.appendChild(this.currentPopup);
    }

    /**
     * Создает DOM для popup'а
     */
    createPopup(element, isLink, content, displayText) {
        const popup = document.createElement('div');
        popup.className = 'link-footnote-popup';
        popup.style.cssText = `
            position: fixed;
            background: white;
            border: 1px solid var(--border, #e0e0e0);
            border-radius: var(--radius, 4px);
            box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.15));
            z-index: 10001;
            min-width: 300px;
            padding: 12px;
            font-family: inherit;
        `;

        popup.innerHTML = `
            <div class="link-footnote-popup-header" style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
                border-bottom: 1px solid var(--border, #e0e0e0);
                padding-bottom: 8px;
            ">
                <span class="link-footnote-popup-label" style="font-weight: 500;">
                    ${isLink ? '🔗 Ссылка' : '📑 Сноска'}
                </span>
                <button class="popup-delete-btn" title="Удалить" style="
                    background: none;
                    border: none;
                    cursor: pointer;
                    font-size: 16px;
                    padding: 0;
                    transition: opacity 0.2s;
                ">🗑️</button>
            </div>
            <div class="link-footnote-popup-content">
                <div class="popup-field" style="margin-bottom: 12px;">
                    <label class="popup-field-label" style="
                        display: block;
                        margin-bottom: 4px;
                        font-size: 0.875rem;
                        color: var(--text-secondary, #666);
                    ">Отображаемый текст:</label>
                    <input type="text" class="link-footnote-popup-text-input" 
                        value="${this.escapeHtml(displayText)}" style="
                        width: 100%;
                        padding: 6px 8px;
                        border: 1px solid var(--border, #e0e0e0);
                        border-radius: 3px;
                        font-size: 0.875rem;
                        font-family: inherit;
                        box-sizing: border-box;
                    ">
                </div>
                <div class="popup-field">
                    <label class="popup-field-label" style="
                        display: block;
                        margin-bottom: 4px;
                        font-size: 0.875rem;
                        color: var(--text-secondary, #666);
                    ">${isLink ? 'URL:' : 'Текст сноски:'}</label>
                    <textarea class="link-footnote-popup-input" rows="3" style="
                        width: 100%;
                        padding: 6px 8px;
                        border: 1px solid var(--border, #e0e0e0);
                        border-radius: 3px;
                        font-size: 0.875rem;
                        font-family: inherit;
                        resize: vertical;
                        box-sizing: border-box;
                    ">${this.escapeHtml(content)}</textarea>
                </div>
            </div>
        `;

        return popup;
    }

    /**
     * Позиционирует popup с проверкой границ viewport
     */
    positionPopup(popup, x, y) {
        popup.style.left = `${x}px`;
        popup.style.top = `${y}px`;

        requestAnimationFrame(() => {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const popupRect = popup.getBoundingClientRect();

            let left = x;
            let top = y;

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
        });
    }

    /**
     * Привязывает обработчики к элементам popup'а
     */
    attachPopupHandlers(popup, element, isLink, originalContent, originalDisplayText) {
        const textInput = popup.querySelector('.link-footnote-popup-text-input');
        const textarea = popup.querySelector('.link-footnote-popup-input');
        const deleteBtn = popup.querySelector('.popup-delete-btn');

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
            if (this.textBlockManager && this.textBlockManager.activeEditor) {
                const textBlockId = this.textBlockManager.activeEditor.dataset.textBlockId;
                this.textBlockManager.saveContent(textBlockId, this.textBlockManager.activeEditor.innerHTML);
            }

            return true;
        };

        // Обработчики клавиш для textInput
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                textarea.focus();
                textarea.select();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.hide();
            }
        });

        // Обработчики клавиш для textarea
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (saveChanges()) {
                    this.hide();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.hide();
            }
        });

        // Кнопка удаления
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hide();
            if (this.textBlockManager) {
                this.textBlockManager.removeLinkOrFootnote(element);
            }
        });

        // Обработчик наведения на кнопку удаления
        deleteBtn.addEventListener('mouseenter', () => {
            deleteBtn.style.opacity = '0.7';
        });

        deleteBtn.addEventListener('mouseleave', () => {
            deleteBtn.style.opacity = '1';
        });

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
                const textChanged = textInput.value.trim() !== originalDisplayText;
                const valueChanged = textarea.value.trim() !== originalContent;

                if (textChanged || valueChanged) {
                    saveChanges();
                }

                this.hide();
                document.removeEventListener('click', clickHandler);
                document.removeEventListener('mousedown', globalMouseDownHandler);
                document.removeEventListener('keydown', escapeHandler);
            }

            selectionStartedInside = false;
        };

        setTimeout(() => {
            document.addEventListener('click', clickHandler);
        }, 0);

        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.hide();
                document.removeEventListener('keydown', escapeHandler);
                document.removeEventListener('click', clickHandler);
                document.removeEventListener('mousedown', globalMouseDownHandler);
            }
        };

        document.addEventListener('keydown', escapeHandler);

        // Сохраняем обработчики для последующей очистки
        popup._cleanupHandlers = () => {
            document.removeEventListener('keydown', escapeHandler);
            document.removeEventListener('click', clickHandler);
            document.removeEventListener('mousedown', globalMouseDownHandler);
        };
    }

    /**
     * Скрывает popup и очищает обработчики
     */
    hide() {
        if (this.currentPopup) {
            if (this.currentPopup._cleanupHandlers) {
                this.currentPopup._cleanupHandlers();
            }

            this.currentPopup.remove();
            this.currentPopup = null;
        }
    }

    /**
     * Экранирует HTML для безопасного отображения
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
