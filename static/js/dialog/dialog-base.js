// static/js/dialog/dialog-base.js
/**
 * Базовый менеджер диалоговых окон
 *
 * Предоставляет общий функционал для всех типов диалогов:
 * - Управление overlay
 * - Закрытие по Escape и клику вне диалога
 * - Блокировка прокрутки body
 * - Анимации открытия/закрытия
 */
class DialogBase {
    /**
     * Текущие активные диалоги (стек для вложенных диалогов)
     * @private
     * @type {HTMLElement[]}
     */
    static _activeDialogs = [];

    /**
     * Создает overlay элемент
     * @protected
     * @returns {HTMLElement} Элемент overlay
     */
    static _createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'custom-dialog-overlay';
        return overlay;
    }

    /**
     * Показывает диалог с анимацией
     * @protected
     * @param {HTMLElement} overlay - Overlay элемент
     */
    static _showDialog(overlay) {
        document.body.appendChild(overlay);
        this._activeDialogs.push(overlay);
        this._lockBodyScroll();

        // Принудительный reflow для анимации
        overlay.offsetHeight;
        overlay.classList.add('visible');
    }

    /**
     * Скрывает и удаляет диалог с анимацией
     * @protected
     * @param {HTMLElement} overlay - Overlay элемент для удаления
     * @param {number} [delay] - Задержка перед удалением (мс)
     */
    static _hideDialog(overlay, delay = AppConfig.dialog.closeDelay) {
        if (!overlay || !overlay.parentNode) return;

        const index = this._activeDialogs.indexOf(overlay);
        if (index > -1) {
            this._activeDialogs.splice(index, 1);
        }

        overlay.classList.add('closing');
        overlay.classList.remove('visible');

        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.remove();
            }

            // Разблокируем прокрутку только если нет других активных диалогов
            if (this._activeDialogs.length === 0) {
                this._unlockBodyScroll();
            }
        }, delay);
    }

    /**
     * Настраивает закрытие диалога по клику на overlay
     * @protected
     * @param {HTMLElement} overlay - Overlay элемент
     * @param {HTMLElement} dialog - Внутренний диалог (не должен закрываться при клике на него)
     * @param {Function} onClose - Callback при закрытии
     */
    static _setupOverlayClickHandler(overlay, dialog, onClose) {
        overlay.addEventListener('click', (e) => {
            // Закрываем только если клик был именно на overlay, а не на его содержимом
            if (e.target === overlay) {
                onClose();
            }
        });

        // Предотвращаем всплытие событий от диалога к overlay
        if (dialog) {
            dialog.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }

    /**
     * Настраивает обработчик закрытия по клавише Escape
     * @protected
     * @param {HTMLElement} overlay - Overlay элемент
     * @param {Function} onClose - Callback при закрытии
     */
    static _setupEscapeHandler(overlay, onClose) {
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                // Закрываем только самый верхний диалог
                if (this._activeDialogs[this._activeDialogs.length - 1] === overlay) {
                    onClose();
                    document.removeEventListener('keydown', escapeHandler);
                }
            }
        };
        document.addEventListener('keydown', escapeHandler);

        // Сохраняем ссылку на handler для возможности удаления
        overlay._escapeHandler = escapeHandler;
    }

    /**
     * Удаляет обработчик Escape при закрытии диалога
     * @protected
     * @param {HTMLElement} overlay - Overlay элемент
     */
    static _removeEscapeHandler(overlay) {
        if (overlay._escapeHandler) {
            document.removeEventListener('keydown', overlay._escapeHandler);
            delete overlay._escapeHandler;
        }
    }

    /**
     * Блокирует прокрутку основной страницы
     * @protected
     */
    static _lockBodyScroll() {
        if (!document.body.classList.contains('dialog-open')) {
            // Сохраняем текущую позицию прокрутки
            const scrollY = window.scrollY;
            document.body.style.top = `-${scrollY}px`;
            document.body.classList.add('dialog-open');
        }
    }

    /**
     * Разблокирует прокрутку основной страницы
     * @protected
     */
    static _unlockBodyScroll() {
        if (document.body.classList.contains('dialog-open')) {
            const scrollY = document.body.style.top;
            document.body.classList.remove('dialog-open');
            document.body.style.top = '';

            // Восстанавливаем позицию прокрутки
            if (scrollY) {
                window.scrollTo(0, parseInt(scrollY || '0') * -1);
            }
        }
    }

    /**
     * Создает простой элемент с классом и текстом
     * @protected
     * @param {string} tag - HTML-тег
     * @param {string} className - CSS-класс
     * @param {string} text - Текстовое содержимое
     * @returns {HTMLElement} Созданный элемент
     */
    static _createElement(tag, className, text) {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        return element;
    }

    /**
     * Создает кнопку с обработчиком клика
     * @protected
     * @param {string} className - CSS-класс кнопки
     * @param {string} text - Текст кнопки
     * @param {Function} onClick - Обработчик клика
     * @returns {HTMLElement} Элемент кнопки
     */
    static _createButton(className, text, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = text;
        button.addEventListener('click', onClick);
        return button;
    }

    /**
     * Клонирует template элемент
     * @protected
     * @param {string} templateId - ID template
     * @returns {DocumentFragment|null} Клонированный template
     */
    static _cloneTemplate(templateId) {
        const template = document.getElementById(templateId);
        if (!template) {
            console.error(`Template ${templateId} не найден`);
            return null;
        }
        return template.content.cloneNode(true);
    }

    /**
     * Заполняет поля в элементе данными
     * @protected
     * @param {Element} element - Элемент для заполнения
     * @param {string} fieldName - Имя поля (data-field)
     * @param {*} value - Значение для установки
     */
    static _fillField(element, fieldName, value) {
        const field = element.querySelector(`[data-field="${fieldName}"]`);
        if (!field) return;

        if (field.type === 'checkbox') {
            field.checked = !!value;
        } else if (field.type === 'number') {
            field.value = value !== null && value !== undefined ? value : '';
        } else if (field.tagName === 'BUTTON') {
            field.textContent = value;
        } else {
            if (field.textContent !== undefined && field.tagName !== 'INPUT' && field.tagName !== 'TEXTAREA' && field.tagName !== 'SELECT') {
                field.textContent = value;
            } else {
                field.value = value || '';
            }
        }
    }

    /**
     * Заполняет все поля с data-field атрибутом
     * @protected
     * @param {Element} element - Корневой элемент
     * @param {Object} data - Объект с данными {fieldName: value}
     */
    static _fillFields(element, data) {
        element.querySelectorAll('[data-field]').forEach(field => {
            const fieldName = field.getAttribute('data-field');
            if (data.hasOwnProperty(fieldName)) {
                const value = data[fieldName];

                if (field.type === 'checkbox') {
                    field.checked = !!value;
                } else if (field.type === 'number') {
                    field.value = value !== null && value !== undefined ? value : '';
                } else if (field.tagName === 'BUTTON') {
                    field.textContent = value;
                } else {
                    if (field.textContent !== undefined && field.tagName !== 'INPUT' && field.tagName !== 'TEXTAREA' && field.tagName !== 'SELECT') {
                        field.textContent = value;
                    } else {
                        field.value = value || '';
                    }
                }
            }
        });
    }

    /**
     * Получает количество активных диалогов
     * @returns {number} Количество открытых диалогов
     */
    static getActiveDialogsCount() {
        return this._activeDialogs.length;
    }

    /**
     * Закрывает все активные диалоги
     */
    static closeAllDialogs() {
        const dialogs = [...this._activeDialogs]; // Копия для безопасной итерации
        dialogs.forEach(dialog => {
            this._hideDialog(dialog, 0);
        });
        this._activeDialogs = [];
        this._unlockBodyScroll();
    }
}

// Глобальный доступ
window.DialogBase = DialogBase;
