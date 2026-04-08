/**
 * Менеджер чата с AI-ассистентом
 *
 * Управляет отправкой/приёмом сообщений через SSE (ChatStream),
 * рендерингом блоков (ChatRenderer), историей бесед (ChatHistory),
 * typing-индикатором и блокировкой UI во время обработки.
 */
class ChatManager {
    /** @type {HTMLElement|null} */
    static _messagesContainer = null;
    /** @type {HTMLInputElement|null} */
    static _input = null;
    /** @type {HTMLButtonElement|null} */
    static _sendBtn = null;
    /** @type {HTMLElement|null} */
    static _placeholder = null;
    /** @type {HTMLButtonElement|null} */
    static _clearBtn = null;

    /** @type {boolean} */
    static _isProcessing = false;

    /** @type {string|null} ID текущей активной беседы */
    static _currentConversationId = null;

    /** @type {File[]} Файлы, ожидающие отправки */
    static _pendingFiles = [];

    /** @type {Object<number, {element: HTMLElement, appendText: function, finalize: function}>} */
    static _streamingBlocks = {};

    /** @type {Object<string, string>|null} Маппинг key->label баз знаний (загружается из DOM) */
    static _knowledgeBaseMap = null;

    /** @type {string} HTML welcome-сообщения для восстановления при очистке */
    static _welcomeHtml = '';

    /**
     * Инициализация: кеширование DOM, обработчики, загрузка истории бесед
     */
    static init() {
        this._messagesContainer = document.querySelector('.chat-messages');
        this._input = document.querySelector('.chat-input');
        this._sendBtn = document.querySelector('.chat-send-btn');
        this._placeholder = document.querySelector('.chat-placeholder');

        if (!this._messagesContainer || !this._input || !this._sendBtn) {
            console.warn('ChatManager: не найдены необходимые DOM-элементы');
            return;
        }

        // Активируем input и кнопку
        this._input.disabled = false;
        this._input.placeholder = 'Введите сообщение...';
        this._sendBtn.disabled = false;

        // Скрываем placeholder
        if (this._placeholder) {
            this._placeholder.classList.add('chat-placeholder-hidden');
        }

        // Кэшируем welcome-сообщение для восстановления при очистке
        const welcomeEl = this._messagesContainer.querySelector('.chat-message-bot');
        if (welcomeEl) {
            this._welcomeHtml = welcomeEl.outerHTML;
        }

        // Кнопка очистки чата
        this._clearBtn = document.querySelector('.chat-clear-btn');
        if (this._clearBtn) {
            this._clearBtn.addEventListener('click', () => {
                this.clearChat();
            });
        }

        // Обработчики ввода
        this._input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Авторесайз textarea при вводе / shift+enter
        this._input.addEventListener('input', () => {
            this._autoResizeInput();
        });

        this._sendBtn.addEventListener('click', () => {
            this.sendMessage();
        });

        // Инициализация файлового ввода и drag-and-drop
        this._initFileInput();
        this._initDragAndDrop();

        // Инициализация панели истории бесед (если контейнер присутствует в DOM)
        const historyContainer = document.getElementById('chatHistoryContainer');
        if (historyContainer && typeof ChatHistory !== 'undefined') {
            ChatHistory.init(historyContainer);
            ChatHistory.onConversationChange = (conversationId) => {
                this._onConversationSwitch(conversationId);
            };
            ChatHistory.loadConversations();
        }

        console.log('ChatManager: инициализация завершена');
    }

    /**
     * Отправляет сообщение пользователя
     */
    static async sendMessage() {
        if (this._isProcessing) return;

        const text = this._input.value.trim();
        if (!text) return;

        // Собираем файлы до очистки UI
        const files = [...this._pendingFiles];

        this._input.value = '';
        this._autoResizeInput();
        this._setProcessing(true);

        try {
            // Создаём беседу ДО рендеринга сообщения, чтобы
            // callback _onConversationSwitch не затёр DOM
            const conversationId = await this._ensureConversation();

            // Рендерим user-сообщение после создания беседы
            if (files.length > 0) {
                const fileBlocks = files.map(f => ({
                    type: 'file', name: f.name, size: f.size,
                }));
                this._renderUserMessageWithFiles(text, fileBlocks);
            } else {
                this._addUserMessage(text);
            }
            this._clearPendingFiles();

            this._showTypingIndicator();
            const botContainer = this._addBotMessageStreaming();

            await ChatStream.send(conversationId, text, files, {
                domains: this._detectDomains(),
                onEvent: (event) => {
                    this._handleSSEEvent(event, botContainer);
                },
                onError: (err) => {
                    console.error('ChatManager: ошибка стриминга', err);
                    const errDiv = document.createElement('div');
                    errDiv.className = 'chat-error';
                    errDiv.textContent = 'Произошла ошибка. Попробуйте ещё раз.';
                    botContainer.appendChild(errDiv);
                },
                onDone: () => {
                    this._removeTypingIndicator();
                    this._scrollToBottom();
                },
            });
        } catch (err) {
            this._removeTypingIndicator();
            console.error('ChatManager: ошибка отправки', err);
            this._renderMessage('bot', 'Произошла ошибка. Попробуйте ещё раз.');
        } finally {
            this._setProcessing(false);
        }
    }

    /**
     * Отправляет быстрый ответ (quick reply) из кнопки ChatRenderer
     * @param {string} value — текст быстрого ответа
     */
    static sendQuickReply(value) {
        if (this._isProcessing || !value) return;
        this._input.value = value;
        this.sendMessage();
    }

    /**
     * Выполняет действие (action) из кнопки ChatRenderer
     * @param {string} actionId — идентификатор действия
     * @param {Object} params — параметры действия
     */
    static async executeAction(actionId, params = {}) {
        if (this._isProcessing) return;

        this._setProcessing(true);
        this._showTypingIndicator();

        try {
            const conversationId = await this._ensureConversation();
            const endpoint = `/api/v1/chat/conversations/${conversationId}/actions/${actionId}`;
            const url = typeof AppConfig !== 'undefined'
                ? AppConfig.api.getUrl(endpoint)
                : endpoint;

            const headers = {
                'Content-Type': 'application/json',
            };
            if (typeof AuthManager !== 'undefined' && AuthManager.getCurrentUser()) {
                Object.assign(headers, AuthManager.getAuthHeaders());
            }

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(params),
            });

            this._removeTypingIndicator();

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data.message) {
                this._renderMessage('bot', data.message);
            }
        } catch (err) {
            this._removeTypingIndicator();
            console.error('ChatManager: ошибка выполнения действия', err);
            this._renderMessage('bot', 'Не удалось выполнить действие. Попробуйте ещё раз.');
        } finally {
            this._setProcessing(false);
        }
    }

    /**
     * Создаёт беседу, если ещё нет активной, и возвращает ID
     * @returns {Promise<string>}
     * @private
     */
    static async _ensureConversation() {
        if (this._currentConversationId) {
            return this._currentConversationId;
        }

        // Создаём беседу через ChatHistory, если доступен.
        // Подавляем callback, чтобы _onConversationSwitch
        // не очистил DOM с сообщениями.
        if (typeof ChatHistory !== 'undefined') {
            const origCallback = ChatHistory.onConversationChange;
            ChatHistory.onConversationChange = null;
            await ChatHistory.createConversation();
            ChatHistory.onConversationChange = origCallback;
            this._currentConversationId = ChatHistory.getCurrentId();
        } else {
            // Fallback: создаём напрямую
            const endpoint = '/api/v1/chat/conversations';
            const url = typeof AppConfig !== 'undefined'
                ? AppConfig.api.getUrl(endpoint)
                : endpoint;

            const headers = { 'Content-Type': 'application/json' };
            if (typeof AuthManager !== 'undefined' && AuthManager.getCurrentUser()) {
                Object.assign(headers, AuthManager.getAuthHeaders());
            }

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({}),
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const conversation = await response.json();
            this._currentConversationId = conversation.id;
        }

        return this._currentConversationId;
    }

    /**
     * Обрабатывает SSE-событие и маршрутизирует к ChatRenderer
     * @param {{type: string, data: *}} event — SSE-событие
     * @param {HTMLElement} container — контейнер бот-сообщения
     * @private
     */
    static _handleSSEEvent(event, container) {
        switch (event.type) {
            case 'message_start':
                this._streamingBlocks = {};
                break;

            case 'block_start': {
                const sb = ChatRenderer.createStreamingBlock(event.data.type);
                this._streamingBlocks[event.data.index] = sb;
                container.appendChild(sb.element);
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
                // Опционально: показать индикатор вызова инструмента
                break;

            case 'tool_result':
                // Опционально: показать результат инструмента
                break;

            case 'plan_update':
                ChatRenderer.updatePlan(container, event.data.steps);
                break;

            case 'buttons': {
                const btnBlock = ChatRenderer.renderBlock({ type: 'buttons', ...event.data });
                if (btnBlock) container.appendChild(btnBlock);
                break;
            }

            case 'error': {
                const errDiv = document.createElement('div');
                errDiv.className = 'chat-error';
                errDiv.textContent = event.data.message;
                container.appendChild(errDiv);
                break;
            }

            case 'message_end':
                this._streamingBlocks = {};
                break;
        }

        this._scrollToBottom();
    }

    /**
     * Создаёт пустой DOM бот-сообщения для стриминга и возвращает контейнер контента
     * @returns {HTMLElement} — контейнер .chat-message-content для добавления блоков
     * @private
     */
    static _addBotMessageStreaming() {
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

        msg.appendChild(avatar);
        msg.appendChild(content);

        this._messagesContainer.appendChild(msg);
        this._scrollToBottom();

        return content;
    }

    /**
     * Вызывается при переключении беседы в ChatHistory
     * @param {string|null} conversationId — ID новой беседы
     * @private
     */
    static async _onConversationSwitch(conversationId) {
        this._currentConversationId = conversationId;
        this._clearPendingFiles();
        this._messagesContainer.innerHTML = '';

        if (!conversationId) {
            // Нет бесед — показываем welcome
            this._messagesContainer.innerHTML = this._welcomeHtml;
            return;
        }

        // Загружаем сообщения выбранной беседы
        try {
            const endpoint = `/api/v1/chat/conversations/${conversationId}/messages`;
            const url = typeof AppConfig !== 'undefined'
                ? AppConfig.api.getUrl(endpoint)
                : endpoint;

            const headers = {};
            if (typeof AuthManager !== 'undefined' && AuthManager.getCurrentUser()) {
                Object.assign(headers, AuthManager.getAuthHeaders());
            }

            const response = await fetch(url, { headers });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const messages = await response.json();

            for (const msg of messages) {
                const blocks = Array.isArray(msg.content) ? msg.content : [];

                if (msg.role === 'user') {
                    // Извлекаем текст из блоков
                    const textBlock = blocks.find(b => b.type === 'text');
                    const text = textBlock
                        ? (textBlock.content || textBlock.text || '')
                        : '';

                    // Рендерим user-сообщение с файлами, если есть
                    const fileBlocks = blocks.filter(b => b.type === 'file');
                    this._renderUserMessageWithFiles(text, fileBlocks);
                } else if (msg.role === 'assistant') {
                    if (blocks.length > 0) {
                        const container = this._addBotMessageStreaming();
                        ChatRenderer.renderBlocks(container, blocks);
                    } else {
                        this._renderMessage('bot', '');
                    }
                }
            }

            this._scrollToBottom();
        } catch (err) {
            console.error('ChatManager: ошибка загрузки сообщений', err);
        }
    }

    /**
     * Загружает маппинг key->label баз знаний из DOM (meta-тег или data-атрибуты)
     * @returns {Object<string, string>}
     * @private
     */
    static _getKnowledgeBaseMap() {
        if (this._knowledgeBaseMap !== null) return this._knowledgeBaseMap;

        this._knowledgeBaseMap = {};

        // Источник 1: meta-тег chat-knowledge-bases (JSON массив)
        const meta = document.querySelector('meta[name="chat-knowledge-bases"]');
        if (meta) {
            try {
                const bases = JSON.parse(meta.content);
                if (Array.isArray(bases)) {
                    for (const kb of bases) {
                        if (kb.key && kb.label) {
                            this._knowledgeBaseMap[kb.key] = kb.label;
                        }
                    }
                    return this._knowledgeBaseMap;
                }
            } catch { /* fallback ниже */ }
        }

        // Источник 2: data-атрибуты DOM-элементов (settings toggles)
        const options = document.querySelectorAll('.settings-option[data-kb-key]');
        for (const opt of options) {
            const key = opt.dataset.kbKey;
            const label = opt.dataset.kbLabel;
            if (key && label) {
                this._knowledgeBaseMap[key] = label;
            }
        }

        return this._knowledgeBaseMap;
    }

    /**
     * Читает включённые базы знаний из localStorage (общий ключ для всех страниц)
     * @returns {string[]} массив label включённых баз
     * @private
     */
    static _getEnabledKnowledgeBases() {
        try {
            const data = localStorage.getItem('assistant_knowledge_bases');
            if (!data) return [];

            const state = JSON.parse(data);
            const kbMap = this._getKnowledgeBaseMap();
            const enabled = [];
            for (const [key, label] of Object.entries(kbMap)) {
                if (state[key]) enabled.push(label);
            }
            return enabled;
        } catch {
            return [];
        }
    }

    /**
     * Определяет список доменов для фильтрации tools из meta-тега.
     * Бэкенд передаёт chat_domains через <meta name="chat-domains">.
     * @returns {string[]|null} массив доменов или null (все tools)
     * @private
     */
    static _detectDomains() {
        const meta = document.querySelector('meta[name="chat-domains"]');
        if (!meta) return null;

        try {
            const domains = JSON.parse(meta.content);
            return Array.isArray(domains) ? domains : null;
        } catch {
            return null;
        }
    }

    /**
     * Добавляет сообщение пользователя в DOM
     * @param {string} text
     * @private
     */
    static _addUserMessage(text) {
        this._renderMessage('user', text);
    }

    /**
     * Рендерит пользовательское сообщение с файлами (для загрузки истории)
     * @param {string} text — текст сообщения
     * @param {Array<Object>} fileBlocks — файловые блоки
     * @private
     */
    static _renderUserMessageWithFiles(text, fileBlocks) {
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

        // Файлы — рендерим как компактные чипы внутри сообщения
        if (fileBlocks && fileBlocks.length > 0) {
            for (const fb of fileBlocks) {
                const el = ChatRenderer.renderBlock(fb);
                if (el) content.appendChild(el);
            }
        }

        msg.appendChild(avatar);
        msg.appendChild(content);
        this._messagesContainer.appendChild(msg);
        this._scrollToBottom();
    }

    /**
     * Создаёт DOM-элемент сообщения и вставляет в контейнер
     * @param {'user'|'bot'} role
     * @param {string} text
     * @private
     */
    static _renderMessage(role, text) {
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
        this._scrollToBottom();
    }

    /**
     * Показывает typing-индикатор (три анимированные точки)
     * @private
     */
    static _showTypingIndicator() {
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
    }

    /**
     * Убирает typing-индикатор
     * @private
     */
    static _removeTypingIndicator() {
        const indicator = this._messagesContainer.querySelector('.chat-typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * Устанавливает состояние обработки (блокировка UI)
     * @param {boolean} state
     * @private
     */
    static _setProcessing(state) {
        this._isProcessing = state;

        const container = this._input.closest('.chat-input-container');
        if (container) {
            container.classList.toggle('processing', state);
        }

        this._sendBtn.disabled = state;
        this._input.disabled = state;

        if (!state) {
            this._input.focus();
        }
    }

    /**
     * Прокручивает контейнер сообщений вниз
     * @private
     */
    static _scrollToBottom() {
        this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
    }

    /**
     * Авторесайз textarea: подстраивает высоту под содержимое (макс. 5 строк)
     * @private
     */
    static _autoResizeInput() {
        if (!this._input) return;
        this._input.style.height = 'auto';
        const maxHeight = parseInt(getComputedStyle(this._input).lineHeight, 10) * 5 || 120;
        this._input.style.height = Math.min(this._input.scrollHeight, maxHeight) + 'px';
    }

    /**
     * Инициализирует файловый ввод и превью прикреплённых файлов
     * @private
     */
    static _initFileInput() {
        const fileInput = document.getElementById('chatFileInput');
        if (!fileInput) return;

        fileInput.addEventListener('change', () => {
            const validated = this._validateFiles([...fileInput.files]);
            for (const file of validated) {
                this._pendingFiles.push(file);
            }
            fileInput.value = '';
            this._renderFilePreview();
        });
    }

    /**
     * Инициализирует drag-and-drop файлов в область чата
     * @private
     */
    static _initDragAndDrop() {
        const dropZone = this._messagesContainer?.closest('.chat-body');
        if (!dropZone) return;

        const overlay = dropZone.querySelector('.chat-drop-overlay');
        if (!overlay) return;

        let dragCounter = 0;

        dropZone.addEventListener('dragenter', (e) => {
            e.preventDefault();
            if (!this._hasDragFiles(e)) return;
            dragCounter++;
            if (dragCounter === 1) overlay.classList.remove('hidden');
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this._hasDragFiles(e)) e.dataTransfer.dropEffect = 'copy';
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                overlay.classList.add('hidden');
            }
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            overlay.classList.add('hidden');

            if (this._isProcessing) return;

            const files = e.dataTransfer?.files;
            if (!files || files.length === 0) return;

            const validated = this._validateFiles([...files]);
            for (const file of validated) {
                this._pendingFiles.push(file);
            }
            this._renderFilePreview();
        });
    }

    /**
     * Проверяет, содержит ли drag-событие файлы
     * @param {DragEvent} e
     * @returns {boolean}
     * @private
     */
    static _hasDragFiles(e) {
        if (e.dataTransfer?.types) {
            return e.dataTransfer.types.includes('Files');
        }
        return false;
    }

    /** Лимиты файлов (соответствуют серверным настройкам по умолчанию) */
    static _FILE_LIMITS = {
        maxFileSize: 10 * 1024 * 1024,       // 10 МБ на файл
        maxFilesPerMessage: 5,                // файлов в сообщении
        maxTotalFileSize: 30 * 1024 * 1024,   // 30 МБ суммарно
    };

    /**
     * Валидирует новые файлы перед добавлением в очередь.
     * Возвращает массив файлов, прошедших проверку.
     *
     * @param {File[]} newFiles — новые файлы для добавления
     * @returns {File[]} валидные файлы
     * @private
     */
    static _validateFiles(newFiles) {
        const limits = this._FILE_LIMITS;
        const currentSize = this._pendingFiles.reduce((sum, f) => sum + f.size, 0);
        const currentCount = this._pendingFiles.length;

        const accepted = [];
        const errors = [];

        for (const file of newFiles) {
            if (file.size > limits.maxFileSize) {
                const maxMb = (limits.maxFileSize / (1024 * 1024)).toFixed(0);
                errors.push(`«${file.name}» превышает ${maxMb} МБ`);
                continue;
            }

            if (currentCount + accepted.length >= limits.maxFilesPerMessage) {
                errors.push(`Максимум ${limits.maxFilesPerMessage} файлов в сообщении`);
                break;
            }

            const totalAfter = currentSize + accepted.reduce((s, f) => s + f.size, 0) + file.size;
            if (totalAfter > limits.maxTotalFileSize) {
                const maxMb = (limits.maxTotalFileSize / (1024 * 1024)).toFixed(0);
                errors.push(`Суммарный размер файлов превышает ${maxMb} МБ`);
                break;
            }

            accepted.push(file);
        }

        if (errors.length > 0 && typeof Notifications !== 'undefined') {
            Notifications.warning(errors.join('. '));
        }

        return accepted;
    }

    /**
     * Рендерит превью прикреплённых файлов
     * @private
     */
    static _renderFilePreview() {
        const preview = document.getElementById('chatFilePreview');
        if (!preview) return;

        if (this._pendingFiles.length === 0) {
            preview.hidden = true;
            preview.innerHTML = '';
            return;
        }

        preview.hidden = false;
        preview.innerHTML = '';

        this._pendingFiles.forEach((file, index) => {
            const chip = document.createElement('div');
            chip.className = 'chat-file-chip';

            const name = document.createElement('span');
            name.textContent = file.name;

            const remove = document.createElement('span');
            remove.className = 'chat-file-chip-remove';
            remove.textContent = '\u00D7'; // x
            remove.addEventListener('click', () => {
                this._pendingFiles.splice(index, 1);
                this._renderFilePreview();
            });

            chip.appendChild(name);
            chip.appendChild(remove);
            preview.appendChild(chip);
        });
    }

    /**
     * Очищает список ожидающих файлов и превью
     * @private
     */
    static _clearPendingFiles() {
        this._pendingFiles = [];
        this._renderFilePreview();
    }

    /**
     * Полная очистка чата: DOM, сброс беседы, восстановление welcome-сообщения
     */
    static clearChat() {
        if (this._isProcessing) return;

        this._currentConversationId = null;
        this._streamingBlocks = {};
        this._clearPendingFiles();
        this._messagesContainer.innerHTML = this._welcomeHtml;
    }
}

// Экспортируем в глобальную область видимости
window.ChatManager = ChatManager;
