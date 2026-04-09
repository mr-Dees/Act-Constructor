/**
 * UI-контроллер чата
 *
 * Управляет typing-индикатором, блокировкой ввода,
 * прокруткой и авторесайзом textarea.
 * Реагирует на события шины, не знает о других модулях.
 */
const ChatUI = {

    /** @type {boolean} */
    _initialized: false,
    /** @type {HTMLElement|null} */
    _messagesContainer: null,
    /** @type {HTMLInputElement|null} */
    _input: null,
    /** @type {HTMLButtonElement|null} */
    _sendBtn: null,
    /** @type {boolean} */
    _isProcessing: false,

    /**
     * Инициализация: кеширование DOM и подписка на события
     *
     * @param {Object} data
     * @param {HTMLElement} data.messagesContainer
     * @param {HTMLInputElement} data.input
     * @param {HTMLButtonElement} data.sendBtn
     */
    init({ messagesContainer, input, sendBtn }) {
        if (this._initialized) return;
        this._messagesContainer = messagesContainer;
        this._input = input;
        this._sendBtn = sendBtn;

        ChatEventBus.on('ui:processing', (data) => this._setProcessing(data.state));
        ChatEventBus.on('ui:scroll-bottom', () => this._scrollToBottom());
        ChatEventBus.on('ui:typing-show', () => this._showTypingIndicator());
        ChatEventBus.on('ui:typing-hide', () => this._removeTypingIndicator());

        this._initialized = true;
    },

    /**
     * Возвращает текущее состояние обработки
     * @returns {boolean}
     */
    isProcessing() {
        return this._isProcessing;
    },

    /**
     * Авторесайз textarea: подстраивает высоту под содержимое (макс. 5 строк)
     */
    autoResizeInput() {
        if (!this._input) return;
        this._input.style.height = 'auto';
        const maxHeight = parseInt(getComputedStyle(this._input).lineHeight, 10) * 5 || 120;
        this._input.style.height = Math.min(this._input.scrollHeight, maxHeight) + 'px';
    },

    /**
     * Устанавливает состояние обработки (блокировка UI)
     * @param {boolean} state
     * @private
     */
    _setProcessing(state) {
        this._isProcessing = state;

        const container = this._input?.closest('.chat-input-container');
        if (container) {
            container.classList.toggle('processing', state);
        }

        if (this._sendBtn) this._sendBtn.disabled = state;
        if (this._input) this._input.disabled = state;

        if (!state && this._input) {
            this._input.focus();
        }
    },

    /**
     * Показывает typing-индикатор (три анимированные точки)
     * @private
     */
    _showTypingIndicator() {
        if (!this._messagesContainer) return;

        const indicator = document.createElement('div');
        indicator.className = 'chat-message chat-message-bot chat-typing-indicator';

        const avatar = document.createElement('div');
        avatar.className = 'chat-message-avatar';
        avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

        const content = document.createElement('div');
        content.className = 'chat-message-content';
        content.innerHTML = '<span class="chat-typing-dot"></span><span class="chat-typing-dot"></span><span class="chat-typing-dot"></span>';

        indicator.appendChild(avatar);
        indicator.appendChild(content);

        this._messagesContainer.appendChild(indicator);
        this._scrollToBottom();
    },

    /**
     * Убирает typing-индикатор
     * @private
     */
    _removeTypingIndicator() {
        if (!this._messagesContainer) return;
        const indicator = this._messagesContainer.querySelector('.chat-typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    },

    /**
     * Прокручивает контейнер сообщений вниз
     * @private
     */
    _scrollToBottom() {
        if (this._messagesContainer) {
            this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
        }
    },
};

window.ChatUI = ChatUI;
