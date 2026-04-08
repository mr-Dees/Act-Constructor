/**
 * Панель истории бесед чата
 *
 * Отображает список бесед пользователя, позволяет создавать,
 * удалять и переключаться между беседами. Взаимодействует
 * с ChatManager через callback onConversationChange.
 */
const ChatHistory = {

    /** @type {Array<Object>} Список бесед */
    _conversations: [],

    /** @type {string|null} ID текущей активной беседы */
    _currentId: null,

    /** @type {HTMLElement|null} DOM-контейнер панели */
    _container: null,

    /** @type {function(string): void|null} Callback при смене беседы */
    onConversationChange: null,

    /** @type {boolean} Панель свёрнута */
    _collapsed: false,

    /**
     * Инициализация: сохраняет контейнер и рендерит пустой список
     *
     * @param {HTMLElement} container — контейнер для панели истории
     */
    init(container) {
        this._container = container;
        if (!this._container) {
            console.warn('ChatHistory: контейнер не найден');
            return;
        }
        this._restoreCollapsed();
        this._render();
    },

    /**
     * Загружает список бесед с сервера
     *
     * @param {string|null} domainName — фильтр по домену (опционально)
     */
    async loadConversations(domainName = null) {
        try {
            let endpoint = '/api/v1/chat/conversations';
            if (domainName) {
                endpoint += `?domain_name=${encodeURIComponent(domainName)}`;
            }

            const url = (typeof AppConfig !== 'undefined')
                ? AppConfig.api.getUrl(endpoint)
                : endpoint;

            const headers = {};
            if (typeof AuthManager !== 'undefined' && AuthManager.getCurrentUser()) {
                Object.assign(headers, AuthManager.getAuthHeaders());
            }

            const response = await fetch(url, { headers });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            this._conversations = await response.json();

            // Автоматически выбираем самую свежую беседу
            if (this._conversations.length > 0 && !this._currentId) {
                this._currentId = this._conversations[0].id;
            }

            this._render();

            // Уведомляем ChatManager о выбранной беседе
            if (this._currentId && this.onConversationChange) {
                this.onConversationChange(this._currentId);
            }
        } catch (err) {
            console.error('ChatHistory: ошибка загрузки бесед', err);
        }
    },

    /**
     * Создаёт новую беседу
     *
     * @param {string|null} domainName — домен для новой беседы
     */
    async createConversation(domainName = null) {
        try {
            const endpoint = '/api/v1/chat/conversations';
            const url = (typeof AppConfig !== 'undefined')
                ? AppConfig.api.getUrl(endpoint)
                : endpoint;

            const headers = {
                'Content-Type': 'application/json',
            };
            if (typeof AuthManager !== 'undefined' && AuthManager.getCurrentUser()) {
                Object.assign(headers, AuthManager.getAuthHeaders());
            }

            const body = {};
            if (domainName) body.domain_name = domainName;

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const conversation = await response.json();
            this._conversations.unshift(conversation);
            this._currentId = conversation.id;
            this._render();

            if (this.onConversationChange) {
                this.onConversationChange(conversation.id);
            }
        } catch (err) {
            console.error('ChatHistory: ошибка создания беседы', err);
        }
    },

    /**
     * Удаляет беседу
     *
     * @param {string} id — ID беседы
     */
    async deleteConversation(id) {
        try {
            const endpoint = `/api/v1/chat/conversations/${id}`;
            const url = (typeof AppConfig !== 'undefined')
                ? AppConfig.api.getUrl(endpoint)
                : endpoint;

            const headers = {};
            if (typeof AuthManager !== 'undefined' && AuthManager.getCurrentUser()) {
                Object.assign(headers, AuthManager.getAuthHeaders());
            }

            const response = await fetch(url, {
                method: 'DELETE',
                headers,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            this._conversations = this._conversations.filter(c => c.id !== id);

            // Если удалили активную беседу — сбрасываем
            if (this._currentId === id) {
                this._currentId = this._conversations.length > 0
                    ? this._conversations[0].id
                    : null;

                if (this.onConversationChange) {
                    this.onConversationChange(this._currentId);
                }
            }

            this._render();
        } catch (err) {
            console.error('ChatHistory: ошибка удаления беседы', err);
        }
    },

    /**
     * Выбирает беседу как активную
     *
     * @param {string} id — ID беседы
     */
    selectConversation(id) {
        this._currentId = id;
        this._render();

        if (this.onConversationChange) {
            this.onConversationChange(id);
        }
    },

    /**
     * Возвращает ID текущей активной беседы
     *
     * @returns {string|null}
     */
    getCurrentId() {
        return this._currentId;
    },

    // ========================================================
    //  Рендеринг
    // ========================================================

    /**
     * Переключает видимость панели истории
     */
    toggleCollapsed() {
        this._collapsed = !this._collapsed;
        this._saveCollapsed();
        this._render();
    },

    /**
     * Перерисовывает панель истории
     * @private
     */
    _render() {
        if (!this._container) return;

        const collapsedClass = this._collapsed ? ' chat-history--collapsed' : '';
        let html = `<div class="chat-history${collapsedClass}">`;

        // Кнопка toggle
        const toggleIcon = this._collapsed
            ? '<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
            : '<path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        const toggleTitle = this._collapsed ? 'Показать беседы' : 'Скрыть беседы';
        html += `<button class="chat-history-toggle" data-action="toggle" title="${toggleTitle}">`;
        html += `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">${toggleIcon}</svg>`;
        html += '</button>';

        if (!this._collapsed) {
            // Кнопка «Новый чат»
            html += '<button class="chat-history-new" data-action="new">+ Новый чат</button>';

            // Список бесед
            html += '<div class="chat-history-list">';

            for (const conv of this._conversations) {
                const isActive = conv.id === this._currentId;
                const activeClass = isActive ? ' chat-history-item--active' : '';
                const title = this._escapeHtml(this._truncateTitle(conv.title || 'Без названия'));
                const date = this._formatDate(conv.updated_at || conv.created_at);

                html += `<div class="chat-history-item${activeClass}" data-id="${this._escapeHtml(conv.id)}">`;
                html += `  <div class="chat-history-item-title" title="${title}">${title}</div>`;
                html += `  <div class="chat-history-item-date">${date}</div>`;
                html += `  <button class="chat-history-item-delete" data-action="delete" data-id="${this._escapeHtml(conv.id)}" title="Удалить">&times;</button>`;
                html += '</div>';
            }

            html += '</div>';
        }

        html += '</div>';

        this._container.innerHTML = html;

        // Навешиваем обработчики
        this._bindEvents();
    },

    /**
     * Привязывает обработчики событий после рендеринга
     * @private
     */
    _bindEvents() {
        if (!this._container) return;

        // Кнопка toggle
        const toggleBtn = this._container.querySelector('[data-action="toggle"]');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.toggleCollapsed();
            });
        }

        // Кнопка «Новый чат»
        const newBtn = this._container.querySelector('[data-action="new"]');
        if (newBtn) {
            newBtn.addEventListener('click', () => {
                this.createConversation();
            });
        }

        // Клик по беседе
        const items = this._container.querySelectorAll('.chat-history-item');
        for (const item of items) {
            item.addEventListener('click', (e) => {
                // Не переключаем при клике на кнопку удаления
                if (e.target.closest('[data-action="delete"]')) return;
                const id = item.dataset.id;
                if (id) this.selectConversation(id);
            });
        }

        // Кнопки удаления
        const deleteBtns = this._container.querySelectorAll('[data-action="delete"]');
        for (const btn of deleteBtns) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (id) this.deleteConversation(id);
            });
        }
    },

    // ========================================================
    //  Хелперы
    // ========================================================

    /**
     * Экранирует HTML-спецсимволы
     *
     * @param {string} text
     * @returns {string}
     * @private
     */
    _escapeHtml(text) {
        if (!text) return '';
        const el = document.createElement('div');
        el.textContent = text;
        return el.innerHTML;
    },

    /**
     * Форматирует дату: сегодня — HH:MM, иначе — "6 апр."
     *
     * @param {string} dateStr — строка даты (ISO 8601)
     * @returns {string}
     * @private
     */
    _formatDate(dateStr) {
        if (!dateStr) return '';

        try {
            const date = new Date(dateStr);
            const now = new Date();

            const isToday = date.getFullYear() === now.getFullYear()
                && date.getMonth() === now.getMonth()
                && date.getDate() === now.getDate();

            if (isToday) {
                return date.toLocaleTimeString('ru', {
                    hour: '2-digit',
                    minute: '2-digit',
                });
            }

            return date.toLocaleDateString('ru', {
                day: 'numeric',
                month: 'short',
            });
        } catch {
            return '';
        }
    },

    /**
     * Обрезает заголовок до разумной длины
     *
     * @param {string} title
     * @param {number} maxLength
     * @returns {string}
     * @private
     */
    _truncateTitle(title, maxLength = 40) {
        if (!title || title.length <= maxLength) return title || '';
        return title.slice(0, maxLength) + '\u2026'; // …
    },

    /**
     * Сохраняет состояние панели в localStorage
     * @private
     */
    _saveCollapsed() {
        try {
            localStorage.setItem('chat_history_collapsed', this._collapsed ? '1' : '0');
        } catch { /* ignore */ }
    },

    /**
     * Восстанавливает состояние панели из localStorage
     * @private
     */
    _restoreCollapsed() {
        try {
            this._collapsed = localStorage.getItem('chat_history_collapsed') === '1';
        } catch {
            this._collapsed = false;
        }
    },
};

window.ChatHistory = ChatHistory;
