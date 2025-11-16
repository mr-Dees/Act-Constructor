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
     * @param {string} [options.title] - Заголовок диалога
     * @param {string} [options.message] - Текст сообщения
     * @param {string} [options.icon] - Иконка (эмодзи)
     * @param {string} [options.confirmText] - Текст кнопки подтверждения
     * @param {string} [options.cancelText] - Текст кнопки отмены
     * @returns {Promise<boolean>} Promise, который резолвится true при подтверждении, false при отмене
     */
    static show(options = {}) {
        const {
            title = 'Подтверждение',
            message = 'Вы уверены?',
            icon = '⚠️',
            confirmText = 'Да',
            cancelText = 'Отмена'
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
                    this._closeAndResolve(overlay, resolve, true);
                },
                onCancel: () => {
                    this._closeAndResolve(overlay, resolve, false);
                }
            });

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            // Закрытие по клику на оверлей
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this._closeAndResolve(overlay, resolve, false);
                }
            });

            // Закрытие по Escape
            this._setupEscapeHandler(overlay, () => {
                this._closeAndResolve(overlay, resolve, false);
            });
        });
    }

    /**
     * Закрывает диалог и резолвит промис
     * @private
     * @param {HTMLElement} overlay - Элемент оверлея
     * @param {Function} resolve - Функция resolve промиса
     * @param {boolean} result - Результат для resolve
     */
    static _closeAndResolve(overlay, resolve, result) {
        this.hide(overlay);
        resolve(result);
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
     * @param {string} params.title - Заголовок
     * @param {string} params.message - Сообщение
     * @param {string} params.icon - Иконка
     * @param {string} params.confirmText - Текст кнопки подтверждения
     * @param {string} params.cancelText - Текст кнопки отмены
     * @param {Function} params.onConfirm - Обработчик подтверждения
     * @param {Function} params.onCancel - Обработчик отмены
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
        const buttonsContainer = this._createButtonsContainer(
            confirmText,
            cancelText,
            onConfirm,
            onCancel
        );

        // Собираем диалог
        dialog.appendChild(iconEl);
        dialog.appendChild(titleEl);
        dialog.appendChild(messageEl);
        dialog.appendChild(buttonsContainer);

        return dialog;
    }

    /**
     * Создает контейнер с кнопками
     * @private
     * @param {string} confirmText - Текст кнопки подтверждения
     * @param {string} cancelText - Текст кнопки отмены
     * @param {Function} onConfirm - Обработчик подтверждения
     * @param {Function} onCancel - Обработчик отмены
     * @returns {HTMLElement} Контейнер с кнопками
     */
    static _createButtonsContainer(confirmText, cancelText, onConfirm, onCancel) {
        const container = document.createElement('div');
        container.className = 'dialog-buttons';

        const cancelBtn = this._createButton('btn btn-secondary', cancelText, onCancel);
        const confirmBtn = this._createButton('btn btn-primary', confirmText, onConfirm);

        container.appendChild(cancelBtn);
        container.appendChild(confirmBtn);

        return container;
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
        if (!overlay || !overlay.parentNode) return;

        overlay.classList.add('hidden');
        setTimeout(() => {
            overlay.remove();
        }, AppConfig.dialog.closeDelay);
    }
}
