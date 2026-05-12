/**
 * Менеджер чата с AI-ассистентом — фасад
 *
 * Тонкий оркестратор: инициализирует модули, делегирует
 * вызовы через ChatEventBus. Сохраняет обратную совместимость
 * публичного API для ChatModalManager, ChatPopupManager и LandingPage.
 *
 * Модули:
 *   ChatEventBus  — шина событий
 *   ChatUI        — typing, processing, scroll, resize
 *   ChatFiles     — валидация, drag-drop, превью файлов
 *   ChatContext   — KB, домены, conversation management
 *   ChatMessages  — отправка, SSE-роутинг, рендеринг сообщений
 */
class ChatManager {

    /** @type {boolean} */
    static _initialized = false;
    /** @type {HTMLInputElement|null} */
    static _input = null;

    /**
     * Инициализация: кеширование DOM, запуск модулей
     */
    static init() {
        if (this._initialized) return;

        const messagesContainer = document.querySelector('.chat-messages');
        const input = document.querySelector('.chat-input');
        const sendBtn = document.querySelector('.chat-send-btn');

        if (!messagesContainer || !input || !sendBtn) {
            console.warn('ChatManager: не найдены необходимые DOM-элементы');
            return;
        }

        // Активируем input и кнопку
        input.disabled = false;
        input.placeholder = 'Введите сообщение...';
        sendBtn.disabled = false;

        // Скрываем placeholder
        const placeholder = document.querySelector('.chat-placeholder');
        if (placeholder) {
            placeholder.classList.add('chat-placeholder-hidden');
        }

        // Инициализация модулей
        const domRefs = { messagesContainer, input, sendBtn };

        ChatUI.init(domRefs);
        ChatFiles.init(domRefs);
        ChatMessages.init(domRefs);
        ChatContext.init();

        // Кнопка очистки чата
        const clearBtn = document.querySelector('.chat-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearChat());
        }

        // Обработчики ввода
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        input.addEventListener('input', () => {
            ChatUI.autoResizeInput();
        });

        sendBtn.addEventListener('click', () => {
            this.sendMessage();
        });

        this._input = input;
        this._initialized = true;
        console.log('ChatManager: инициализация завершена');
    }

    /**
     * Отправляет сообщение пользователя
     */
    static async sendMessage() {
        if (ChatUI.isProcessing()) return;

        const text = this._input.value.trim();
        if (!text) return;

        const files = ChatFiles.getPendingFiles();

        this._input.value = '';
        ChatUI.autoResizeInput();

        ChatEventBus.emit('chat:send-request', { text, files });
    }

    /**
     * Полная очистка чата
     */
    static clearChat() {
        if (ChatUI.isProcessing()) return;

        ChatFiles.clear();
        ChatEventBus.emit('chat:clear');
    }
}

window.ChatManager = ChatManager;
