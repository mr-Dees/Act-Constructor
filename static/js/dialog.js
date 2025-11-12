/**
 * Менеджер диалоговых окон
 *
 * Создает модальные окна для подтверждения действий и информирования пользователя.
 * Предоставляет единый интерфейс для всех диалогов в приложении.
 */
class DialogManager {
    /**
     * Показывает диалоговое окно с подтверждением
     *
     * @param {Object} options - Параметры диалога
     * @param {string} options.title - Заголовок диалога
     * @param {string} options.message - Текст сообщения
     * @param {string} [options.icon] - Иконка (эмодзи)
     * @param {string} [options.confirmText] - Текст кнопки подтверждения
     * @param {string} [options.cancelText] - Текст кнопки отмены
     * @returns {Promise<boolean>} Promise, который резолвится true при подтверждении, false при отмене
     */
    static show(options) {
        const {
            title = AppConfig.dialog.defaultTitle,
            message = AppConfig.dialog.defaultMessage,
            icon = AppConfig.dialog.defaultIcon,
            confirmText = AppConfig.dialog.defaultConfirmText,
            cancelText = AppConfig.dialog.defaultCancelText
        } = options;

        return new Promise((resolve) => {
            // Создаем оверлей с диалогом
            const overlay = this._createOverlay();
            const dialog = this._createDialog({
                title,
                message,
                icon,
                confirmText,
                cancelText,
                onConfirm: () => {
                    this.hide(overlay);
                    resolve(true);
                },
                onCancel: () => {
                    this.hide(overlay);
                    resolve(false);
                }
            });

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            // Закрытие по клику на оверлей
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.hide(overlay);
                    resolve(false);
                }
            });

            // Закрытие по Escape
            this._setupEscapeHandler(overlay, () => resolve(false));
        });
    }

    /**
     * Создает элемент оверлея
     * @private
     * @returns {HTMLElement} Элемент оверлея
     */
    static _createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'custom-dialog-overlay';
        return overlay;
    }

    /**
     * Создает диалоговое окно
     * @private
     * @param {Object} params - Параметры диалога
     * @returns {HTMLElement} Элемент диалога
     */
    static _createDialog(params) {
        const {title, message, icon, confirmText, cancelText, onConfirm, onCancel} = params;

        const dialog = document.createElement('div');
        dialog.className = 'custom-dialog';

        // Иконка
        const iconEl = this._createElement('div', 'dialog-icon', icon);

        // Заголовок
        const titleEl = this._createElement('h3', 'dialog-title', title);

        // Сообщение
        const messageEl = this._createElement('p', 'dialog-message', message);

        // Контейнер кнопок
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'dialog-buttons';

        // Кнопка отмены
        const cancelBtn = this._createButton(
            'btn btn-secondary',
            cancelText,
            onCancel
        );

        // Кнопка подтверждения
        const confirmBtn = this._createButton(
            'btn btn-primary',
            confirmText,
            onConfirm
        );

        // Собираем диалог
        buttonsContainer.appendChild(cancelBtn);
        buttonsContainer.appendChild(confirmBtn);

        dialog.appendChild(iconEl);
        dialog.appendChild(titleEl);
        dialog.appendChild(messageEl);
        dialog.appendChild(buttonsContainer);

        return dialog;
    }

    /**
     * Создает простой элемент с классом и текстом
     * @private
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
     * @private
     * @param {string} className - CSS-класс кнопки
     * @param {string} text - Текст кнопки
     * @param {Function} onClick - Обработчик клика
     * @returns {HTMLElement} Элемент кнопки
     */
    static _createButton(className, text, onClick) {
        const button = document.createElement('button');
        button.className = className;
        button.textContent = text;
        button.addEventListener('click', onClick);
        return button;
    }

    /**
     * Настраивает обработчик закрытия по клавише Escape
     * @private
     * @param {HTMLElement} overlay - Элемент оверлея
     * @param {Function} onEscape - Callback при нажатии Escape
     */
    static _setupEscapeHandler(overlay, onEscape) {
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                onEscape();
                this.hide(overlay);
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }

    /**
     * Скрывает и удаляет диалоговое окно с анимацией
     * @param {HTMLElement} overlay - Элемент оверлея для удаления
     */
    static hide(overlay) {
        if (overlay && overlay.parentNode) {
            overlay.classList.add('hidden');
            setTimeout(() => {
                overlay.remove();
            }, AppConfig.dialog.closeDelay);
        }
    }
}
