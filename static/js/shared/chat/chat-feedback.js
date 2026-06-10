/**
 * Обратная связь по сообщениям ассистента (лайк/дизлайк).
 *
 * Прикрепляет под завершённым ответом ассистента ряд действий:
 * «Копировать» · 👍 · 👎. Лайк — мгновенно одним кликом; дизлайк — мгновенно
 * + раскрывает опциональную форму с категориями причин и комментарием.
 * Оценка переключаемая/отменяемая (повторный клик по активной кнопке снимает),
 * идемпотентная по сообщению. Запросы — через AppConfig.api.getUrl (JupyterHub
 * proxy). Доступность: нативные <button> с aria-pressed; aria-label фиксирован;
 * подтверждение через aria-live. См. docs/guides/chat-observability-and-feedback.md.
 */

import { AppConfig } from '../app-config.js';
import { AuthManager } from '../auth.js';
import { ChatContext } from './chat-context.js';
import { ChatEventBus } from './chat-event-bus.js';
import { Notifications } from '../notifications.js';

// Словарь причин дизлайка — синхронизирован с FEEDBACK_REASON_CODES
// (app/domains/chat/services/chat_feedback_service.py). При расхождении кодов
// бэкенд вернёт 422.
const REASONS = [
    { code: 'inaccurate', label: 'Неточно / ошибка' },
    { code: 'not_relevant', label: 'Не по теме' },
    { code: 'incomplete', label: 'Неполный ответ' },
    { code: 'not_from_kb', label: 'Не из базы знаний' },
    { code: 'formatting', label: 'Плохое оформление' },
    { code: 'unsafe', label: 'Некорректно / небезопасно' },
    { code: 'other', label: 'Другое' },
];

const ICON_COPY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_UP = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 10v11M2 11v9a1 1 0 001 1h3V10H3a1 1 0 00-1 1zM7 10l4-7a2 2 0 012 2v3h5a2 2 0 012 2.3l-1.4 7A2 2 0 0118.6 21H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_DOWN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M17 14V3M22 13V4a1 1 0 00-1-1h-3v11h3a1 1 0 001-1zM17 14l-4 7a2 2 0 01-2-2v-3H6a2 2 0 01-2-2.3l1.4-7A2 2 0 015.4 3H17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const ChatFeedback = {

    REASONS,

    /**
     * Прикрепляет панель обратной связи в конец контейнера сообщения ассистента.
     *
     * @param {HTMLElement} contentEl — .chat-message-content бот-сообщения
     * @param {Object} opts
     * @param {string} opts.conversationId
     * @param {string} opts.messageId
     * @param {Object|null} [opts.initial] — ранее выставленная оценка
     *        {rating, reasons, comment} (из истории) или null.
     */
    attach(contentEl, { conversationId, messageId, initial = null } = {}) {
        if (!contentEl || !conversationId || !messageId) return;
        // Идемпотентность: панель уже есть — не дублируем.
        if (contentEl.querySelector(':scope > .chat-feedback')) return;

        const panel = document.createElement('div');
        panel.className = 'chat-feedback';
        panel.dataset.messageId = messageId;

        const actions = document.createElement('div');
        actions.className = 'chat-feedback-actions';

        const copyBtn = this._makeButton('chat-feedback-copy', 'Копировать ответ', ICON_COPY);
        const upBtn = this._makeButton('chat-feedback-up', 'Полезный ответ', ICON_UP);
        const downBtn = this._makeButton('chat-feedback-down', 'Бесполезный ответ', ICON_DOWN);
        upBtn.setAttribute('aria-pressed', 'false');
        downBtn.setAttribute('aria-pressed', 'false');

        actions.append(copyBtn, upBtn, downBtn);
        panel.appendChild(actions);

        const form = this._buildForm();
        panel.appendChild(form);

        const ack = document.createElement('div');
        ack.className = 'chat-feedback-ack';
        ack.setAttribute('role', 'status');
        ack.setAttribute('aria-live', 'polite');
        ack.hidden = true;
        panel.appendChild(ack);

        contentEl.appendChild(panel);

        const ctx = {
            conversationId, messageId, rating: null, busy: false,
            upBtn, downBtn, form, ack,
        };

        // Восстановление ранее выставленной оценки (из истории).
        if (initial && (initial.rating === 'up' || initial.rating === 'down')) {
            this._setActive(ctx, initial.rating);
            if (initial.rating === 'down') {
                this._populateForm(form, initial.reasons, initial.comment);
            }
        }

        copyBtn.addEventListener('click', () => this._copy(copyBtn, contentEl));
        upBtn.addEventListener('click', () => this._onVote(ctx, 'up'));
        downBtn.addEventListener('click', () => this._onVote(ctx, 'down'));
        form.querySelector('.chat-feedback-submit')
            .addEventListener('click', () => this._submitDetails(ctx));
    },

    /** Создаёт нативную icon-кнопку с фиксированным aria-label. @private */
    _makeButton(cls, label, svg) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `chat-feedback-btn ${cls}`;
        btn.setAttribute('aria-label', label);
        btn.title = label;
        btn.innerHTML = svg;
        return btn;
    },

    /** Строит свёрнутую форму причин дизлайка (категории + комментарий). @private */
    _buildForm() {
        const form = document.createElement('div');
        form.className = 'chat-feedback-form';
        form.hidden = true;

        const fieldset = document.createElement('fieldset');
        fieldset.className = 'chat-feedback-reasons';
        const legend = document.createElement('legend');
        legend.textContent = 'Что не так с ответом? (необязательно)';
        fieldset.appendChild(legend);

        for (const r of REASONS) {
            const labelEl = document.createElement('label');
            labelEl.className = 'chat-feedback-reason';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = r.code;
            const span = document.createElement('span');
            span.textContent = r.label;
            labelEl.append(input, span);
            fieldset.appendChild(labelEl);
        }
        form.appendChild(fieldset);

        const textarea = document.createElement('textarea');
        textarea.className = 'chat-feedback-comment';
        textarea.rows = 2;
        textarea.maxLength = 2000;
        textarea.placeholder = 'Расскажите подробнее (необязательно)';
        textarea.setAttribute('aria-label', 'Комментарий к оценке');
        form.appendChild(textarea);

        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'chat-feedback-submit';
        submit.textContent = 'Отправить';
        form.appendChild(submit);

        return form;
    },

    /** Предзаполняет форму ранее сохранёнными причинами и комментарием. @private */
    _populateForm(form, reasons, comment) {
        const set = new Set(Array.isArray(reasons) ? reasons : []);
        form.querySelectorAll('.chat-feedback-reason input').forEach((i) => {
            i.checked = set.has(i.value);
        });
        if (typeof comment === 'string') {
            form.querySelector('.chat-feedback-comment').value = comment;
        }
    },

    /**
     * Оборачивает действие in-flight guard'ом: busy-флаг + блокировка кнопок
     * на время запроса, гарантированное снятие в finally. @private
     */
    async _withBusy(ctx, action) {
        if (ctx.busy) return;
        ctx.busy = true;
        this._setBusy(ctx, true);
        try {
            await action();
        } finally {
            ctx.busy = false;
            this._setBusy(ctx, false);
        }
    },

    /** PUT оценки: тело всегда дополняется снимком режима БЗ. @private */
    _putFeedback(ctx, body) {
        return this._request('PUT', ctx.conversationId, ctx.messageId, {
            agent_mode: this._agentMode(),
            ...body,
        });
    },

    /** Обработчик клика по 👍/👎: ставит/снимает/меняет оценку. @private */
    async _onVote(ctx, rating) {
        await this._withBusy(ctx, async () => {
            const prev = ctx.rating;
            try {
                if (ctx.rating === rating) {
                    // Повторный клик по активной — снятие оценки.
                    await this._request('DELETE', ctx.conversationId, ctx.messageId);
                    this._setActive(ctx, null);
                    this._hideForm(ctx);
                    ChatEventBus.emit('feedback:cleared', { messageId: ctx.messageId });
                } else {
                    await this._putFeedback(ctx, { rating });
                    this._setActive(ctx, rating);
                    if (rating === 'down') {
                        this._showForm(ctx);
                    } else {
                        this._hideForm(ctx);
                    }
                    ChatEventBus.emit('feedback:submitted', {
                        messageId: ctx.messageId, rating,
                    });
                }
            } catch (err) {
                this._setActive(ctx, prev);  // откат оптимистичного состояния
                this._notifyError(err);
            }
        });
    },

    /** Отправляет уточнение дизлайка (причины + комментарий). @private */
    async _submitDetails(ctx) {
        await this._withBusy(ctx, async () => {
            const reasons = Array.from(
                ctx.form.querySelectorAll('.chat-feedback-reason input:checked'),
            ).map((i) => i.value);
            const comment = ctx.form.querySelector('.chat-feedback-comment').value.trim();
            try {
                await this._putFeedback(ctx, {
                    rating: 'down',
                    reasons: reasons.length ? reasons : undefined,
                    comment: comment || undefined,
                });
                this._setActive(ctx, 'down');
                this._hideForm(ctx);
                this._ack(ctx, 'Спасибо за отзыв');
                ChatEventBus.emit('feedback:submitted', {
                    messageId: ctx.messageId, rating: 'down', reasons,
                });
            } catch (err) {
                this._notifyError(err);
            }
        });
    },

    /** Применяет визуальное/aria-состояние выбранной оценки. @private */
    _setActive(ctx, rating) {
        ctx.rating = rating;
        const up = ctx.upBtn;
        const down = ctx.downBtn;
        up.classList.toggle('chat-feedback-btn--active', rating === 'up');
        down.classList.toggle('chat-feedback-btn--active', rating === 'down');
        up.setAttribute('aria-pressed', rating === 'up' ? 'true' : 'false');
        down.setAttribute('aria-pressed', rating === 'down' ? 'true' : 'false');
    },

    _showForm(ctx) { ctx.form.hidden = false; },
    _hideForm(ctx) { ctx.form.hidden = true; },

    /** Блокирует кнопки на время запроса (in-flight guard). @private */
    _setBusy(ctx, busy) {
        [ctx.upBtn, ctx.downBtn].forEach((b) => { b.disabled = busy; });
        const submit = ctx.form.querySelector('.chat-feedback-submit');
        if (submit) submit.disabled = busy;
    },

    /** Показывает ненавязчивое подтверждение через aria-live. @private */
    _ack(ctx, text) {
        ctx.ack.textContent = text;
        ctx.ack.hidden = false;
        clearTimeout(ctx._ackTimer);
        ctx._ackTimer = setTimeout(() => { ctx.ack.hidden = true; }, 3000);
    },

    /** Копирует текст ответа в буфер обмена (исключая саму панель). @private */
    _copy(button, contentEl) {
        const clone = contentEl.cloneNode(true);
        const fb = clone.querySelector('.chat-feedback');
        if (fb) fb.remove();
        const text = (clone.innerText || clone.textContent || '').trim();
        const done = () => {
            const orig = button.getAttribute('aria-label');
            button.classList.add('chat-feedback-btn--ok');
            button.title = 'Скопировано';
            setTimeout(() => {
                button.classList.remove('chat-feedback-btn--ok');
                button.title = orig;
            }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => {
                console.warn('ChatFeedback: не удалось скопировать в буфер обмена');
            });
        }
    },

    /** Текущий режим тумблера БЗ ОАРБ — снимок на строке оценки. @private */
    _agentMode() {
        try {
            return (typeof ChatContext !== 'undefined'
                && typeof ChatContext.getAgentMode === 'function')
                ? ChatContext.getAgentMode() : 'off';
        } catch {
            return 'off';
        }
    },

    /** PUT/DELETE оценки через AppConfig.api.getUrl (JupyterHub-proxy). @private */
    async _request(method, conversationId, messageId, body) {
        const url = AppConfig.api.getUrl(
            AppConfig.chatEndpoints.feedback(conversationId, messageId),
        );
        const headers = { 'Content-Type': 'application/json' };
        if (typeof AuthManager !== 'undefined'
            && AuthManager.getCurrentUser && AuthManager.getCurrentUser()) {
            Object.assign(headers, AuthManager.getAuthHeaders());
        }
        const opts = { method, headers };
        if (body !== undefined) opts.body = JSON.stringify(body);

        const res = await fetch(url, opts);
        if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try {
                const b = await res.json();
                detail = (b && (b.detail || b.error)) || detail;
            } catch { /* тело пустое/не JSON */ }
            const err = new Error(detail);
            err.status = res.status;
            throw err;
        }
        try {
            return await res.json();
        } catch {
            return null;
        }
    },

    /** Показывает ошибку пользователю (тост) и пишет в консоль. @private */
    _notifyError(err) {
        const text = (err && err.message) || 'Не удалось сохранить оценку.';
        console.warn('ChatFeedback:', text, err);
        if (typeof Notifications !== 'undefined'
            && typeof Notifications.error === 'function') {
            try { Notifications.error(text); } catch { /* некритично */ }
        }
    },
};

window.ChatFeedback = ChatFeedback;
