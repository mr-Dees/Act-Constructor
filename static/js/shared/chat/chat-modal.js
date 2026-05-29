/**
 * Менеджер модального окна чата
 *
 * Управляет открытием/закрытием чата как модального окна
 * на страницах без встроенной чат-панели (acts-manager и др.).
 * ChatManager инициализируется лениво при первом открытии.
 */
import { ChatManager } from './chat-manager.js';
import { EscapeStack } from '../escape-stack.js';

export class ChatModalManager {
    static _overlay = null;
    static _chatInitialized = false;
    /** @type {(() => void) | null} EscapeStack unsubscribe handle */
    static _escapeUnsub = null;

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

        // Подписываем Escape только на время открытия модалки — через EscapeStack.
        if (!this._escapeUnsub) {
            this._escapeUnsub = EscapeStack.push(() => this.close());
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

        // Снимаем регистрацию в EscapeStack, чтобы ESC не срабатывал,
        // пока модалка скрыта.
        if (this._escapeUnsub) {
            this._escapeUnsub();
            this._escapeUnsub = null;
        }
    }

    /**
     * Настраивает обработчики закрытия: крестик, оверлей
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

        // Escape — через EscapeStack (push в open, unsub в close).
    }
}

// Экспортируем в глобальную область видимости
window.ChatModalManager = ChatModalManager;
