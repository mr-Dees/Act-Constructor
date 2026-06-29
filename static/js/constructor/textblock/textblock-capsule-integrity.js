/**
 * Капсула-интегритет: предохранитель целостности ссылок/сносок на записи в БД.
 * Часть prevent-then-heal-механизма (слои beforeinput/observer — в этом же
 * файле, добавляются отдельными задачами). Здесь — чистый валидатор-починка.
 */
import { TextBlockManager } from './textblock-core.js';

Object.assign(TextBlockManager.prototype, {
    /**
     * Чинит инварианты капсул в HTML-строке ПЕРЕД сохранением/при загрузке.
     * Чистая по сигнатуре (строка→строка), идемпотентна, парсит в detached
     * <template> (живой DOM не трогает). Чинит:
     *  - дубль data-*-id у независимых капсул → клону свежий id;
     *  - расщеплённый клон (тот же id, соседи, то же значение) → склейка;
     *  - пустой data-link-url/data-footnote-text → разворот в plain-text;
     *  - страховочный стрип guard-символов (U+FEFF) и contenteditable.
     * @param {string} html
     * @returns {string}
     */
    validateAndRepairCapsules(html) {
        if (typeof html !== 'string') return html;
        if (html.indexOf('text-link') === -1 && html.indexOf('text-footnote') === -1) {
            return this._stripGuards ? this._stripGuards(html) : html;
        }
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        this._repairCapsulesInRoot(tpl.content);
        return tpl.innerHTML;
    },

    /**
     * @private Починка капсул внутри root-узла (DocumentFragment ИЛИ живой
     * editor). Общая логика для валидатора и слоя-observer (DRY).
     * @param {DocumentFragment|HTMLElement} root
     */
    _repairCapsulesInRoot(root) {
        const guardChar = this.CAP_GUARD_CHAR;
        // id → первая встреченная капсула с этим id (в document order)
        const seen = new Map();
        root.querySelectorAll('.text-link, .text-footnote').forEach(span => {
            const isLink = span.classList.contains('text-link');
            const idAttr = isLink ? 'data-link-id' : 'data-footnote-id';
            const valAttr = isLink ? 'data-link-url' : 'data-footnote-text';

            // Тело капсулы — без contenteditable и guard-символов.
            span.removeAttribute('contenteditable');
            if (span.textContent && span.textContent.indexOf(guardChar) !== -1) {
                span.textContent = span.textContent.split(guardChar).join('');
            }

            // Пустое значение → развернуть капсулу в её текст.
            const val = span.getAttribute(valAttr);
            if (!val || !val.trim()) {
                const text = document.createTextNode(span.textContent || '');
                span.parentNode.replaceChild(text, span);
                return;
            }

            // Дубль id: смотрим — расщеплённый клон (склеить) или независимый (новый id).
            const id = span.getAttribute(idAttr);
            if (id && seen.has(id)) {
                const first = seen.get(id);
                if (this._areAdjacentSplit(first, span, valAttr)) {
                    first.textContent = (first.textContent || '') + (span.textContent || '');
                    span.parentNode.removeChild(span);
                    return;
                }
                const fresh = this._freshMarkerId();
                span.setAttribute(idAttr, fresh);
                seen.set(fresh, span);
                return;
            }
            if (id) seen.set(id, span);
        });
        if (this._cleanCapGuards) this._cleanCapGuards(root);
    },

    /**
     * @private Две капсулы — расщеплённый клон одного маркера? (один родитель,
     * между ними только незначимые узлы, равные значения). extractContents с
     * границей внутри маркера делает именно такой клон.
     * @param {Element} a
     * @param {Element} b
     * @param {string} valAttr
     * @returns {boolean}
     */
    _areAdjacentSplit(a, b, valAttr) {
        if (a.parentNode !== b.parentNode) return false;
        if (a.getAttribute(valAttr) !== b.getAttribute(valAttr)) return false;
        let n = a.nextSibling;
        while (n && n !== b) {
            if (!this._isInsignificantText(n)) return false;
            n = n.nextSibling;
        }
        return n === b;
    },

    /**
     * @private Свежий id маркера.
     * Схема совпадает с createLinkMarker и _createOrEditInlineMarker:
     * prefix + Date.now() + '_' + Math.random().toString(36).substr(2, 9).
     * @returns {string}
     */
    _freshMarkerId() {
        return 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },
});
