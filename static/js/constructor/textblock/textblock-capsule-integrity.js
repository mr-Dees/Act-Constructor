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
                if (span.parentNode) span.parentNode.replaceChild(text, span);
                return;
            }

            // Дубль id: смотрим — расщеплённый клон (склеить) или независимый (новый id).
            const id = span.getAttribute(idAttr);
            if (id && seen.has(id)) {
                const first = seen.get(id);
                if (this._areAdjacentSplit(first, span, valAttr)) {
                    first.textContent = (first.textContent || '') + (span.textContent || '');
                    if (span.parentNode) span.parentNode.removeChild(span);
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
     * Префикс 'm_' (generic) — намеренно: де-дуплицируем и ссылки, и сноски,
     * поэтому не 'link_'/'footnote_'.
     * @returns {string}
     */
    _freshMarkerId() {
        return 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    /**
     * Слой 1 (prevent): перехват нативных правок ДО мутации DOM. Останавливает
     * порчу капсул — атомарное удаление, ввод снаружи, неклипающее удаление.
     * @param {InputEvent} e
     * @param {HTMLElement} editor
     * @param {object} textBlock
     */
    handleEditorBeforeInput(e, editor, textBlock) {
        const ranges = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
        const type = e.inputType;

        const DELETE_TYPES = ['deleteContentBackward', 'deleteContentForward',
            'deleteWordBackward', 'deleteWordForward', 'deleteByCut',
            'deleteByDrag', 'deleteSoftLineBackward'];
        const INSERT_TEXT_TYPES = ['insertText', 'insertReplacementText'];

        if (DELETE_TYPES.includes(type)) {
            if (!ranges.length) return;
            const r = ranges[0];
            // (а) схлопнутое удаление, примыкающее к капсуле → удалить целиком.
            if (r.collapsed) {
                const hit = this._staticRangeTouchesCapsule(r, editor);
                if (hit && (hit.side === 'before' || hit.side === 'after')) {
                    const forward = (type === 'deleteContentForward' || type === 'deleteWordForward');
                    // Backspace удаляет капсулу СЛЕВА от каретки, Delete — СПРАВА.
                    const target = forward
                        ? (hit.side === 'before' ? hit.capsule : null)
                        : (hit.side === 'after' ? hit.capsule : null);
                    if (target) {
                        e.preventDefault();
                        this._deleteCapsuleWhole(target);
                        if (this.renumberEditorFootnotes) this.renumberEditorFootnotes();
                        this.saveContent(editor.dataset.textBlockId, editor.innerHTML);
                        this._toggleEmptyClass(editor);
                    }
                }
                return;
            }
            // (б) непустое удаление, клипающее тело капсулы → расширить и удалить.
            const hit = this._staticRangeTouchesCapsule(r, editor);
            if (hit && hit.side === 'inside') {
                e.preventDefault();
                const range = this._expandStaticRangeOutOfMarkers(r, editor);
                range.deleteContents();
                const sel = window.getSelection();
                if (sel) { sel.removeAllRanges(); sel.addRange(range); }
                this.saveContent(editor.dataset.textBlockId, editor.innerHTML);
                this._toggleEmptyClass(editor);
            }
            return;
        }

        if (INSERT_TEXT_TYPES.includes(type)) {
            if (!ranges.length) return;
            const hit = this._staticRangeTouchesCapsule(ranges[0], editor);
            if (hit && hit.side === 'inside') {
                // Ввод пришёлся в тело/guard капсулы → перенаправляем наружу.
                e.preventDefault();
                this._placeCaretBesideMarker(hit.capsule, true); // каретка справа от капсулы
                const sel = window.getSelection();
                if (sel && sel.rangeCount && e.data) {
                    const range = sel.getRangeAt(0);
                    range.insertNode(document.createTextNode(e.data));
                    range.collapse(false);
                    sel.removeAllRanges(); sel.addRange(range);
                }
                this.saveContent(editor.dataset.textBlockId, editor.innerHTML);
                this._toggleEmptyClass(editor);
            }
        }
        // insertCompositionText (IME), historyUndo/Redo, insertFromDrop —
        // не вмешиваемся, страхует слой 3.
    },

    /**
     * @private Классифицирует StaticRange относительно капсул редактора.
     * @returns {{capsule: Element, side: 'before'|'after'|'inside'}|null}
     */
    _staticRangeTouchesCapsule(range, editor) {
        const sc = range.startContainer, so = range.startOffset;
        const ec = range.endContainer, eo = range.endOffset;

        // Конец/начало ВНУТРИ тела капсулы (граница клипает атом).
        const insideCapsule = (node) => {
            let el = node && node.nodeType === 3 ? node.parentElement : node;
            while (el && el !== editor) {
                if (this._isCapsule(el)) return el;
                el = el.parentElement;
            }
            return null;
        };
        const insStart = insideCapsule(sc);
        const insEnd = insideCapsule(ec);
        if (insStart || insEnd) return { capsule: insStart || insEnd, side: 'inside' };

        // Схлопнутая каретка примыкает к капсуле (через guard или напрямую).
        if (sc === ec && so === eo) {
            let before = null, after = null;
            if (sc.nodeType === 3) {
                if (so === 0) before = this._significantSibling(sc, 'previousSibling');
                if (so === sc.length) after = this._significantSibling(sc, 'nextSibling');
                // каретка внутри текста (0<so<len) — к капсуле не примыкает
            } else {
                const rawBefore = sc.childNodes[so - 1] || null;
                const rawAfter = sc.childNodes[so] || null;
                before = this._isInsignificantText(rawBefore)
                    ? this._significantSibling(rawBefore, 'previousSibling') : rawBefore;
                after = this._isInsignificantText(rawAfter)
                    ? this._significantSibling(rawAfter, 'nextSibling') : rawAfter;
            }
            if (this._isCapsule(before)) return { capsule: before, side: 'after' };  // капсула слева
            if (this._isCapsule(after)) return { capsule: after, side: 'before' };   // капсула справа
        }
        return null;
    },

    /** @private Удаляет капсулу целиком вместе с её caret-guard'ами по бокам. */
    _deleteCapsuleWhole(capsule) {
        const guardChar = this.CAP_GUARD_CHAR;
        const prev = capsule.previousSibling, next = capsule.nextSibling;
        if (prev && prev.nodeType === 3 && prev.data === guardChar) prev.remove();
        if (next && next.nodeType === 3 && next.data === guardChar) next.remove();
        capsule.remove();
    },

    /** @private StaticRange → живой Range, расширенный за целые капсулы. */
    _expandStaticRangeOutOfMarkers(staticRange, editor) {
        const range = document.createRange();
        range.setStart(staticRange.startContainer, staticRange.startOffset);
        range.setEnd(staticRange.endContainer, staticRange.endOffset);
        const ancestor = (node) => {
            let el = node && node.nodeType === 3 ? node.parentElement : node;
            while (el && el !== editor) {
                if (this._isCapsule(el)) return el;
                el = el.parentElement;
            }
            return null;
        };
        const sm = ancestor(range.startContainer);
        if (sm) range.setStartBefore(sm);
        const em = ancestor(range.endContainer);
        if (em) range.setEndAfter(em);
        return range;
    },
});
