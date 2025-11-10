/**
 * Менеджер диалоговых окон
 * Создает модальные окна для подтверждения действий
 */
class DialogManager {
    /**
     * Показывает диалоговое окно с подтверждением
     * @param {Object} options - Параметры диалога
     * @param {string} options.title - Заголовок диалога
     * @param {string} options.message - Текст сообщения
     * @param {string} options.icon - Иконка (эмодзи)
     * @param {string} options.confirmText - Текст кнопки подтверждения
     * @param {string} options.cancelText - Текст кнопки отмены
     * @param {Function} options.onConfirm - Callback при подтверждении
     * @param {Function} options.onCancel - Callback при отмене
     * @returns {HTMLElement} Элемент оверлея
     */
    static show(options) {
        const {
            title = 'Подтверждение',
            message = 'Вы уверены?',
            icon = '⚠️',
            confirmText = 'Да',
            cancelText = 'Отмена',
            onConfirm = () => {
            },
            onCancel = () => {
            }
        } = options;

        // Создаем оверлей
        const overlay = document.createElement('div');
        overlay.className = 'custom-dialog-overlay';

        // Создаем диалоговое окно
        const dialog = document.createElement('div');
        dialog.className = 'custom-dialog';

        // Иконка
        const iconEl = document.createElement('div');
        iconEl.className = 'dialog-icon';
        iconEl.textContent = icon;

        // Заголовок
        const titleEl = document.createElement('h3');
        titleEl.className = 'dialog-title';
        titleEl.textContent = title;

        // Сообщение
        const messageEl = document.createElement('p');
        messageEl.className = 'dialog-message';
        messageEl.textContent = message;

        // Контейнер кнопок
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'dialog-buttons';

        // Кнопка отмены
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.textContent = cancelText;
        cancelBtn.addEventListener('click', () => {
            onCancel();
            this.hide(overlay);
        });

        // Кнопка подтверждения
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.textContent = confirmText;
        confirmBtn.addEventListener('click', () => {
            onConfirm();
            this.hide(overlay);
        });

        // Собираем диалог
        buttonsContainer.appendChild(cancelBtn);
        buttonsContainer.appendChild(confirmBtn);

        dialog.appendChild(iconEl);
        dialog.appendChild(titleEl);
        dialog.appendChild(messageEl);
        dialog.appendChild(buttonsContainer);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Закрытие по клику на оверлей
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                onCancel();
                this.hide(overlay);
            }
        });

        // Закрытие по Escape
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                onCancel();
                this.hide(overlay);
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);

        return overlay;
    }

    /**
     * Скрывает и удаляет диалоговое окно
     * @param {HTMLElement} overlay - Элемент оверлея для удаления
     */
    static hide(overlay) {
        if (overlay && overlay.parentNode) {
            overlay.classList.add('hidden');
            setTimeout(() => {
                overlay.remove();
            }, 200);
        }
    }
}
