/**
 * Poll-клиент для получения ответов чата.
 *
 * Отправляет сообщение через FormData (POST → JSON {message_id}),
 * затем опрашивает GET /{message_id} до статуса complete/failed.
 * Декоративный эффект печати — на стороне ChatRenderer.
 */
import { AppConfig } from '../app-config.js';
import { AuthManager } from '../auth.js';

export const ChatStream = {

    /**
     * Отправляет сообщение и опрашивает бэк до готовности ответа.
     *
     * @param {string} conversationId — ID беседы
     * @param {string} message — текст сообщения
     * @param {File[]} files — прикреплённые файлы
     * @param {Object} options
     * @param {string} [options.agentMode='off'] — режим агента (off/adaptive/always)
     * @param {string[]|null} [options.domains=null] — фильтр доменов
     * @param {function(Object): void} [options.onReady] — вызывается с {id, status, content}
     * @param {function(Error): void} [options.onError] — вызывается при ошибке
     * @param {AbortSignal} [options.signal] — внешний сигнал отмены
     */
    async sendAndPoll(conversationId, message, files = [], options = {}) {
        const { agentMode = 'off', domains = null, onReady, onError, signal } = options;

        const fd = this._buildFormData(message, files, domains);
        fd.append('agent_mode', agentMode);

        let res;
        try {
            res = await fetch(
                AppConfig.api.getUrl(AppConfig.chatEndpoints.messages(conversationId)),
                { method: 'POST', body: fd, headers: this._buildHeaders(), signal },
            );
        } catch (e) {
            if (onError) onError(e);
            return;
        }

        if (!res.ok) {
            if (onError) onError(await this._errorFromResponse(res));
            return;
        }

        let body;
        try {
            body = await res.json();
        } catch (e) {
            if (onError) onError(new Error('Неверный ответ сервера'));
            return;
        }

        const messageId = body.message_id;
        if (!messageId) {
            if (onError) onError(new Error('Сервер не вернул message_id'));
            return;
        }

        return this.pollMessage(conversationId, messageId, { onReady, onError, signal });
    },

    /**
     * Опрашивает бэк до статуса complete/failed.
     * Используется также для resume при reload/switch посреди ожидания.
     *
     * @param {string} conversationId
     * @param {string} messageId
     * @param {Object} options
     * @param {function(Object): void} [options.onReady]
     * @param {function(Error): void} [options.onError]
     * @param {AbortSignal} [options.signal]
     */
    pollMessage(conversationId, messageId, options = {}) {
        const { onReady, onError, signal } = options;
        const url = AppConfig.api.getUrl(
            `/api/v1/chat/conversations/${conversationId}/messages/${messageId}`,
        );
        const started = Date.now();
        const TIMEOUT_MS = 11 * 60 * 1000; // чуть больше серверного answer_timeout (10 мин)
        const INTERVAL = 1500;

        // Возвращаем Promise, который резолвится в КАЖДОМ терминальном исходе:
        // complete/failed, таймаут, сетевая ошибка, отмена через signal.
        // Без этого `await sendAndPoll(...)` разблокировал бы ui:processing
        // сразу после POST, пока polling ещё идёт.
        return new Promise((resolve) => {
            const tick = async () => {
                if (signal && signal.aborted) {
                    resolve();
                    return;
                }

                let msg;
                try {
                    const r = await fetch(url, { headers: this._buildHeaders(), signal });
                    if (!r.ok) {
                        if (onError) onError(await this._errorFromResponse(r));
                        resolve();
                        return;
                    }
                    msg = await r.json();
                } catch (e) {
                    if (onError) onError(e);
                    resolve();
                    return;
                }

                if (msg.status === 'complete' || msg.status === 'failed') {
                    if (onReady) onReady(msg);
                    resolve();
                    return;
                }

                if (Date.now() - started > TIMEOUT_MS) {
                    if (onError) onError(new Error('Превышено время ожидания ответа.'));
                    resolve();
                    return;
                }

                setTimeout(tick, INTERVAL);
            };

            tick();
        });
    },

    /**
     * Прерывает текущий polling (через переданный AbortController).
     * Метод оставлен для совместимости с вызовами в chat-messages.js —
     * реальная отмена идёт через AbortSignal, хранимый в ChatMessages.
     */
    abort() {
        // no-op: отмена производится через AbortSignal в ChatMessages._pollController
    },

    /**
     * Отправляет сообщение и получает полный JSON-ответ (без polling).
     * Используется там, где SSE/polling не нужны.
     *
     * @param {string} conversationId
     * @param {string} message
     * @param {File[]} files
     * @param {Object} options
     * @param {string[]|null} [options.domains]
     * @returns {Promise<Object>}
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
     * Формирует FormData для отправки сообщения.
     *
     * @param {string} message
     * @param {File[]} files
     * @param {string[]|null} [domains]
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
     * Формирует URL эндпоинта сообщений беседы.
     *
     * @param {string} conversationId
     * @returns {string}
     * @private
     */
    _buildUrl(conversationId) {
        // Голый путь под JupyterHub-proxy уходит на /hub/... → 404,
        // поэтому только через AppConfig.api.getUrl, без fallback'а.
        if (typeof AppConfig === 'undefined') {
            throw new Error('AppConfig недоступен');
        }
        return AppConfig.api.getUrl(AppConfig.chatEndpoints.messages(conversationId));
    },

    /**
     * Формирует заголовки запроса.
     * Параметр accept больше не используется (POST возвращает JSON),
     * но сохранён для совместимости с sendJson.
     *
     * @param {string} [accept]
     * @returns {Object}
     * @private
     */
    _buildHeaders(accept) {
        const headers = {};
        if (accept) headers['Accept'] = accept;

        if (typeof AuthManager !== 'undefined' && AuthManager.getCurrentUser()) {
            Object.assign(headers, AuthManager.getAuthHeaders());
        }

        return headers;
    },

    /**
     * Строит Error из не-ok ответа. Пытается прочитать detail из JSON.
     *
     * @param {Response} response
     * @returns {Promise<Error>}
     * @private
     */
    async _errorFromResponse(response) {
        const fallback = `HTTP ${response.status}: ${response.statusText}`;
        let err;
        try {
            const body = await response.json();
            if (body && typeof body === 'object') {
                err = new Error(body.detail || body.error || fallback);
            }
        } catch { /* тело пустое или не JSON */ }
        if (!err) err = new Error(fallback);
        // Статус нужен вызывающему, чтобы отличить штатное клиентское
        // отклонение (4xx, напр. лимит запросов) от реального сбоя (5xx/сеть).
        err.status = response.status;
        return err;
    },
};

window.ChatStream = ChatStream;
