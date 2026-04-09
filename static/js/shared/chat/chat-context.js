/**
 * Контекст чата
 *
 * Управление текущей беседой, knowledge bases и доменами.
 * Интегрируется с ChatHistory через callback.
 */
const ChatContext = {

    /** @type {boolean} */
    _initialized: false,
    /** @type {string|null} ID текущей активной беседы */
    _currentConversationId: null,

    /** @type {Object<string, string>|null} Маппинг key->label баз знаний */
    _knowledgeBaseMap: null,

    /** @type {Promise<string>|null} Pending promise для ensureConversation (защита от дублей) */
    _pendingEnsure: null,

    /**
     * Инициализация: подключение ChatHistory callback
     */
    init() {
        if (this._initialized) return;
        const historyContainer = document.getElementById('chatHistoryContainer');
        if (historyContainer && typeof ChatHistory !== 'undefined') {
            ChatHistory.init(historyContainer);
            ChatHistory.onConversationChange = (conversationId) => {
                this._onConversationSwitch(conversationId);
            };
            ChatHistory.loadConversations();
        }

        ChatEventBus.on('chat:clear', () => {
            this._currentConversationId = null;
            this._pendingEnsure = null;
        });

        this._initialized = true;
    },

    /**
     * Создаёт беседу, если ещё нет активной, и возвращает ID
     * @returns {Promise<string>}
     */
    async ensureConversation() {
        if (this._currentConversationId) {
            return this._currentConversationId;
        }

        // Promise lock: если уже создаём — возвращаем тот же промис
        if (this._pendingEnsure) {
            return this._pendingEnsure;
        }

        this._pendingEnsure = this._createConversation();
        try {
            return await this._pendingEnsure;
        } finally {
            this._pendingEnsure = null;
        }
    },

    /**
     * Внутренний метод создания беседы
     * @returns {Promise<string>}
     * @private
     */
    async _createConversation() {
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
    },

    /**
     * Возвращает ID текущей беседы
     * @returns {string|null}
     */
    getCurrentConversationId() {
        return this._currentConversationId;
    },

    /**
     * Читает включённые базы знаний из localStorage
     * @returns {string[]} массив label включённых баз
     */
    getEnabledKnowledgeBases() {
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
    },

    /**
     * Определяет список доменов для фильтрации tools из meta-тега
     * @returns {string[]|null} массив доменов или null (все tools)
     */
    detectDomains() {
        const meta = document.querySelector('meta[name="chat-domains"]');
        if (!meta) return null;

        try {
            const domains = JSON.parse(meta.content);
            return Array.isArray(domains) ? domains : null;
        } catch {
            return null;
        }
    },

    /**
     * Вызывается при переключении беседы в ChatHistory
     * @param {string|null} conversationId — ID новой беседы
     * @private
     */
    async _onConversationSwitch(conversationId) {
        this._currentConversationId = conversationId;

        if (!conversationId) {
            ChatEventBus.emit('context:conversation-cleared');
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

            ChatEventBus.emit('context:conversation-switched', {
                conversationId,
                messages,
            });
        } catch (err) {
            console.error('ChatContext: ошибка загрузки сообщений', err);
        }
    },

    /**
     * Загружает маппинг key->label баз знаний из DOM
     * @returns {Object<string, string>}
     * @private
     */
    _getKnowledgeBaseMap() {
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

        // Источник 2: data-атрибуты DOM-элементов
        const options = document.querySelectorAll('.settings-option[data-kb-key]');
        for (const opt of options) {
            const key = opt.dataset.kbKey;
            const label = opt.dataset.kbLabel;
            if (key && label) {
                this._knowledgeBaseMap[key] = label;
            }
        }

        return this._knowledgeBaseMap;
    },
};

window.ChatContext = ChatContext;
