/**
 * Менеджер чата с AI-ассистентом
 *
 * Управляет отправкой/приёмом сообщений, историей (sessionStorage),
 * typing-индикатором и блокировкой UI во время обработки.
 *
 * Точка замены эхо на реальный API — метод _getResponse().
 */
class ChatManager {
    /** @type {Array<{role: string, content: string, timestamp: number}>} */
    static _history = [];

    /** @type {HTMLElement|null} */
    static _messagesContainer = null;
    /** @type {HTMLInputElement|null} */
    static _input = null;
    /** @type {HTMLButtonElement|null} */
    static _sendBtn = null;
    /** @type {HTMLElement|null} */
    static _placeholder = null;

    /** @type {boolean} */
    static _isProcessing = false;

    static _historyKey = 'chat_history';

    /**
     * Инициализация: кеширование DOM, обработчики, восстановление истории
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

        // Сохраняем welcome-сообщение в историю с sentinel timestamp
        const welcomeMsg = this._messagesContainer.querySelector('.chat-message-bot .chat-message-content');
        if (welcomeMsg) {
            this._history.push({
                role: 'assistant',
                content: welcomeMsg.textContent.trim(),
                timestamp: 0
            });
        }

        // Обработчики
        this._input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this._sendBtn.addEventListener('click', () => {
            this.sendMessage();
        });

        // Восстанавливаем историю из sessionStorage
        this._restoreHistory();

        console.log('ChatManager: инициализация завершена');
    }

    /**
     * Отправляет сообщение пользователя
     */
    static sendMessage() {
        if (this._isProcessing) return;

        const text = this._input.value.trim();
        if (!text) return;

        this._input.value = '';
        this._addUserMessage(text);
        this._processResponse(text);
    }

    /**
     * Обрабатывает ответ: typing → получение → вывод
     * @param {string} userText
     * @private
     */
    static async _processResponse(userText) {
        this._setProcessing(true);
        this._showTypingIndicator();

        try {
            const response = await this._getResponse(userText, this._history);
            this._removeTypingIndicator();
            this._addBotMessage(response);
        } catch (err) {
            this._removeTypingIndicator();
            this._addBotMessage('Произошла ошибка. Попробуйте ещё раз.');
            console.error('ChatManager: ошибка получения ответа', err);
        } finally {
            this._setProcessing(false);
        }
    }

    /**
     * ТОЧКА ЗАМЕНЫ: эхо-ответ → реальный API
     *
     * Для подключения реального API замените тело этого метода на:
     *   const res = await fetch('/api/v1/chat/message', {
     *       method: 'POST',
     *       headers: { 'Content-Type': 'application/json' },
     *       body: JSON.stringify({ message: userText, history })
     *   });
     *   const data = await res.json();
     *   return data.response;
     *
     * @param {string} userText — текст пользователя
     * @param {Array} history — полная история диалога
     * @returns {Promise<string>}
     */
    static async _getResponse(userText, history) {
        const delay = 500 + Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, delay));
        return `Вы написали: «${userText}»`;
    }

    /**
     * Добавляет сообщение пользователя в DOM и историю
     * @param {string} text
     * @private
     */
    static _addUserMessage(text) {
        this._renderMessage('user', text);
        this._pushToHistory('user', text);
    }

    /**
     * Добавляет сообщение бота в DOM и историю
     * @param {string} text
     * @private
     */
    static _addBotMessage(text) {
        this._renderMessage('bot', text);
        this._pushToHistory('assistant', text);
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

        const p = document.createElement('p');
        p.textContent = text;
        content.appendChild(p);

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
     * Добавляет запись в историю и сохраняет в sessionStorage
     * @param {'user'|'assistant'} role
     * @param {string} content
     * @private
     */
    static _pushToHistory(role, content) {
        const entry = { role, content, timestamp: Date.now() };
        this._history.push(entry);
        this._saveHistory();
    }

    /**
     * Сохраняет историю в sessionStorage
     * @private
     */
    static _saveHistory() {
        try {
            sessionStorage.setItem(this._historyKey, JSON.stringify(this._history));
        } catch (e) {
            console.warn('ChatManager: не удалось сохранить историю в sessionStorage', e);
        }
    }

    /**
     * Восстанавливает историю из sessionStorage и ре-рендерит сообщения
     * @private
     */
    static _restoreHistory() {
        try {
            const data = sessionStorage.getItem(this._historyKey);
            if (!data) return;

            const saved = JSON.parse(data);
            if (!Array.isArray(saved) || saved.length === 0) return;

            // Очищаем текущую историю и контейнер сообщений
            this._history = [];
            this._messagesContainer.innerHTML = '';

            for (const entry of saved) {
                this._history.push(entry);

                // Пропускаем welcome-сообщение (sentinel timestamp === 0)
                if (entry.timestamp === 0) continue;

                const displayRole = entry.role === 'assistant' ? 'bot' : 'user';
                this._renderMessage(displayRole, entry.content);
            }
        } catch (e) {
            console.warn('ChatManager: не удалось восстановить историю', e);
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
     * Возвращает текущую историю диалога (для будущего API)
     * @returns {Array<{role: string, content: string, timestamp: number}>}
     */
    static getHistory() {
        return [...this._history];
    }

    /**
     * Очищает историю и sessionStorage
     */
    static clearHistory() {
        this._history = [];
        sessionStorage.removeItem(this._historyKey);
    }
}

// Экспортируем в глобальную область видимости
window.ChatManager = ChatManager;
