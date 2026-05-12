/**
 * Менеджер сообщений чата
 *
 * Отправка сообщений через SSE, обработка событий стриминга,
 * рендеринг user/bot сообщений в DOM.
 */
const ChatMessages = {

    /** @type {boolean} */
    _initialized: false,
    /** @type {HTMLElement|null} */
    _messagesContainer: null,

    /** @type {Object<number, {element: HTMLElement, appendText: function, finalize: function}>} */
    _streamingBlocks: {},

    /** @type {string} HTML welcome-сообщения для восстановления при очистке */
    _welcomeHtml: '',

    /**
     * Инициализация: кеширование DOM, подписка на события
     *
     * @param {Object} data
     * @param {HTMLElement} data.messagesContainer
     */
    init({ messagesContainer }) {
        if (this._initialized) return;
        this._messagesContainer = messagesContainer;

        // Кэшируем welcome-сообщение для восстановления при очистке
        const welcomeEl = this._messagesContainer.querySelector('.chat-message-bot');
        if (welcomeEl) {
            this._welcomeHtml = welcomeEl.outerHTML;
        }

        ChatEventBus.on('chat:send-request', (data) => this._send(data));
        ChatEventBus.on('context:conversation-switched', (data) => {
            ChatStream.abort();
            this._renderConversationMessages(data);
        });
        ChatEventBus.on('context:conversation-cleared', () => {
            ChatStream.abort();
            this._restoreWelcome();
        });
        ChatEventBus.on('chat:clear', () => {
            ChatStream.abort();
            this._streamingBlocks = {};
            this._restoreWelcome();
        });

        this._initialized = true;
    },

    /**
     * Отправляет сообщение пользователя
     *
     * @param {Object} data
     * @param {string} data.text — текст сообщения
     * @param {File[]} data.files — прикреплённые файлы
     * @private
     */
    async _send({ text, files }) {
        ChatEventBus.emit('ui:processing', { state: true });

        try {
            const conversationId = await ChatContext.ensureConversation();

            // Рендерим user-сообщение
            if (files.length > 0) {
                const fileBlocks = files.map(f => ({
                    type: 'file', name: f.name, size: f.size,
                }));
                this._renderUserMessageWithFiles(text, fileBlocks);
            } else {
                this._addUserMessage(text);
            }

            ChatFiles.clear();
            ChatEventBus.emit('ui:typing-show');

            const botContainer = this._addBotMessageStreaming({ hidden: true });

            await ChatStream.send(conversationId, text, files, {
                domains: ChatContext.detectDomains(),
                onEvent: (event) => {
                    this._handleSSEEvent(event, botContainer);
                },
                onError: (err) => {
                    console.error('ChatMessages: ошибка стриминга', err);
                    ChatEventBus.emit('ui:typing-hide');
                    const msgEl = botContainer.closest('.chat-message');
                    if (msgEl) msgEl.style.display = '';
                    const errDiv = document.createElement('div');
                    errDiv.className = 'chat-error';
                    errDiv.textContent = 'Произошла ошибка. Попробуйте ещё раз.';
                    botContainer.appendChild(errDiv);
                },
                onDone: () => {
                    ChatEventBus.emit('ui:typing-hide');
                    ChatEventBus.emit('ui:scroll-bottom');
                },
            });
        } catch (err) {
            ChatEventBus.emit('ui:typing-hide');
            console.error('ChatMessages: ошибка отправки', err);
            this.renderMessage('bot', 'Произошла ошибка. Попробуйте ещё раз.');
        } finally {
            ChatEventBus.emit('ui:processing', { state: false });
        }
    },

    /**
     * Обрабатывает SSE-событие и маршрутизирует к ChatRenderer
     *
     * @param {{type: string, data: *}} event — SSE-событие
     * @param {HTMLElement} container — контейнер бот-сообщения
     * @private
     */
    _handleSSEEvent(event, container) {
        switch (event.type) {
            case 'message_start':
                this._streamingBlocks = {};
                ChatEventBus.emit('ui:typing-hide');
                const msgEl = container.closest('.chat-message');
                if (msgEl) msgEl.style.display = '';
                break;

            case 'block_start': {
                if (event.data.type === 'client_action') {
                    // client_action приходит как отдельное событие — игнорируем block_start
                    break;
                }
                const sb = ChatRenderer.createStreamingBlock(event.data.type);
                this._streamingBlocks[event.data.index] = sb;
                ChatRenderer.appendBlock(container, sb.element);
                break;
            }

            case 'block_delta': {
                const block = this._streamingBlocks[event.data.index];
                if (block) block.appendText(event.data.delta || event.data.content || '');
                break;
            }

            case 'block_end': {
                const endBlock = this._streamingBlocks[event.data.index];
                if (endBlock) endBlock.finalize();
                break;
            }

            case 'tool_call':
                break;

            case 'tool_result':
                break;

            case 'plan_update':
                ChatRenderer.updatePlan(container, event.data.steps);
                break;

            case 'buttons': {
                const btnBlock = ChatRenderer.renderBlock({ type: 'buttons', ...event.data });
                if (btnBlock) ChatRenderer.appendBlock(container, btnBlock);
                break;
            }

            case 'client_action': {
                // Команда выполняется немедленно (live-стрим).
                const ca = event.data.block || {};
                const el = ChatRenderer.renderBlock(
                    { type: 'client_action', ...ca },
                    { execute: true },
                );
                if (el) ChatRenderer.appendBlock(container, el);
                break;
            }

            case 'error': {
                const errDiv = document.createElement('div');
                errDiv.className = 'chat-error';
                errDiv.textContent =
                    event.data.error || event.data.message || 'Произошла ошибка';
                container.appendChild(errDiv);
                break;
            }

            case 'message_end':
                this._streamingBlocks = {};
                break;
        }

        ChatEventBus.emit('ui:scroll-bottom');
    },

    /**
     * Создаёт пустой DOM бот-сообщения для стриминга
     * @returns {HTMLElement} — контейнер .chat-message-content
     * @private
     */
    _addBotMessageStreaming({ hidden = false } = {}) {
        const msg = document.createElement('div');
        msg.className = 'chat-message chat-message-bot';
        if (hidden) msg.style.display = 'none';

        const avatar = document.createElement('div');
        avatar.className = 'chat-message-avatar';
        avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

        const content = document.createElement('div');
        content.className = 'chat-message-content';

        msg.appendChild(avatar);
        msg.appendChild(content);

        this._messagesContainer.appendChild(msg);

        return content;
    },

    /**
     * Добавляет сообщение пользователя в DOM
     * @param {string} text
     * @private
     */
    _addUserMessage(text) {
        this.renderMessage('user', text);
    },

    /**
     * Рендерит пользовательское сообщение с файлами
     *
     * @param {string} text — текст сообщения
     * @param {Array<Object>} fileBlocks — файловые блоки
     * @private
     */
    _renderUserMessageWithFiles(text, fileBlocks) {
        const msg = document.createElement('div');
        msg.className = 'chat-message chat-message-user';

        const avatar = document.createElement('div');
        avatar.className = 'chat-message-avatar';
        avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

        const content = document.createElement('div');
        content.className = 'chat-message-content';

        if (text) {
            const lines = text.split('\n');
            for (const line of lines) {
                const p = document.createElement('p');
                p.textContent = line;
                content.appendChild(p);
            }
        }

        if (fileBlocks && fileBlocks.length > 0) {
            for (const fb of fileBlocks) {
                const el = ChatRenderer.renderBlock(fb);
                if (el) content.appendChild(el);
            }
        }

        msg.appendChild(avatar);
        msg.appendChild(content);
        this._messagesContainer.appendChild(msg);
        ChatEventBus.emit('ui:scroll-bottom');
    },

    /**
     * Создаёт DOM-элемент сообщения и вставляет в контейнер
     *
     * @param {'user'|'bot'} role
     * @param {string} text
     */
    renderMessage(role, text) {
        const msg = document.createElement('div');
        msg.className = `chat-message chat-message-${role}`;

        const avatar = document.createElement('div');
        avatar.className = 'chat-message-avatar';

        if (role === 'bot') {
            avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        } else {
            avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        }

        const content = document.createElement('div');
        content.className = 'chat-message-content';

        const lines = text.split('\n');
        for (const line of lines) {
            const p = document.createElement('p');
            p.textContent = line;
            content.appendChild(p);
        }

        msg.appendChild(avatar);
        msg.appendChild(content);

        this._messagesContainer.appendChild(msg);
        ChatEventBus.emit('ui:scroll-bottom');
    },

    /**
     * Рендерит все сообщения загруженной беседы
     *
     * @param {Object} data
     * @param {string} data.conversationId
     * @param {Array} data.messages
     * @private
     */
    _renderConversationMessages({ conversationId, messages }) {
        this._messagesContainer.innerHTML = '';

        for (const msg of messages) {
            const blocks = Array.isArray(msg.content) ? msg.content : [];

            if (msg.role === 'user') {
                const textBlock = blocks.find(b => b.type === 'text');
                const text = textBlock
                    ? (textBlock.content || textBlock.text || '')
                    : '';

                const fileBlocks = blocks.filter(b => b.type === 'file');
                this._renderUserMessageWithFiles(text, fileBlocks);
            } else if (msg.role === 'assistant') {
                if (blocks.length > 0) {
                    const container = this._addBotMessageStreaming();
                    ChatRenderer.renderBlocks(container, blocks, { execute: false });
                } else {
                    this.renderMessage('bot', '');
                }
            }
        }

        ChatEventBus.emit('ui:scroll-bottom');
    },

    /**
     * Восстанавливает welcome-сообщение
     * @private
     */
    _restoreWelcome() {
        this._messagesContainer.innerHTML = this._welcomeHtml;
    },
};

window.ChatMessages = ChatMessages;
