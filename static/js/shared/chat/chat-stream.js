/**
 * SSE-клиент для стриминга сообщений чата
 *
 * Отправляет сообщения через FormData и обрабатывает Server-Sent Events
 * от бэкенда. Поддерживает два режима: стриминг (SSE) и полный JSON-ответ.
 */
const ChatStream = {

    /** @type {AbortController|null} Контроллер для отмены текущего стрима */
    _abortController: null,

    /**
     * @type {string|null} Идентификатор agent_request, который сейчас обрабатывает
     * внешний агент. Приходит из SSE-события `agent_request_started`. Используется
     * для авто-переоткрытия resume-стрима при разрыве соединения.
     */
    _pendingAgentRequestId: null,

    /** @type {string|null} ID беседы, для которой активен _pendingAgentRequestId. */
    _pendingConversationId: null,

    /** @type {number} Последний полученный id события агента (для ?since=). */
    _lastAgentEventId: 0,

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

        // Отменяем предыдущий стрим, если есть
        this.abort();

        // Сбрасываем состояние forward'а — новое сообщение начинает с чистого листа.
        this._pendingAgentRequestId = null;
        this._pendingConversationId = conversationId;
        this._lastAgentEventId = 0;

        const controller = new AbortController();
        this._abortController = controller;

        // Перехватываем onEvent, чтобы поймать agent_request_started.
        const wrappedOnEvent = (event) => {
            this._trackAgentEvent(event);
            if (onEvent) onEvent(event);
        };

        try {
            const formData = this._buildFormData(message, files, domains);
            const url = this._buildUrl(conversationId);
            const headers = this._buildHeaders('text/event-stream');

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: formData,
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            await this._readSSE(response, controller, wrappedOnEvent);

            if (onDone) onDone();
            this._clearPending();
        } catch (err) {
            if (err.name === 'AbortError') {
                // Стрим отменён явно — не сообщаем об ошибке
                if (onDone) onDone();
                this._clearPending();
                return;
            }
            // Если соединение оборвалось во время forward'а к внешнему агенту,
            // backend всё равно продолжит polling в фоне (см. agent_bridge_runner).
            // Здесь пробуем переоткрыть resume-стрим, чтобы дотянуть ответ
            // в текущем UI без перезагрузки страницы.
            if (this._pendingAgentRequestId) {
                console.warn(
                    'ChatStream: разрыв соединения, переоткрываем resume для',
                    this._pendingAgentRequestId,
                );
                try {
                    await this._resumeAgentRequest(
                        this._pendingConversationId,
                        this._pendingAgentRequestId,
                        this._lastAgentEventId,
                        wrappedOnEvent,
                    );
                    if (onDone) onDone();
                    this._clearPending();
                    return;
                } catch (resumeErr) {
                    console.error('ChatStream: resume не удался', resumeErr);
                }
            }
            console.error('ChatStream: ошибка стриминга', err);
            this._clearPending();
            if (onError) onError(err);
        } finally {
            if (this._abortController === controller) {
                this._abortController = null;
            }
        }
    },

    /**
     * Перехватчик SSE: запоминает agent_request_started и обновляет last_event_id.
     * @private
     */
    _trackAgentEvent(event) {
        if (event.type === 'agent_request_started' && event.data) {
            this._pendingAgentRequestId = event.data.request_id || null;
        }
        // Backend пока не пробрасывает event_id агента во фронт; держим стартовое 0.
        // Если в будущем events будут содержать id — обновлять здесь.
    },

    /** @private */
    _clearPending() {
        this._pendingAgentRequestId = null;
        this._pendingConversationId = null;
        this._lastAgentEventId = 0;
    },

    /**
     * Переоткрывает SSE через GET resume-эндпоинт. Используется после разрыва.
     * @private
     */
    async _resumeAgentRequest(conversationId, requestId, sinceId, onEvent) {
        const controller = new AbortController();
        this._abortController = controller;

        const endpoint =
            `/api/v1/chat/conversations/${conversationId}` +
            `/agent-request/${requestId}/stream?since=${sinceId}`;
        const url = (typeof AppConfig !== 'undefined')
            ? AppConfig.api.getUrl(endpoint)
            : endpoint;
        const headers = this._buildHeaders('text/event-stream');

        const response = await fetch(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`resume HTTP ${response.status}`);
        }
        await this._readSSE(response, controller, onEvent);
    },

    /** @private */
    async _readSSE(response, controller, onEvent) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    if (buffer.trim()) {
                        const { parsed } = this._parseSSE(buffer + '\n\n');
                        for (const event of parsed) {
                            if (onEvent) onEvent(event);
                        }
                    }
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const { parsed, remaining } = this._parseSSE(buffer);
                buffer = remaining;
                for (const event of parsed) {
                    if (onEvent) onEvent(event);
                }
            }
        } finally {
            // Освобождаем reader: при abort() контроллера поток остаётся
            // не освобождённым, и следующий fetch на тот же origin может
            // зависнуть. Сначала cancel() (флашит underlying stream),
            // затем releaseLock(). Оба вызова идемпотентны и завёрнуты
            // в try, потому что на уже отменённом/освобождённом reader
            // они бросают.
            try { await reader.cancel(); } catch { /* ignore */ }
            try { reader.releaseLock(); } catch { /* ignore */ }
        }
    },

    /**
     * Отменяет текущий SSE-стрим, если он активен
     */
    abort() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
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
