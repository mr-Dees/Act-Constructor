// static/js/dialog/dialog-confirm.js
/**
 * Менеджер диалоговых окон подтверждения
 *
 * Создает модальные окна для подтверждения действий и информирования пользователя.
 * Наследует базовый функционал от DialogBase.
 */
class DialogManager extends DialogBase {
    /**
     * Показывает диалоговое окно с подтверждением
     *
     * @param {Object} options - Параметры диалога
     * @param {string} [options.title='Подтверждение'] - Заголовок диалога
     * @param {string} [options.message='Вы уверены?'] - Текст сообщения
     * @param {string} [options.icon='⚠️'] - Иконка (эмодзи)
     * @param {string} [options.confirmText='Да'] - Текст кнопки подтверждения
     * @param {string} [options.cancelText='Отмена'] - Текст кнопки отмены
     * @param {string} [options.type='warning'] - Тип диалога (success, warning, error, info)
     * @returns {Promise<boolean>} Promise, который резолвится true при подтверждении, false при отмене
     */
    static show(options = {}) {
        const {
            title = 'Подтверждение',
            message = 'Вы уверены?',
            icon = '⚠️',
            confirmText = 'Да',
            cancelText = 'Отмена',
            type = 'warning'
        } = options;

        return new Promise((resolve) => {
            // Создаем overlay и диалог
            const overlay = this._createOverlay();
            const dialog = this._createConfirmDialog({
                title,
                message,
                icon,
                confirmText,
                cancelText,
                type,
                onConfirm: () => {
                    this._closeAndResolve(overlay, resolve, true);
                },
                onCancel: () => {
                    this._closeAndResolve(overlay, resolve, false);
                }
            });

            overlay.appendChild(dialog);

            // Находим внутренний диалог для правильной обработки кликов
            const dialogElement = overlay.querySelector('.custom-dialog');

            // Показываем диалог
            this._showDialog(overlay);

            // Настраиваем закрытие по клику вне диалога
            this._setupOverlayClickHandler(overlay, dialogElement, () => {
                this._closeAndResolve(overlay, resolve, false);
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
     * @param {HTMLElement} overlay - Элемент overlay
     * @param {Function} resolve - Функция resolve промиса
     * @param {boolean} result - Результат для resolve
     */
    static _closeAndResolve(overlay, resolve, result) {
        this._removeEscapeHandler(overlay);
        this._hideDialog(overlay);
        resolve(result);
    }

    /**
     * Создает диалоговое окно подтверждения
     * @private
     * @param {Object} params - Параметры диалога
     * @param {string} params.title - Заголовок
     * @param {string} params.message - Сообщение
     * @param {string} params.icon - Иконка
     * @param {string} params.confirmText - Текст кнопки подтверждения
     * @param {string} params.cancelText - Текст кнопки отмены
     * @param {string} params.type - Тип диалога
     * @param {Function} params.onConfirm - Обработчик подтверждения
     * @param {Function} params.onCancel - Обработчик отмены
     * @returns {HTMLElement} Элемент диалога
     */
    static _createConfirmDialog(params) {
        const {title, message, icon, confirmText, cancelText, type, onConfirm, onCancel} = params;

        const dialog = document.createElement('div');
        dialog.className = 'custom-dialog';

        // Иконка с типом
        const iconEl = this._createElement('div', `dialog-icon ${type}`, icon);

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

        const cancelBtn = this._createButton('btn btn-secondary dialog-cancel', cancelText, onCancel);
        const confirmBtn = this._createButton('btn btn-primary dialog-confirm', confirmText, onConfirm);

        container.appendChild(cancelBtn);
        container.appendChild(confirmBtn);

        return container;
    }

    /**
     * Показывает информационное сообщение (без кнопки отмены)
     * @param {Object} options - Параметры диалога
     * @param {string} [options.title='Информация'] - Заголовок
     * @param {string} [options.message] - Сообщение
     * @param {string} [options.icon='ℹ️'] - Иконка
     * @param {string} [options.confirmText='ОК'] - Текст кнопки
     * @param {string} [options.type='info'] - Тип диалога
     * @returns {Promise<boolean>} Promise, который всегда резолвится true
     */
    static alert(options = {}) {
        const {
            title = 'Информация',
            message = '',
            icon = 'ℹ️',
            confirmText = 'ОК',
            type = 'info'
        } = options;

        return new Promise((resolve) => {
            const overlay = this._createOverlay();
            const dialog = this._createAlertDialog({
                title,
                message,
                icon,
                confirmText,
                type,
                onConfirm: () => {
                    this._closeAndResolve(overlay, resolve, true);
                }
            });

            overlay.appendChild(dialog);

            const dialogElement = overlay.querySelector('.custom-dialog');

            this._showDialog(overlay);

            this._setupOverlayClickHandler(overlay, dialogElement, () => {
                this._closeAndResolve(overlay, resolve, true);
            });

            this._setupEscapeHandler(overlay, () => {
                this._closeAndResolve(overlay, resolve, true);
            });
        });
    }

    /**
     * Создает диалоговое окно-оповещение (только одна кнопка)
     * @private
     */
    static _createAlertDialog(params) {
        const {title, message, icon, confirmText, type, onConfirm} = params;

        const dialog = document.createElement('div');
        dialog.className = 'custom-dialog';

        const iconEl = this._createElement('div', `dialog-icon ${type}`, icon);
        const titleEl = this._createElement('h3', 'dialog-title', title);
        const messageEl = this._createElement('p', 'dialog-message', message);

        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'dialog-buttons';
        const confirmBtn = this._createButton('btn btn-primary dialog-confirm', confirmText, onConfirm);
        buttonsContainer.appendChild(confirmBtn);

        dialog.appendChild(iconEl);
        dialog.appendChild(titleEl);
        dialog.appendChild(messageEl);
        dialog.appendChild(buttonsContainer);

        return dialog;
    }
}

// Глобальный доступ
window.DialogManager = DialogManager;
