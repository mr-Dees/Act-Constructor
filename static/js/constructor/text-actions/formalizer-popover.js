/**
 * Плавающая панель «Формализация нарушения».
 *
 * Тот же оконный chrome, что у CorrectorPopover (перетаскивание за заголовок,
 * ресайз, Esc, персист позиции/размера), но другой поток: аналитик вставляет
 * свободный текст → «Формализовать» → превью извлечённых полей → «Применить»
 * раскладывает их по полям карточки нарушения (что LLM не нашла — поле пустое).
 *
 * Открывается кнопкой на панели нарушения; заголовок — «Корректор отклонения/
 * проблемы по пункту 5.*». Применение делает callback `apply(fields)`, который
 * знает, как обновить объект нарушения и его DOM-контролы (см. violation-core.js).
 */
import { Notifications } from '../../shared/notifications.js';
import { EscapeStack } from '../../shared/escape-stack.js';
import { makeResizablePanel } from '../../shared/resizable-panel.js';
import { makeDraggablePanel } from '../../shared/draggable-panel.js';
import { formalizeViolation } from './text-actions-client.js';

// Поля превью в порядке карточки (Принятые меры — под Причинами, как в форме).
const _PREVIEW_FIELDS = [
    ['violated', 'Нарушено'],
    ['established', 'Установлено'],
    ['reasons', 'Причины'],
    ['measures', 'Принятые меры'],
    ['consequences', 'Последствия'],
    ['responsible', 'Ответственные'],
];

export const FormalizerPopover = {
    _el: null,
    _els: null,
    _resizer: null,
    _dragger: null,
    _escUnsub: null,
    _controller: null,
    _apply: null,
    _fields: null,

    /**
     * @param {{violation: Object, apply: (fields: Object) => void}} opts
     */
    open({ violation, apply }) {
        this._build();
        this._apply = apply;
        this._fields = null;
        this._els.source.value = '';
        this._els.preview.innerHTML = '';
        this._els.accept.disabled = true;
        this._el.classList.remove('hidden');
        if (!this._escUnsub) this._escUnsub = EscapeStack.push(() => this.close());
        this._els.source.focus();
    },

    close() {
        this._abort();
        if (this._el) this._el.classList.add('hidden');
        if (this._escUnsub) { this._escUnsub(); this._escUnsub = null; }
        this._apply = null;
        this._fields = null;
    },

    _abort() {
        if (this._controller) { this._controller.abort(); this._controller = null; }
    },

    _build() {
        if (this._el) return;
        const el = document.createElement('div');
        el.className = 'corrector-popover formalizer-popover hidden';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Формализация нарушения');
        el.innerHTML = `
            <div class="corrector-header" data-role="header">
                <span class="corrector-title">✨ Корректор отклонения/проблемы по пункту 5.*</span>
                <button type="button" class="corrector-close" data-role="close" title="Закрыть">✕</button>
            </div>
            <div class="corrector-body formalizer-body" data-role="body">
                <label class="formalizer-hint">Свободный текст нарушения:</label>
                <textarea class="formalizer-source" data-role="source" rows="5"
                    placeholder="Вставьте или введите описание нарушения…"></textarea>
                <button type="button" class="corrector-btn formalizer-run" data-role="run">Формализовать</button>
                <div class="formalizer-preview" data-role="preview"></div>
            </div>
            <div class="corrector-actions">
                <button type="button" class="corrector-btn corrector-reject" data-role="reject">Отмена</button>
                <button type="button" class="corrector-btn corrector-accept" data-role="accept" disabled>Применить</button>
            </div>
            <div class="corrector-resize" data-role="resize" title="Изменить размер"></div>
        `;
        document.body.appendChild(el);
        this._el = el;
        this._els = {
            header: el.querySelector('[data-role="header"]'),
            source: el.querySelector('[data-role="source"]'),
            run: el.querySelector('[data-role="run"]'),
            preview: el.querySelector('[data-role="preview"]'),
            accept: el.querySelector('[data-role="accept"]'),
            reject: el.querySelector('[data-role="reject"]'),
            close: el.querySelector('[data-role="close"]'),
            resize: el.querySelector('[data-role="resize"]'),
        };
        this._els.run.addEventListener('click', () => this._run());
        this._els.accept.addEventListener('click', () => this._accept());
        this._els.reject.addEventListener('click', () => this.close());
        this._els.close.addEventListener('click', () => this.close());
        this._resizer = makeResizablePanel({
            panel: el,
            handle: this._els.resize,
            growX: 'right',
            minWidth: 340,
            maxWidthVw: 92,
            minHeight: 200,
            maxHeightVh: 85,
            storageKey: 'formalizer:popover:size',
            cursor: 'nwse-resize',
        });
        this._dragger = makeDraggablePanel({
            panel: el,
            handle: this._els.header,
            storageKey: 'formalizer:popover:pos',
        });
    },

    async _run() {
        const text = this._els.source.value;
        if (!text.trim()) {
            Notifications.info('Введите текст нарушения');
            return;
        }
        this._abort();
        this._controller = new AbortController();
        this._els.run.disabled = true;
        this._els.accept.disabled = true;
        this._els.preview.innerHTML = '<div class="corrector-status">Обрабатываю…</div>';
        try {
            const fields = await formalizeViolation(text, { signal: this._controller.signal });
            this._fields = fields;
            this._renderPreview(fields);
            this._els.accept.disabled = false;
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            this._fields = null;
            this._els.preview.innerHTML = '';
            const msg = document.createElement('div');
            msg.className = 'corrector-status corrector-error';
            msg.textContent = (e && e.message) ? e.message : 'Ошибка формализации';
            this._els.preview.appendChild(msg);
        } finally {
            this._els.run.disabled = false;
        }
    },

    _renderPreview(fields) {
        this._els.preview.innerHTML = '';
        for (const [key, label] of _PREVIEW_FIELDS) {
            const value = (fields[key] || '').trim();
            const row = document.createElement('div');
            row.className = 'formalizer-field' + (value ? '' : ' formalizer-field-empty');
            const lab = document.createElement('span');
            lab.className = 'formalizer-field-label';
            lab.textContent = label;
            const val = document.createElement('div');
            val.className = 'formalizer-field-value';
            val.textContent = value || '— не извлечено';
            row.appendChild(lab);
            row.appendChild(val);
            this._els.preview.appendChild(row);
        }
    },

    _accept() {
        if (!this._fields || typeof this._apply !== 'function') { this.close(); return; }
        this._apply(this._fields);
        Notifications.success('Поля карточки заполнены');
        this.close();
    },
};

// Window-global для совместимости с inline-скриптами шаблонов.
window.FormalizerPopover = FormalizerPopover;
