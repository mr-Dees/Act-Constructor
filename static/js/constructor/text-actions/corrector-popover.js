/**
 * Поповер «Корректор» — Variant B: выпадашка от кнопки тулбара текстблока.
 *
 * Показывает word-diff исправленного текста в ресайзабельном поле и даёт
 * принять / отклонить / перегенерировать. Поповер вложен в группу тулбара
 * (position:absolute), поэтому переживает blur-guard редактора и остаётся
 * «привязанным к кнопке». Замена выделения — через ActSearchEngine.replaceRange
 * + textBlockManager.finalizeEdit (тот же сток персиста, что печать и find-bar).
 */
import { DiffEngine } from '../../portal/acts-manager/diff-engine.js';
import { SafeHTML } from '../../shared/sanitize.js';
import { Notifications } from '../../shared/notifications.js';
import { EscapeStack } from '../../shared/escape-stack.js';
import { makeResizablePanel } from '../../shared/resizable-panel.js';
import { ActSearchEngine } from '../search/act-search-engine.js';
import { textBlockManager } from '../textblock/textblock-core.js';
import { correctText } from './text-actions-client.js';

export const CorrectorPopover = {
    _el: null,
    _els: null,
    _resizer: null,
    _escUnsub: null,
    _outsideHandler: null,
    _controller: null,
    _editor: null,
    _range: null,
    _sourceText: '',
    _corrected: '',

    /**
     * @param {{button: HTMLElement, editor: HTMLElement, range: Range, text: string}} opts
     */
    open({ button, editor, range, text }) {
        this._build(button);
        this._editor = editor;
        this._range = range;
        this._sourceText = text;
        this._corrected = '';
        this._el.classList.remove('hidden');
        if (!this._escUnsub) this._escUnsub = EscapeStack.push(() => this.close());
        this._bindOutside();
        this._request();
    },

    close() {
        this._abort();
        if (this._el) this._el.classList.add('hidden');
        if (this._escUnsub) { this._escUnsub(); this._escUnsub = null; }
        this._unbindOutside();
        this._editor = null;
        this._range = null;
        this._corrected = '';
    },

    _build(button) {
        if (this._el) return;
        const group = button.closest('.toolbar-group') || button.parentElement;
        group.classList.add('toolbar-group-corrector');
        const el = document.createElement('div');
        el.className = 'corrector-popover hidden';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Корректор текста');
        el.innerHTML = `
            <div class="corrector-header">
                <span class="corrector-title">✨ Корректор</span>
                <button type="button" class="corrector-close" data-role="close" title="Закрыть">✕</button>
            </div>
            <div class="corrector-body" data-role="body"></div>
            <div class="corrector-actions">
                <button type="button" class="corrector-btn corrector-regen" data-role="regen" title="Перегенерировать">↻</button>
                <button type="button" class="corrector-btn corrector-reject" data-role="reject">Отклонить</button>
                <button type="button" class="corrector-btn corrector-accept" data-role="accept">Принять</button>
            </div>
            <div class="corrector-resize" data-role="resize" title="Изменить размер"></div>
        `;
        group.appendChild(el);
        this._el = el;
        this._els = {
            body: el.querySelector('[data-role="body"]'),
            accept: el.querySelector('[data-role="accept"]'),
            reject: el.querySelector('[data-role="reject"]'),
            regen: el.querySelector('[data-role="regen"]'),
            close: el.querySelector('[data-role="close"]'),
            resize: el.querySelector('[data-role="resize"]'),
        };
        // B-40: не воруем фокус/выделение у редактора. У кнопок — свой preventDefault;
        // прочие зоны тоже гасим, кроме грипа ресайза (ему нужен нативный mousedown).
        el.querySelectorAll('button').forEach((b) => {
            b.addEventListener('mousedown', (e) => e.preventDefault());
            b.addEventListener('pointerdown', (e) => e.preventDefault());
        });
        el.addEventListener('mousedown', (e) => {
            if (e.target === this._els.resize) return;
            if (e.target.closest('button')) return;
            e.preventDefault();
        });
        this._els.accept.addEventListener('click', () => this._accept());
        this._els.reject.addEventListener('click', () => this.close());
        this._els.close.addEventListener('click', () => this.close());
        this._els.regen.addEventListener('click', () => this._request());
        this._resizer = makeResizablePanel({
            panel: el,
            handle: this._els.resize,
            growX: 'left',
            minWidth: 280,
            maxWidthVw: 90,
            minHeight: 120,
            maxHeightVh: 80,
            storageKey: 'corrector:popover:size',
            cursor: 'nesw-resize',
        });
    },

    _setBusy(busy) {
        this._els.accept.disabled = busy;
        this._els.regen.disabled = busy;
    },

    async _request() {
        this._abort();
        this._controller = new AbortController();
        this._setBusy(true);
        this._els.body.innerHTML = '<div class="corrector-status">Обрабатываю…</div>';
        try {
            const corrected = await correctText(
                this._sourceText, { signal: this._controller.signal });
            this._corrected = corrected;
            this._renderDiff(this._sourceText, corrected);
            this._setBusy(false);
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            this._corrected = '';
            this._els.body.innerHTML = '';
            const msg = document.createElement('div');
            msg.className = 'corrector-status corrector-error';
            msg.textContent = (e && e.message) ? e.message : 'Ошибка обработки текста';
            this._els.body.appendChild(msg);
            this._els.accept.disabled = true;
            this._els.regen.disabled = false;
        }
    },

    _renderDiff(before, after) {
        const ops = DiffEngine._wordDiff(before, after);
        const html = ops.map((part) => {
            const esc = this._escape(part.text);
            if (part.type === 'insert') return `<ins>${esc}</ins>`;
            if (part.type === 'delete') return `<del>${esc}</del>`;
            return esc;
        }).join(' ');
        this._els.body.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'corrector-diff';
        this._els.body.appendChild(wrap);
        SafeHTML.set(wrap, html);
    },

    _escape(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    _accept() {
        if (!this._corrected || !this._range || !this._editor) { this.close(); return; }
        try {
            ActSearchEngine.replaceRange(this._range, this._corrected);
        } catch (e) {
            // replaceRange бросает, если выделение пересекает границу капсулы.
            Notifications.warning(
                'В выделении есть ссылка или сноска — сузьте выделение и повторите');
            return;
        }
        textBlockManager.finalizeEdit(this._editor);
        Notifications.success('Текст исправлен');
        this.close();
    },

    _bindOutside() {
        if (this._outsideHandler) return;
        this._outsideHandler = (e) => {
            if (!this._el || this._el.contains(e.target)) return;
            // Клик по самой кнопке ✨ не закрывает (её обработчик сам решает).
            if (e.target.closest && e.target.closest('[data-command="improveText"]')) return;
            this.close();
        };
        document.addEventListener('mousedown', this._outsideHandler, true);
    },

    _unbindOutside() {
        if (this._outsideHandler) {
            document.removeEventListener('mousedown', this._outsideHandler, true);
            this._outsideHandler = null;
        }
    },

    _abort() {
        if (this._controller) {
            try { this._controller.abort(); } catch (_) { /* no-op */ }
            this._controller = null;
        }
    },
};

window.CorrectorPopover = CorrectorPopover;
