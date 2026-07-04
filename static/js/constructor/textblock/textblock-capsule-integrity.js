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
                        // Единый сток: удаление капсулы могло убрать сноску —
                        // finalizeEdit перенумеровывает по изменению их числа
                        // (CARET-7) и пере-расставляет guard'ы у оставшихся капсул.
                        this.finalizeEdit(editor);
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
                // Единый сток ДО восстановления каретки: normalize двигает
                // guard'ы, перенумерация — по изменению числа сносок (удаление
                // клипнутой капсулы; CARET-7).
                this.finalizeEdit(editor);
                const sel = window.getSelection();
                if (sel) { sel.removeAllRanges(); sel.addRange(range); }
            }
            return;
        }

        if (INSERT_TEXT_TYPES.includes(type)) {
            if (!ranges.length) return;
            const hit = this._staticRangeTouchesCapsule(ranges[0], editor);
            if (hit && hit.side === 'inside') {
                // Ввод пришёлся в тело капсулы → перенаправляем наружу.
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
        // Защитная ветка: реальный Chromium при нажатии Backspace/Delete у капсулы
        // возвращает НЕсхлопнутый getTargetRanges(), покрывающий всю capsule целиком,
        // — этот блок срабатывает для не-Chromium браузеров и программного ввода.
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
        const prev = capsule.previousSibling, next = capsule.nextSibling;
        if (this._isGuardNode(prev)) prev.remove();
        if (this._isGuardNode(next)) next.remove();
        capsule.remove();
    },

    // -------------------------------------------------------------------------
    // Слой 3 (heal): MutationObserver-страховка целостности капсул.
    // Чинит guard-узлы и contenteditable, если их убрало что-то вне наших слоёв
    // (IME, браузерное расширение, script, paste не через наш обработчик).
    // -------------------------------------------------------------------------

    /**
     * Устанавливает MutationObserver на editable-редактор. Идемпотентен:
     * при повторном вызове на тот же элемент сначала отключает старый observer.
     * Вызывается только из editable-ветки createEditor.
     * @param {HTMLElement} editor
     */
    installCapsuleObserver(editor) {
        if (editor.__capsuleObserver) editor.__capsuleObserver.disconnect();
        const observer = new MutationObserver((records) => this._onCapsuleMutations(records, editor));
        observer.observe(editor, {
            childList: true,
            subtree: true,
            characterData: true,
            characterDataOldValue: true,
            attributes: true,
            attributeFilter: ['contenteditable'],
        });
        editor.__capsuleObserver = observer;
    },

    /**
     * @private Обработчик батча мутаций. Использует узкий триггер: реагирует
     * только на реальные нарушения инвариантов (guard удалён, contenteditable
     * сброшен, текст напечатан в guard), а НЕ на каждую структурную мутацию.
     * Широкий запуск normalizeMarkers на каждый childList нарушал бы
     * каретку при обычном вводе (normalizeMarkers пересоздаёт guard-узлы).
     *
     * Re-entrancy: флаг _healing (ранний return) + takeRecords() (сбрасываем
     * очередь записей, порождённых нашими собственными правками) — паттерн CKEditor.
     * @param {MutationRecord[]} records
     * @param {HTMLElement} editor
     */
    _onCapsuleMutations(records, editor) {
        if (editor.__healing) return;
        const guardChar = this.CAP_GUARD_CHAR;
        let needGuardRestore = false;
        const capsulesToFix = [];
        let guardNodeToRestore = null;

        for (const rec of records) {
            if (rec.type === 'characterData') {
                // Текст напечатан в guard-узел (oldValue — чистый U+FEFF, стал длиннее).
                const node = rec.target;
                if (node.nodeType === 3 && rec.oldValue === guardChar && node.data !== guardChar) {
                    guardNodeToRestore = node;
                }
            } else if (rec.type === 'childList') {
                // Guard-узел удалён (имитация «пользователь стёр невидимый символ»).
                rec.removedNodes.forEach(n => {
                    if (n.nodeType === 3 && n.data === guardChar) needGuardRestore = true;
                });
            } else if (rec.type === 'attributes') {
                // contenteditable сброшен с капсулы → чиним. НО пропускаем
                // капсулу в режиме inline-правки (#1): enableInlineEditing по
                // двойному клику НАМЕРЕННО ставит contenteditable='true' + класс
                // 'editing-mode'; откат на 'false' убил бы правку текста
                // ссылки/сноски (focus попадал бы в уже не редактируемый span).
                if (this._isCapsule(rec.target) &&
                        !rec.target.classList.contains('editing-mode') &&
                        rec.target.getAttribute('contenteditable') !== 'false') {
                    capsulesToFix.push(rec.target);
                }
            }
        }

        if (!guardNodeToRestore && !needGuardRestore && !capsulesToFix.length) return;

        editor.__healing = true;
        try {
            // Текст в guard → вынести наружу, guard вернуть в U+FEFF.
            if (guardNodeToRestore && guardNodeToRestore.parentNode) {
                this._restoreGuard(guardNodeToRestore, editor);
            } else if (guardNodeToRestore) {
                // Guard опустошён И удалён в одном батче (реальный Backspace по
                // zero-width узлу: characterData U+FEFF→'' затем childList-remove
                // уже пустого узла; removedNode.data==='' — childList-ветка его не
                // распознаёт, а здесь узел уже отвязан). Точечно чинить нечего —
                // восстанавливаем расстановкой guard'ов. Без этого вертикальная
                // навигация ломается до перезахода на вкладку.
                needGuardRestore = true;
            }
            // Хирургически вернуть contenteditable на капсулы.
            capsulesToFix.forEach(cap => {
                if (this._isCapsule(cap)) cap.setAttribute('contenteditable', 'false');
            });
            // Восстановить guard'ы через нормализацию.
            if (needGuardRestore) {
                this.normalizeMarkers(editor);
            }
        } finally {
            // Сбрасываем очередь мутаций, порождённых нашими правками, чтобы
            // не вызвать повторный обход после снятия __healing.
            if (editor.__capsuleObserver) editor.__capsuleObserver.takeRecords();
            editor.__healing = false;
        }
    },

    /**
     * @private Текст напечатан в guard-узел → выносим символы наружу (после
     * guard), возвращаем guard к чистому U+FEFF, ставим каретку за вынесенным
     * текстом. Вызывается только внутри _onCapsuleMutations (_healing уже взведён).
     * @param {Text} node — guard-текстовый-узел с «загрязнённым» содержимым
     * @param {HTMLElement} editor
     */
    _restoreGuard(node, editor) {
        const guardChar = this.CAP_GUARD_CHAR;
        const typed = node.data.split(guardChar).join('');
        node.data = guardChar;
        if (typed) {
            const textNode = document.createTextNode(typed);
            node.parentNode.insertBefore(textNode, node.nextSibling);
            const sel = window.getSelection();
            if (sel) {
                const range = document.createRange();
                range.setStart(textNode, textNode.length);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }
        // Единый сток: вынесенный из guard текст — реальная правка content
        // (changelog, TB-5). finalizeEdit зовётся под взведённым __healing;
        // повторный проход observer'а гасится ранним return + takeRecords.
        this.finalizeEdit(editor);
    },

    /** @private StaticRange → живой Range, расширенный за целые капсулы и их guard'ы. */
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
        if (sm) {
            // Если перед капсулой стоит guard-узел — включаем и его.
            const guardBefore = sm.previousSibling;
            if (this._isGuardNode(guardBefore)) range.setStartBefore(guardBefore);
            else range.setStartBefore(sm);
        }
        const em = ancestor(range.endContainer);
        if (em) {
            // Если после капсулы стоит guard-узел — включаем и его.
            const guardAfter = em.nextSibling;
            if (this._isGuardNode(guardAfter)) range.setEndAfter(guardAfter);
            else range.setEndAfter(em);
        }
        return range;
    },
});
