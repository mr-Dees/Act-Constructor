/**
 * Менеджер модального окна чата
 *
 * Управляет открытием/закрытием чата как модального окна
 * на страницах без встроенной чат-панели (acts-manager и др.).
 * ChatManager инициализируется лениво при первом открытии.
 */
class ChatModalManager {
    static _overlay = null;
    static _chatInitialized = false;
    /** @type {(e: KeyboardEvent) => void | null} */
    static _escapeHandler = null;
    /** @type {boolean} Привязан ли _escapeHandler сейчас к document */
    static _escapeAttached = false;

    /**
     * Открывает модальное окно чата
     */
    static open() {
        this._overlay = document.getElementById('chatModalOverlay');
        if (!this._overlay) return;

        this._overlay.classList.remove('hidden');
        document.body.classList.add('chat-modal-open');

        if (!this._chatInitialized) {
            ChatManager.init();
            this._setupCloseHandlers();
            this._chatInitialized = true;
        }

        // Подписываем Escape только на время открытия модалки.
        // Защита от двойного addEventListener — флагом _escapeAttached.
        if (this._escapeHandler && !this._escapeAttached) {
            document.addEventListener('keydown', this._escapeHandler);
            this._escapeAttached = true;
        }

        const input = this._overlay.querySelector('.chat-input');
        if (input && !input.disabled) setTimeout(() => input.focus(), 100);
    }

    /**
     * Закрывает модальное окно чата
     */
    static close() {
        if (!this._overlay) return;
        this._overlay.classList.add('hidden');
        document.body.classList.remove('chat-modal-open');

        // Снимаем глобальный keydown — чтобы Escape не срабатывал,
        // пока модалка скрыта, и не оставались утечки слушателей.
        if (this._escapeHandler && this._escapeAttached) {
            document.removeEventListener('keydown', this._escapeHandler);
            this._escapeAttached = false;
        }
    }

    /**
     * Настраивает обработчики закрытия: крестик, оверлей, Escape
     * @private
     */
    static _setupCloseHandlers() {
        // Крестик внутри чата
        const closeBtn = this._overlay.querySelector('.chat-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        // Клик по оверлею (вне контейнера)
        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) this.close();
        });

        // Escape — отдельная именованная функция, чтобы её можно было
        // снять через removeEventListener при close().
        this._escapeHandler = (e) => {
            if (e.key === 'Escape'
                && this._overlay
                && !this._overlay.classList.contains('hidden')) {
                this.close();
            }
        };
    }
}

// Экспортируем в глобальную область видимости
window.ChatModalManager = ChatModalManager;
