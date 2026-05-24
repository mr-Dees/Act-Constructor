/**
 * UI-контроллер чата
 *
 * Управляет блокировкой ввода, прокруткой и авторесайзом textarea.
 * Реагирует на события шины, не знает о других модулях.
 *
 * Typing-индикатор больше не отдельный DOM-узел: он встроен в bot-bubble
 * как плейсхолдер `.chat-typing-placeholder` и удаляется при первом блоке
 * ответа (см. ChatRenderer.createTypingPlaceholder / removeTypingPlaceholder).
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
