/**
 * SSE-клиент для стриминга сообщений чата
 *
 * Отправляет сообщения через FormData и обрабатывает Server-Sent Events
 * от бэкенда. Поддерживает два режима: стриминг (SSE) и полный JSON-ответ.
 */
const ChatStream = {

    /**
     * Отправляет сообщение и читает SSE-поток ответа
     *
     * @param {string} conversationId — ID беседы
     * @param {string} message — текст сообщения
     * @param {File[]} files — прикреплённые файлы
     * @param {Object} options — параметры
     * @param {string[]} [options.domains] — фильтр доменов
     * @param {function({type: string, data: *}): void} [options.onEvent] — обработчик SSE-событий
     * @param {function(Error): void} [options.onError] — обработчик ошибок
     * @param {function(): void} [options.onDone] — вызывается при завершении потока
     */
    async send(conversationId, message, files = [], options = {}) {
        const { domains, onEvent, onError, onDone } = options;

        try {
            const formData = this._buildFormData(message, files, domains);
            const url = this._buildUrl(conversationId);
            const headers = this._buildHeaders('text/event-stream');

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    // Обрабатываем оставшиеся данные в буфере
                    if (buffer.trim()) {
                        const { parsed } = this._parseSSE(buffer + '\n\n');
                        for (const event of parsed) {
                            if (onEvent) onEvent(event);
                        }
                    }
                    if (onDone) onDone();
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const { parsed, remaining } = this._parseSSE(buffer);
                buffer = remaining;

                for (const event of parsed) {
                    if (onEvent) onEvent(event);
                }
            }
        } catch (err) {
            console.error('ChatStream: ошибка стриминга', err);
            if (onError) onError(err);
        }
    },

    /**
     * Отправляет сообщение и получает полный JSON-ответ (без стриминга)
     *
     * @param {string} conversationId — ID беседы
     * @param {string} message — текст сообщения
     * @param {File[]} files — прикреплённые файлы
     * @param {Object} options — параметры
     * @param {string[]} [options.domains] — фильтр доменов
     * @returns {Promise<Object>} — полный ответ от сервера
     */
    async sendJson(conversationId, message, files = [], options = {}) {
        const { domains } = options;

        const formData = this._buildFormData(message, files, domains);
        const url = this._buildUrl(conversationId);
        const headers = this._buildHeaders('application/json');

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    },

    /**
     * Парсит буфер SSE-данных на отдельные события
     *
     * @param {string} buffer — накопленный текст из потока
     * @returns {{ parsed: Array<{type: string, data: *}>, remaining: string }}
     * @private
     */
    _parseSSE(buffer) {
        const parsed = [];
        const parts = buffer.split('\n\n');

        // Последняя часть может быть неполным событием — сохраняем
        const remaining = parts.pop() || '';

        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            let eventType = 'message';
            let eventData = null;

            const lines = trimmed.split('\n');
            for (const line of lines) {
                if (line.startsWith('event:')) {
                    eventType = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    const raw = line.slice(5).trim();
                    try {
                        eventData = JSON.parse(raw);
                    } catch {
                        eventData = raw;
                    }
                }
            }

            if (eventData !== null) {
                parsed.push({ type: eventType, data: eventData });
            }
        }

        return { parsed, remaining };
    },

    /**
     * Формирует FormData для отправки
     *
     * @param {string} message — текст сообщения
     * @param {File[]} files — файлы
     * @param {string[]} [domains] — домены
     * @returns {FormData}
     * @private
     */
    _buildFormData(message, files, domains) {
        const formData = new FormData();
        formData.append('message', message);

        if (domains && domains.length > 0) {
            formData.append('domains', JSON.stringify(domains));
        }

        for (const file of files) {
            formData.append('files', file);
        }

        return formData;
    },

    /**
     * Формирует URL эндпоинта сообщений
     *
     * @param {string} conversationId — ID беседы
     * @returns {string}
     * @private
     */
    _buildUrl(conversationId) {
        const endpoint = `/api/v1/chat/conversations/${conversationId}/messages`;
        if (typeof AppConfig !== 'undefined') {
            return AppConfig.api.getUrl(endpoint);
        }
        return endpoint;
    },

    /**
     * Формирует заголовки запроса
     *
     * @param {string} accept — значение Accept (text/event-stream или application/json)
     * @returns {Object}
     * @private
     */
    _buildHeaders(accept) {
        const headers = {
            'Accept': accept,
        };

        if (typeof AuthManager !== 'undefined' && AuthManager.getCurrentUser()) {
            Object.assign(headers, AuthManager.getAuthHeaders());
        }

        return headers;
    },
};

window.ChatStream = ChatStream;
