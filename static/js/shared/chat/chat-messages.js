/**
 * Менеджер сообщений чата
 *
 * Отправка сообщений через poll-клиент, рендеринг user/bot сообщений в DOM.
 * При получении готового ответа применяет декоративный эффект печати.
 */

import { ChatContext } from './chat-context.js';
import { ChatEventBus } from './chat-event-bus.js';
import { ChatFeedback } from './chat-feedback.js';
import { ChatFiles } from './chat-files.js';
import { ChatRenderer } from './chat-renderer.js';
import { ChatStream } from './chat-stream.js';
import { Notifications } from '../notifications.js';

/**
 * Whitelist известных типов блоков сообщений.
 * Синхронизировать с `MessageBlock` union из `app/core/chat/blocks.py`
 * и с `_DiscriminatedBlock` из `app/core/chat/schemas.py`.
 */
export const KNOWN_BLOCK_TYPES = new Set([
    'text',
    'code',
    'reasoning',
    'file',
    'image',
    'plan',
    'error',
    'buttons',
    'client_action',
]);

export const ChatMessages = {

    /** @type {Set<string>} */
    KNOWN_BLOCK_TYPES,

    /** @type {boolean} */
    _initialized: false,
    /** @type {HTMLElement|null} */
    _messagesContainer: null,

    /** @type {HTMLElement|null} DOM-узел welcome-сообщения для восстановления при очистке */
    _welcomeNode: null,

    /**
     * AbortController текущего polling. Отменяется при переключении беседы
     * или явной очистке, чтобы typing-bubble не зависал при навигации.
     * @type {AbortController|null}
     */
    _pollController: null,

    /**
     * Инициализация: кеширование DOM, подписка на события
     *
     * @param {Object} data
     * @param {HTMLElement} data.messagesContainer
     */
    init({ messagesContainer }) {
        if (this._initialized) return;
        this._messagesContainer = messagesContainer;

        // Кэшируем welcome-сообщение как DOM-узел
        const welcomeEl = this._messagesContainer.querySelector('.chat-message-bot');
        if (welcomeEl) {
            this._welcomeNode = welcomeEl.cloneNode(true);
        }

        this._onSendRequest = (data) => this._send(data);
        this._onConversationSwitched = (data) => {
            this._abortPoll();
            if (!data.conversationId) {
                this._restoreWelcome();
                return;
            }
            this._renderConversationMessages(data);
        };
        this._onConversationCleared = () => {
            this._abortPoll();
            this._restoreWelcome();
        };
        this._onChatClear = () => {
            this._abortPoll();
            this._restoreWelcome();
        };

        ChatEventBus.on('chat:send-request', this._onSendRequest);
        ChatEventBus.on('context:conversation-switched', this._onConversationSwitched);
        ChatEventBus.on('context:conversation-cleared', this._onConversationCleared);
        ChatEventBus.on('chat:clear', this._onChatClear);

        this._initialized = true;
    },

    /**
     * Снимает все подписки на шину событий. Идемпотентно.
     */
    destroy() {
        if (!this._initialized) return;
        this._abortPoll();
        if (this._onSendRequest) {
            ChatEventBus.off('chat:send-request', this._onSendRequest);
            this._onSendRequest = null;
        }
        if (this._onConversationSwitched) {
            ChatEventBus.off('context:conversation-switched', this._onConversationSwitched);
            this._onConversationSwitched = null;
        }
        if (this._onConversationCleared) {
            ChatEventBus.off('context:conversation-cleared', this._onConversationCleared);
            this._onConversationCleared = null;
        }
        if (this._onChatClear) {
            ChatEventBus.off('chat:clear', this._onChatClear);
            this._onChatClear = null;
        }
        this._initialized = false;
    },

    /**
     * Отменяет текущий polling, если он активен.
     * @private
     */
    _abortPoll() {
        if (this._pollController) {
            this._pollController.abort();
            this._pollController = null;
        }
    },

    /**
     * Отправляет сообщение пользователя и запускает poll-цикл.
     *
     * @param {Object} data
     * @param {string} data.text — текст сообщения
     * @param {File[]} data.files — прикреплённые файлы
     * @private
     */
    async _send({ text, files }) {
        ChatEventBus.emit('ui:processing', { state: true });

        try {
            const conversationId = await ChatContext.ensureConversation(text, files);

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

            // Показываем typing-bubble сразу
            const botContainer = this._addBotMessageStreaming();

            // Режим агента: читает localStorage['assistant_oarb_mode'] через ChatContext
            const agentMode = (window.ChatContext
                && typeof ChatContext.getAgentMode === 'function'
                && ChatContext.getAgentMode()) || 'off';

            // Создаём AbortController для этого polling-цикла
            this._abortPoll();
            const controller = new AbortController();
            this._pollController = controller;

            await ChatStream.sendAndPoll(conversationId, text, files, {
                agentMode,
                domains: ChatContext.detectDomains(),
                onReady: (msg) => {
                    this._renderReadyMessage(botContainer, msg);
                    ChatEventBus.emit('ui:scroll-bottom');
                },
                onError: (err) => {
                    this._renderError(botContainer, err);
                    ChatEventBus.emit('ui:scroll-bottom');
                },
                signal: controller.signal,
            });
        } catch (err) {
            console.error('ChatMessages: ошибка отправки', err);
            this.renderMessage('bot', 'Произошла ошибка. Попробуйте ещё раз.');
        } finally {
            ChatEventBus.emit('ui:processing', { state: false });
        }
    },

    /**
     * Рендерит готовый ответ бота с декоративным эффектом печати.
     *
     * @param {HTMLElement} botContainer — контейнер .chat-message-content
     * @param {Object} msg — {id, status, content}
     * @private
     */
    _renderReadyMessage(botContainer, msg) {
        ChatRenderer.removeTypingPlaceholder(botContainer);
        const msgEl = botContainer.parentElement;
        if (msgEl) msgEl.classList.remove('chat-message-bot--streaming');

        if (msg.status === 'failed') {
            if (msgEl) msgEl.classList.add('chat-message--failed');
            // Блоки из failed-сообщения (обычно error-блок) — без анимации
            const blocks = Array.isArray(msg.content) ? msg.content : [];
            ChatRenderer.renderBlocks(botContainer, blocks, { execute: false });
        } else {
            const blocks = Array.isArray(msg.content) ? msg.content : [];
            ChatRenderer.typeOutBlocks(botContainer, blocks);
            // Панель обратной связи под завершённым ответом ассистента.
            // Свежий ответ оценок ещё не имеет (initial=null); conversationId
            // берём из активного контекста (poll-ответ его не содержит).
            if (msg.id) {
                ChatFeedback.attach(botContainer, {
                    conversationId: ChatContext.getCurrentConversationId(),
                    messageId: msg.id,
                    initial: msg.feedback || null,
                });
            }
        }
    },

    /**
     * Показывает ошибку получения ответа в typing-bubble.
     *
     * @param {HTMLElement} botContainer
     * @param {Error} err
     * @private
     */
    _renderError(botContainer, err) {
        if (err && err.name === 'AbortError') return; // отмена — молча

        ChatRenderer.removeTypingPlaceholder(botContainer);
        const msgEl = botContainer.parentElement;
        if (msgEl) msgEl.classList.remove('chat-message-bot--streaming');

        // Показываем реальный текст ошибки (бэк уже отдаёт дружелюбное сообщение,
        // напр. про лимит одновременных запросов), а не общую заглушку.
        const text = (err && err.message)
            ? err.message
            : 'Не удалось получить ответ. Попробуйте ещё раз.';

        // Штатное клиентское отклонение (4xx, напр. лимит запросов) уже показано
        // пользователю — это не сбой, логируем warn'ом, а не красным error'ом.
        const status = err && err.status;
        if (typeof status === 'number' && status >= 400 && status < 500) {
            console.warn('ChatMessages: запрос отклонён —', text);
        } else {
            console.error('ChatMessages: ошибка получения ответа', err);
        }
        const errDiv = document.createElement('div');
        errDiv.className = 'chat-error';
        errDiv.textContent = text;
        botContainer.appendChild(errDiv);

        // Тост — пусть пользователь увидит даже при переключении беседы
        if (typeof Notifications !== 'undefined' && typeof Notifications.error === 'function') {
            try { Notifications.error(text); } catch { /* некритично */ }
        }
    },

    /**
     * Создаёт DOM бот-сообщения для стриминга.
     *
     * @param {Object} [options]
     * @param {boolean} [options.withPlaceholder=true]
     * @returns {HTMLElement} — контейнер .chat-message-content
     * @private
     */
    _addBotMessageStreaming({ withPlaceholder = true } = {}) {
        const msg = document.createElement('div');
        msg.className = 'chat-message chat-message-bot';
        if (withPlaceholder) {
            msg.classList.add('chat-message-bot--streaming');
        }

        const avatar = document.createElement('div');
        avatar.className = 'chat-message-avatar';
        avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

        const content = document.createElement('div');
        content.className = 'chat-message-content';

        if (withPlaceholder) {
            content.appendChild(ChatRenderer.createTypingPlaceholder());
        }

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
     * Рендерит все сообщения загруженной беседы.
     * Для assistant-сообщений со status==='streaming' ставит typing-bubble
     * и возобновляет polling, чтобы закрыть сценарий reload/switch в процессе ожидания.
     *
     * @param {Object} data
     * @param {string} data.conversationId
     * @param {Array} data.messages
     * @private
     */
    _renderConversationMessages({ conversationId, messages }) {
        this._messagesContainer.replaceChildren();

        for (const msg of messages) {
            const blocks = Array.isArray(msg.content) ? msg.content : [];

            if (msg.role === 'user') {
                const textBlock = blocks.find(b => b.type === 'text');
                const text = textBlock ? (textBlock.content || '') : '';
                const fileBlocks = blocks.filter(b => b.type === 'file');
                this._renderUserMessageWithFiles(text, fileBlocks);
            } else if (msg.role === 'assistant') {
                const isStreaming = msg.status === 'streaming';
                const isFailed = msg.status === 'failed';

                if (blocks.length > 0 || isStreaming) {
                    const container = this._addBotMessageStreaming({
                        withPlaceholder: isStreaming,
                    });
                    if (!isStreaming) {
                        ChatRenderer.renderBlocks(container, blocks, { execute: false });
                    }
                    if (isFailed) {
                        const msgEl = container.parentElement;
                        if (msgEl) msgEl.classList.add('chat-message--failed');
                    }
                    // Панель обратной связи + восстановление ранее выставленной
                    // оценки текущего пользователя (msg.feedback из GET истории).
                    if (!isStreaming && !isFailed && msg.id) {
                        ChatFeedback.attach(container, {
                            conversationId: msg.conversation_id || conversationId,
                            messageId: msg.id,
                            initial: msg.feedback || null,
                        });
                    }
                    // Если сообщение ещё в статусе streaming — возобновляем polling
                    if (isStreaming && msg.id) {
                        this._abortPoll();
                        const controller = new AbortController();
                        this._pollController = controller;
                        ChatStream.pollMessage(conversationId, msg.id, {
                            onReady: (m) => {
                                this._renderReadyMessage(container, m);
                                ChatEventBus.emit('ui:scroll-bottom');
                            },
                            onError: (e) => {
                                this._renderError(container, e);
                                ChatEventBus.emit('ui:scroll-bottom');
                            },
                            signal: controller.signal,
                        });
                    }
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
        this._messagesContainer.replaceChildren();
        if (this._welcomeNode) {
            this._messagesContainer.appendChild(this._welcomeNode.cloneNode(true));
        }
    },
};

window.ChatMessages = ChatMessages;

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.KNOWN_BLOCK_TYPES = KNOWN_BLOCK_TYPES;
