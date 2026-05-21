/**
 * Менеджер сообщений чата
 *
 * Отправка сообщений через SSE, обработка событий стриминга,
 * рендеринг user/bot сообщений в DOM.
 */

/**
 * Whitelist известных типов блоков сообщений.
 * Если бэк добавит новый тип, а фронт ещё не обновлён, _handleSSEEvent
 * и ChatRenderer.renderBlock падают на default-ветку с fallback-блоком
 * («⚠ Блок неизвестного типа …»), а не ломают сообщение целиком.
 *
 * Синхронизировать с `MessageBlock` union из `app/core/chat/blocks.py`
 * И с `_DiscriminatedBlock` из `app/core/chat/schemas.py`.
 */
const KNOWN_BLOCK_TYPES = new Set([
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

const ChatMessages = {

    /** @type {Set<string>} */
    KNOWN_BLOCK_TYPES,


    /** @type {boolean} */
    _initialized: false,
    /** @type {HTMLElement|null} */
    _messagesContainer: null,

    /** @type {Object<number, {element: HTMLElement, appendText: function, finalize: function}>} */
    _streamingBlocks: {},

    /** @type {HTMLElement|null} DOM-узел welcome-сообщения для восстановления при очистке */
    _welcomeNode: null,

    /**
     * @type {Object<string, Promise<void>>}
     * Promise-lock per conversation_id для `_maybeResumeActiveForward`.
     * Без него rapid navigation (A → B → A) приводит к двум параллельным
     * `checkActiveForward(A)` → двум `_addBotMessageStreaming()` → двум
     * bot-bubble в DOM до того, как сработает idempotency-чек в
     * `ChatStream.resume` по `_resumeRequestId`.
     */
    _activeResumePromises: {},

    /**
     * @type {Set<string>}
     * block_id reasoning-блоков, уже отрендеренных в текущей беседе.
     * Backend forward'а присылает каждый reasoning-чанк с детерминированным
     * id `{message_id}:reasoning:{seq}`. Если при resume SSE прилетает
     * тот же id (повторное проигрывание истории) — фронт молча отбрасывает
     * block_start, и block_delta/block_end становятся no-op. Без этого
     * один логический шаг рассуждения дублировался 2-3 раза при reload.
     * Сбрасывается при смене беседы и `chat:clear`.
     */
    _seenReasoningBlockIds: new Set(),

    /**
     * @type {number} Максимальный seq уже отрендеренных reasoning-блоков
     * последнего assistant-message в активной беседе. Используется как
     * курсор для `?since_seq=N` при открытии Resume SSE. 0 — нет
     * отрендеренного reasoning'а (Resume получит всё с самого начала).
     */
    _lastReasoningSeq: 0,

    /**
     * Инициализация: кеширование DOM, подписка на события
     *
     * @param {Object} data
     * @param {HTMLElement} data.messagesContainer
     */
    init({ messagesContainer }) {
        if (this._initialized) return;
        this._messagesContainer = messagesContainer;

        // Кэшируем welcome-сообщение как DOM-узел (не строку!) — иначе innerHTML
        // даст путь для XSS, если в шаблоне когда-нибудь окажется untrusted-контент.
        const welcomeEl = this._messagesContainer.querySelector('.chat-message-bot');
        if (welcomeEl) {
            this._welcomeNode = welcomeEl.cloneNode(true);
        }

        // Сохраняем именованные ссылки на обработчики — нужно для destroy().
        this._onSendRequest = (data) => this._send(data);
        this._onConversationSwitched = (data) => {
            ChatStream.abort();
            if (!data.conversationId) {
                this._restoreWelcome();
                return;
            }
            this._renderConversationMessages(data);
            // После рендера истории проверяем, не идёт ли в этой беседе
            // forward к внешнему агенту (refresh-сценарий) — если да,
            // подключаемся к уже работающему SSE-стриму.
            // Fire-and-forget: ошибки checkActiveForward уже проглатываются
            // там, проверка не блокирует UI.
            this._maybeResumeActiveForward(data.conversationId);
        };
        this._onConversationCleared = () => {
            ChatStream.abort();
            this._seenReasoningBlockIds = new Set();
            this._lastReasoningSeq = 0;
            this._restoreWelcome();
        };
        this._onChatClear = () => {
            ChatStream.abort();
            this._streamingBlocks = {};
            this._seenReasoningBlockIds = new Set();
            this._lastReasoningSeq = 0;
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

            // Bot-bubble виден сразу: внутри живёт typing-плейсхолдер с тремя
            // анимированными точками. При первом блоке ответа плейсхолдер удаляется.
            const botContainer = this._addBotMessageStreaming();

            await ChatStream.send(conversationId, text, files, {
                domains: ChatContext.detectDomains(),
                onEvent: (event) => {
                    this._handleSSEEvent(event, botContainer);
                },
                onError: (err) => {
                    this._onStreamError(err, botContainer);
                },
                onDone: () => {
                    ChatEventBus.emit('ui:scroll-bottom');
                },
            });
        } catch (err) {
            console.error('ChatMessages: ошибка отправки', err);
            this.renderMessage('bot', 'Произошла ошибка. Попробуйте ещё раз.');
        } finally {
            ChatEventBus.emit('ui:processing', { state: false });
        }
    },

    /**
     * Обработчик ошибки стрима: различает дружелюбный 429 (ChatRateLimitedError)
     * и прочие сбои. В обоих случаях заменяет typing-плейсхолдер на error-блок,
     * чтобы пользователь увидел проблему прямо в bot-bubble.
     *
     * @param {Error} err — ошибка стрима
     * @param {HTMLElement} botContainer — контейнер bot-сообщения
     * @private
     */
    _onStreamError(err, botContainer) {
        const isRateLimited = typeof ChatRateLimitedError !== 'undefined'
            && err instanceof ChatRateLimitedError;

        if (isRateLimited) {
            console.warn('ChatMessages: лимит параллельных стримов', err.userMessage);
            ChatRenderer.removeTypingPlaceholder(botContainer);
            const errBlock = ChatRenderer.renderBlock({
                type: 'error',
                message: err.userMessage,
                code: 'rate_limited',
            });
            if (errBlock) ChatRenderer.appendBlock(botContainer, errBlock);

            // Дополнительно — тост, чтобы пользователь увидел уведомление
            // даже если переключился в другую беседу.
            if (typeof window !== 'undefined'
                && window.Notifications
                && typeof window.Notifications.warning === 'function') {
                try {
                    window.Notifications.warning(err.userMessage);
                } catch { /* notification subsystem не критична */ }
            }
            return;
        }

        console.error('ChatMessages: ошибка стриминга', err);
        ChatRenderer.removeTypingPlaceholder(botContainer);
        const errDiv = document.createElement('div');
        errDiv.className = 'chat-error';
        errDiv.textContent = 'Произошла ошибка. Попробуйте ещё раз.';
        botContainer.appendChild(errDiv);
    },

    /**
     * Обрабатывает SSE-событие и маршрутизирует к ChatRenderer
     *
     * @param {{type: string, data: *}} event — SSE-событие
     * @param {HTMLElement} container — контейнер бот-сообщения
     * @private
     */
    _handleSSEEvent(event, container) {
        // Любой блок видимого ответа должен скрыть «три точки».
        // Reasoning — это «бот всё ещё думает», не финальный ответ:
        // блоки reasoning рендерятся выше точек, а точки остаются внизу
        // bot-bubble. Только text/code/buttons/file/image/plan/client_action/error
        // — финальный контент, при их появлении плейсхолдер убирается.
        const isReasoningBlock = (
            (event.type === 'block_start' && event.data?.type === 'reasoning')
            || (event.type === 'block_complete' && event.data?.block?.type === 'reasoning')
        );
        const isContentEvent = !isReasoningBlock && (
            event.type === 'block_start'
            || event.type === 'block_complete'
            || event.type === 'buttons'
            || event.type === 'client_action'
            || event.type === 'error'
        );
        if (isContentEvent) {
            ChatRenderer.removeTypingPlaceholder(container);
        }

        switch (event.type) {
            case 'message_start':
                this._streamingBlocks = {};
                break;

            case 'block_start': {
                if (event.data.type === 'client_action') {
                    // client_action приходит как отдельное событие — игнорируем block_start
                    break;
                }
                const startType = event.data.type;
                // Дедуп reasoning по block_id: если тот же блок уже
                // отрисован (история / предыдущий Resume SSE), не
                // создаём streamingBlock — соответствующие block_delta
                // и block_end станут no-op в ветках ниже (там стоит
                // `if (block)` / `if (endBlock)`).
                const incomingBlockId = event.data.block_id;
                if (
                    startType === 'reasoning'
                    && typeof incomingBlockId === 'string'
                ) {
                    if (this._seenReasoningBlockIds.has(incomingBlockId)) {
                        break;
                    }
                    const existing = container.querySelector(
                        `[data-block-id="${CSS.escape(incomingBlockId)}"]`,
                    );
                    if (existing) {
                        this._seenReasoningBlockIds.add(incomingBlockId);
                        break;
                    }
                    this._seenReasoningBlockIds.add(incomingBlockId);
                    const seq = this._parseReasoningSeq(incomingBlockId);
                    if (seq > this._lastReasoningSeq) {
                        this._lastReasoningSeq = seq;
                    }
                }
                if (!KNOWN_BLOCK_TYPES.has(startType)) {
                    // Бэк прислал блок неизвестного типа — рендерим fallback
                    // вместо обычного streaming-контейнера, чтобы старый фронт
                    // не падал на новых типах блоков.
                    console.warn(
                        'ChatMessages: unknown block type',
                        startType,
                        event.data,
                    );
                    const sb = this._createUnknownStreamingBlock(startType);
                    this._streamingBlocks[event.data.index] = sb;
                    ChatRenderer.appendBlock(container, sb.element);
                    break;
                }
                const sb = ChatRenderer.createStreamingBlock(
                    startType,
                    startType === 'reasoning' ? incomingBlockId : undefined,
                );
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

            case 'block_complete': {
                // Нестримуемые блоки (file, image, plan, error, ...) приходят
                // одним событием с полной нагрузкой. Рендерим сразу — иначе
                // блок появился бы только после перезагрузки истории.
                const block = event.data.block;
                if (block) {
                    if (block.type && !KNOWN_BLOCK_TYPES.has(block.type)) {
                        console.warn(
                            'ChatMessages: unknown block type',
                            block.type,
                            block,
                        );
                        const el = this._renderUnknownBlock(block);
                        ChatRenderer.appendBlock(container, el);
                    } else {
                        const el = ChatRenderer.renderBlock(block);
                        if (el) ChatRenderer.appendBlock(container, el);
                    }
                }
                break;
            }

            case 'tool_call':
                break;

            case 'tool_result':
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
                // Рендерим как ErrorBlock, чтобы стримовое и сохранённое
                // отображение ошибки выглядело одинаково.
                const message =
                    event.data.error || event.data.message || 'Произошла ошибка';
                const errBlock = ChatRenderer.renderBlock({
                    type: 'error',
                    message,
                    code: event.data.code || null,
                });
                if (errBlock) ChatRenderer.appendBlock(container, errBlock);
                break;
            }

            case 'message_end':
                this._streamingBlocks = {};
                break;

            case 'agent_request_started':
                // Forward к внешнему агенту зарегистрирован. Typing-плейсхолдер
                // уже внутри bot-bubble, ничего дополнительно показывать не нужно.
                break;
        }

        ChatEventBus.emit('ui:scroll-bottom');
    },

    /**
     * Создаёт fallback-блок для стриминга неизвестного типа.
     *
     * Совместим по интерфейсу с ChatRenderer.createStreamingBlock:
     * возвращает { element, appendText, finalize }. Delta-чанки склеиваются
     * как plain-text (формат payload неизвестен — пытаемся вытащить
     * `text`/`content`, иначе JSON.stringify).
     *
     * @param {string} unknownType — пришедший с бэка тип
     * @returns {{element: HTMLElement, appendText: function(*): void, finalize: function(): void}}
     * @private
     */
    _createUnknownStreamingBlock(unknownType) {
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-block chat-block-unknown';

        const notice = document.createElement('div');
        notice.className = 'chat-block-unknown-notice';
        notice.textContent = `⚠ Блок неизвестного типа: ${unknownType}. Обновите страницу.`;
        wrapper.appendChild(notice);

        const pre = document.createElement('pre');
        pre.className = 'chat-block-unknown-payload';
        wrapper.appendChild(pre);

        let accumulated = '';
        return {
            element: wrapper,
            appendText(delta) {
                let chunk;
                if (delta == null) {
                    chunk = '';
                } else if (typeof delta === 'string') {
                    chunk = delta;
                } else if (typeof delta === 'object' && typeof delta.text === 'string') {
                    chunk = delta.text;
                } else {
                    try {
                        chunk = JSON.stringify(delta);
                    } catch {
                        chunk = String(delta);
                    }
                }
                accumulated += chunk;
                pre.textContent = accumulated;
            },
            finalize() {
                pre.textContent = accumulated;
            },
        };
    },

    /**
     * Рендерит fallback-блок для нестримуемого блока неизвестного типа.
     * Полный payload показывается в <pre> для отладки.
     *
     * @param {Object} block — блок с неизвестным `type`
     * @returns {HTMLElement}
     * @private
     */
    _renderUnknownBlock(block) {
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-block chat-block-unknown';

        const notice = document.createElement('div');
        notice.className = 'chat-block-unknown-notice';
        notice.textContent = `⚠ Блок неизвестного типа: ${block && block.type}. Обновите страницу.`;
        wrapper.appendChild(notice);

        const pre = document.createElement('pre');
        pre.className = 'chat-block-unknown-payload';
        try {
            pre.textContent = JSON.stringify(block, null, 2);
        } catch {
            pre.textContent = String(block);
        }
        wrapper.appendChild(pre);

        return wrapper;
    },

    /**
     * Проверяет, есть ли в беседе активный forward к внешнему агенту,
     * и если есть — открывает resume-SSE и привязывает события к новому
     * bot-bubble с typing-плейсхолдером. Используется при загрузке беседы,
     * чтобы после перезагрузки страницы пользователь увидел продолжение
     * ответа без потери reasoning-чанков.
     *
     * Идемпотентность обеспечивается на уровне `ChatStream.resume(...)` —
     * повторный вызов для того же request_id будет no-op.
     *
     * @param {string} conversationId
     * @private
     */
    async _maybeResumeActiveForward(conversationId) {
        // Уже идёт resume для этой беседы — переиспользуем promise.
        // Защищает от двух bot-bubble при rapid switch'ах между чатами.
        if (this._activeResumePromises[conversationId]) {
            return this._activeResumePromises[conversationId];
        }

        const promise = (async () => {
            const active = await ChatContext.checkActiveForward(conversationId);
            if (!active || !active.request_id) return;

            // Беседа могла смениться, пока шёл запрос — не открываем resume
            // для устаревшей беседы.
            if (ChatContext.getCurrentConversationId() !== conversationId) return;

            const botContainer = this._addBotMessageStreaming();

            // Курсор reasoning: если в истории уже есть отрендеренные
            // reasoning-блоки этого forward'а, не запрашиваем их снова.
            // 0 = резюм с самого начала.
            const sinceSeq = this._lastReasoningSeq || 0;

            await ChatStream.resume(conversationId, active.request_id, {
                sinceSeq,
                onEvent: (event) => {
                    this._handleSSEEvent(event, botContainer);
                },
                onError: (err) => {
                    this._onStreamError(err, botContainer);
                },
                onDone: () => {
                    ChatEventBus.emit('ui:scroll-bottom');
                },
            });
        })();

        this._activeResumePromises[conversationId] = promise;
        try {
            await promise;
        } finally {
            // Освобождаем lock на случай повторного forward'а в той же беседе.
            delete this._activeResumePromises[conversationId];
        }
    },

    /**
     * Парсит seq из block_id формата `{message_id}:reasoning:{seq}`.
     * Возвращает 0 при не-числовом или невалидном формате.
     *
     * @param {string} blockId
     * @returns {number}
     * @private
     */
    _parseReasoningSeq(blockId) {
        if (typeof blockId !== 'string') return 0;
        const parts = blockId.split(':');
        if (parts.length < 3) return 0;
        const seq = Number(parts[parts.length - 1]);
        return Number.isFinite(seq) && seq > 0 ? seq : 0;
    },

    /**
     * Создаёт DOM бот-сообщения для стриминга.
     *
     * Контейнер виден сразу и содержит typing-плейсхолдер с тремя анимированными
     * точками. Первое же содержимое (block_start / block_delta / block_complete и т.п.)
     * приведёт к удалению плейсхолдера в `_handleSSEEvent`.
     *
     * @param {Object} [options]
     * @param {boolean} [options.withPlaceholder=true] — добавить ли typing-плейсхолдер.
     *   Для рендера сохранённой истории передаём false — там сразу идут готовые блоки.
     * @returns {HTMLElement} — контейнер .chat-message-content
     * @private
     */
    _addBotMessageStreaming({ withPlaceholder = true } = {}) {
        const msg = document.createElement('div');
        msg.className = 'chat-message chat-message-bot';

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
     * Рендерит все сообщения загруженной беседы
     *
     * @param {Object} data
     * @param {string} data.conversationId
     * @param {Array} data.messages
     * @private
     */
    _renderConversationMessages({ conversationId, messages }) {
        this._messagesContainer.replaceChildren();
        // Дедуп reasoning синхронизируется с DOM: после wipe'а контейнера Set
        // не сбрасываем — он самонаполнится ниже из reasoning-блоков истории,
        // а уцелевшие записи безопасны (DOM-fallback в block_start сверится).

        for (const msg of messages) {
            const blocks = Array.isArray(msg.content) ? msg.content : [];

            if (msg.role === 'user') {
                const textBlock = blocks.find(b => b.type === 'text');
                const text = textBlock ? (textBlock.content || '') : '';

                const fileBlocks = blocks.filter(b => b.type === 'file');
                this._renderUserMessageWithFiles(text, fileBlocks);
            } else if (msg.role === 'assistant') {
                if (blocks.length > 0) {
                    const container = this._addBotMessageStreaming({ withPlaceholder: false });
                    ChatRenderer.renderBlocks(container, blocks, { execute: false });
                    // Собираем block_id уже отрендеренных reasoning-блоков,
                    // чтобы Resume SSE через ?since_seq= не присылал их повторно
                    // и block_start с тем же id молча отбрасывался.
                    for (const block of blocks) {
                        if (block && block.type === 'reasoning'
                            && typeof block.block_id === 'string') {
                            this._seenReasoningBlockIds.add(block.block_id);
                            const seq = this._parseReasoningSeq(block.block_id);
                            if (seq > this._lastReasoningSeq) {
                                this._lastReasoningSeq = seq;
                            }
                        }
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
            // Клонируем повторно — оригинал нужен для следующих восстановлений.
            this._messagesContainer.appendChild(this._welcomeNode.cloneNode(true));
        }
    },
};

window.ChatMessages = ChatMessages;
