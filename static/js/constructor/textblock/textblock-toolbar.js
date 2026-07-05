/**
 * Расширение для работы с панелью инструментов
 */
import { TextBlockManager } from './textblock-core.js';
import { getStructureLimits } from '../violation/violation-image-validator.js';

Object.assign(TextBlockManager.prototype, {
    /**
     * Инициализирует глобальную панель инструментов
     */
    initGlobalToolbar() {
        if (document.getElementById('globalTextBlockToolbar')) return;

        const toolbar = document.createElement('div');
        toolbar.id = 'globalTextBlockToolbar';
        toolbar.className = 'textblock-toolbar-global hidden';

        toolbar.innerHTML = `
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="bold" title="Жирный (Ctrl+Shift+B)">
                    <strong>Ж</strong>
                </button>
                <button class="toolbar-btn" data-command="italic" title="Курсив (Ctrl+Shift+I)">
                    <em>К</em>
                </button>
                <button class="toolbar-btn" data-command="underline" title="Подчёркнутый (Ctrl+Shift+U)">
                    <u>П</u>
                </button>
                <button class="toolbar-btn" data-command="strikeThrough" title="Зачёркнутый (Ctrl+Shift+X)">
                    <s>З</s>
                </button>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <div class="toolbar-fontsize" id="fontSizePicker">
                    <button type="button" class="toolbar-btn toolbar-fontsize-trigger" id="fontSizeTrigger"
                            title="Размер шрифта (Ctrl+Shift+> / <)" aria-haspopup="listbox" aria-expanded="false">
                        <span class="toolbar-fontsize-value">14</span>
                        <span class="toolbar-fontsize-caret" aria-hidden="true">▾</span>
                    </button>
                    <div class="toolbar-fontsize-menu hidden" id="fontSizeMenu" role="listbox" aria-label="Размер шрифта">
                        ${this.fontSizes.map(size =>
            `<div class="toolbar-fontsize-option" role="option" data-size="${size}" tabindex="-1">${size}px</div>`
        ).join('')}
                    </div>
                </div>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="justifyLeft" title="По левому краю (Ctrl+Shift+A — цикл)">
                    ◧
                </button>
                <button class="toolbar-btn" data-command="justifyCenter" title="По центру (Ctrl+Shift+A — цикл)">
                    ▥
                </button>
                <button class="toolbar-btn" data-command="justifyRight" title="По правому краю (Ctrl+Shift+A — цикл)">
                    ◨
                </button>
                <button class="toolbar-btn" data-command="justifyFull" title="По ширине (Ctrl+Shift+A — цикл)">
                    ▦
                </button>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="createLink" title="Добавить гиперссылку (Ctrl+Shift+K)">
                    🔗
                </button>
                <button class="toolbar-btn" data-command="createFootnote" title="Добавить сноску (Ctrl+Shift+F)">
                    📑
                </button>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="removeFormat" title="Очистить форматирование">
                    ✕
                </button>
            </div>
        `;

        document.body.appendChild(toolbar);
        this.globalToolbar = toolbar;
        this.attachToolbarEvents();
    },

    /**
     * Привязывает обработчики событий к тулбару
     */
    attachToolbarEvents() {
        if (!this.globalToolbar) return;

        // Обработчики для кнопок форматирования
        this.globalToolbar.querySelectorAll('.toolbar-btn[data-command]').forEach(btn => {
            // B-40: кнопка тулбара не должна воровать фокус у редактора.
            // preventDefault на mousedown/pointerdown сохраняет caret/selection
            // в contenteditable — click отрабатывает на ещё активном редакторе,
            // blur не стреляет. На <select> размера НЕ вешаем (нужен нативный фокус).
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('pointerdown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const command = btn.dataset.command;

                // Специальная обработка для ссылок и сносок
                if (command === 'createLink') {
                    this.createOrEditLink();
                } else if (command === 'createFootnote') {
                    this.createOrEditFootnote();
                } else {
                    this.execCommand(command);
                }

                // Возвращаем фокус в редактор
                if (this.activeEditor) {
                    this.activeEditor.focus();
                    // Применяем форматирование к элементам
                    this.applyFormattingToNewNodes(this.activeEditor);
                }

                this.updateToolbarState();
            });
        });

        // BUG-3: кастомный дропдаун размера шрифта вместо нативного <select>.
        // Нативный <select> крал фокус у contenteditable и схлопывал выделение
        // (preventDefault на его mousedown нельзя — дропдаун не откроется), из-за
        // чего applyFontSize уходил в ветку каретки и ресайз выделения «не работал».
        // Триггер и пункты — на mousedown/pointerdown→preventDefault, как кнопки
        // тулбара: редактор НЕ теряет фокус/выделение, applyFontSize работает по
        // живому Range без save/restore-хаков.
        const fontSizePicker = this.globalToolbar.querySelector('#fontSizePicker');
        const fontSizeTrigger = this.globalToolbar.querySelector('#fontSizeTrigger');
        const fontSizeMenu = this.globalToolbar.querySelector('#fontSizeMenu');
        if (fontSizePicker && fontSizeTrigger && fontSizeMenu) {
            fontSizeTrigger.addEventListener('mousedown', (e) => e.preventDefault());
            fontSizeTrigger.addEventListener('pointerdown', (e) => e.preventDefault());
            fontSizeTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._toggleFontSizeMenu();
            });

            fontSizeMenu.querySelectorAll('.toolbar-fontsize-option').forEach(opt => {
                opt.addEventListener('mousedown', (e) => e.preventDefault());
                opt.addEventListener('pointerdown', (e) => e.preventDefault());
                opt.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._closeFontSizeMenu();
                    this.applyFontSize(parseInt(opt.dataset.size));
                });
            });

            // Закрытие меню по клику вне пикера и по Escape. Документ-уровневые
            // слушатели навешиваются один раз (тулбар создаётся единожды).
            document.addEventListener('mousedown', (e) => {
                if (fontSizePicker && !fontSizePicker.contains(e.target)) {
                    this._closeFontSizeMenu();
                }
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') this._closeFontSizeMenu();
            });
        }
    },

    /**
     * BUG-3: переключает видимость меню размера шрифта.
     * @private
     */
    _toggleFontSizeMenu() {
        const menu = this.globalToolbar?.querySelector('#fontSizeMenu');
        if (!menu) return;
        if (menu.classList.contains('hidden')) this._openFontSizeMenu();
        else this._closeFontSizeMenu();
    },

    /**
     * BUG-3: открывает меню и подсвечивает текущий размер.
     * @private
     */
    _openFontSizeMenu() {
        const menu = this.globalToolbar?.querySelector('#fontSizeMenu');
        const trigger = this.globalToolbar?.querySelector('#fontSizeTrigger');
        if (!menu) return;
        menu.classList.remove('hidden');
        trigger?.setAttribute('aria-expanded', 'true');
        this.updateFontSizeSelect();
    },

    /**
     * BUG-3: закрывает меню размера шрифта.
     * @private
     */
    _closeFontSizeMenu() {
        const menu = this.globalToolbar?.querySelector('#fontSizeMenu');
        const trigger = this.globalToolbar?.querySelector('#fontSizeTrigger');
        if (!menu) return;
        menu.classList.add('hidden');
        trigger?.setAttribute('aria-expanded', 'false');
    },

    /**
     * Применяет размер шрифта к выделенному тексту, элементам или всему блоку
     */
    applyFontSize(fontSize) {
        if (!this.activeEditor) return;

        // Кламп по границам шрифта из настроек (ACTS__TEXTBLOCKS__* через
        // /limits): схема отвергнет размер вне диапазона — не даём UI выйти
        // за него даже если в списке остались крайние значения.
        const { fontSizeMin, fontSizeMax } = getStructureLimits();
        fontSize = Math.max(fontSizeMin, Math.min(fontSizeMax, fontSize));

        this.activeEditor.focus();
        const selection = window.getSelection();

        // Если есть выделение
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);

            // BUG-2: расширяем границы наружу contentEditable=false маркеров.
            // extractContents() с границей ВНУТРИ маркера клонирует его (визуальный
            // дубль ссылки в начале строки) — двигаем границы по целым маркерам,
            // тогда маркер уходит во фрагмент целиком, без клона.
            this._expandRangeOutOfMarkers(range);

            // B-24: без execCommand/font[size=7]. Оборачиваем выделение в
            // span[style=font-size]; extractContents сохраняет вложенную разметку
            // (b/i/u, ссылки, сноски) — узлы перемещаются целиком, обработчики
            // ссылок/сносок на них выживают.
            const span = document.createElement('span');
            span.style.fontSize = `${fontSize}px`;
            span.appendChild(range.extractContents());

            // Снимаем font-size у вложенных span (кроме ссылок/сносок) — внешний
            // размер выигрывает.
            span.querySelectorAll('[style]').forEach(child => {
                if (child.style.fontSize &&
                    !child.classList?.contains('text-link') &&
                    !child.classList?.contains('text-footnote')) {
                    child.style.fontSize = '';
                    if (!child.getAttribute('style')?.trim()) {
                        child.removeAttribute('style');
                    }
                }
            });

            // BUG-1: размер ставим ВСЕМ маркерам, реально попавшим во фрагмент —
            // безусловно. Маркеры contentEditable=false, внешний span их не
            // накрывает (нужен собственный inline font-size). Прежняя завязка на
            // range.intersectsNode «промахивалась» по границам маркера на 2-й+
            // смене → маркер застывал на первом применённом размере.
            span.querySelectorAll('.text-link, .text-footnote').forEach(el => {
                el.style.fontSize = `${fontSize}px`;
            });

            range.insertNode(span);

            // Восстанавливаем выделение на новый span.
            const newRange = document.createRange();
            newRange.selectNodeContents(span);
            selection.removeAllRanges();
            selection.addRange(newRange);
        } else if (selection && selection.rangeCount > 0) {
            // B-2 (флагман data-loss): материализуем размер на каретке в content,
            // а НЕ в editor.style — стиль контейнера в innerHTML не попадает и
            // теряется при reload/preview/export. Вставляем span с ZWSP-якорем и
            // ставим каретку внутрь — будущий ввод унаследует размер.
            const range = selection.getRangeAt(0);
            const span = document.createElement('span');
            span.style.fontSize = `${fontSize}px`;
            span.appendChild(document.createTextNode('​'));
            range.insertNode(span);
            const caret = document.createRange();
            caret.setStart(span.firstChild, 1); // после ZWSP
            caret.collapse(true);
            selection.removeAllRanges();
            selection.addRange(caret);
        }

        // Единый сток: форматирование могло завернуть caret-guard в font-span —
        // finalizeEdit → normalizeMarkers чистит и пере-расставляет их (только при
        // наличии капсул; U+200B-якорь размера при этом не затрагивается).
        this.finalizeEdit(this.activeEditor);
        // B-4: при прямом программном вызове (stepFontSize/hotkey) тулбар иначе
        // остаётся с устаревшим значением размера.
        this.updateToolbarState();
    },

    /**
     * Переключает размер шрифта на следующий/предыдущий из списка fontSizes
     * @param {number} direction - 1 для увеличения, -1 для уменьшения
     */
    stepFontSize(direction) {
        if (!this.activeEditor) return;

        const selection = window.getSelection();
        let fontSize = 14;

        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            // Для выделения — определяем размер из текстовых узлов
            const sizes = this._getSelectedFontSizes(selection);
            if (sizes.size > 0) {
                fontSize = [...sizes][0];
            }
        } else if (selection && selection.rangeCount > 0) {
            // B-9: размер под кареткой с учётом соседних span'ов.
            fontSize = this._resolveCaretFontSize(selection.getRangeAt(0));
        } else {
            fontSize = parseInt(window.getComputedStyle(this.activeEditor).fontSize);
        }

        const closestIdx = this.fontSizes.reduce((bestIdx, _, idx, arr) =>
            Math.abs(arr[idx] - fontSize) < Math.abs(arr[bestIdx] - fontSize) ? idx : bestIdx, 0
        );

        const nextIdx = Math.max(0, Math.min(this.fontSizes.length - 1, closestIdx + direction));
        this.applyFontSize(this.fontSizes[nextIdx]);
        this.updateFontSizeSelect();
    },

    /**
     * Циклически переключает выравнивание текста
     * left → center → right → justify → left
     */
    cycleAlignment() {
        if (!this.activeEditor) return;

        const alignments = ['justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'];
        let currentIdx = alignments.findIndex(cmd => this.queryCommandState(cmd));
        if (currentIdx === -1) currentIdx = 0;

        const nextIdx = (currentIdx + 1) % alignments.length;
        this.execCommand(alignments[nextIdx]);
    },

    /**
     * Обновляет состояние кнопок тулбара
     */
    updateToolbarState() {
        if (!this.globalToolbar || !this.activeEditor) return;

        // Обновляем состояние кнопок форматирования
        this.globalToolbar.querySelectorAll('.toolbar-btn[data-command]').forEach(btn => {
            const command = btn.dataset.command;

            if (command === 'createLink' || command === 'createFootnote' || command === 'removeFormat') {
                return; // Эти кнопки не имеют активного состояния
            }

            try {
                // B-6: через защитную обёртку core.js, не напрямую document.
                const isActive = this.queryCommandState(command);
                btn.classList.toggle('active', isActive);
            } catch (e) {
                btn.classList.remove('active');
            }
        });

        // Обновляем размер шрифта
        this.updateFontSizeSelect();
    },

    /**
     * Обновляет выбранный размер шрифта в select
     */
    updateFontSizeSelect() {
        const trigger = this.globalToolbar?.querySelector('#fontSizeTrigger');
        const valueEl = trigger?.querySelector('.toolbar-fontsize-value');
        const menu = this.globalToolbar?.querySelector('#fontSizeMenu');
        if (!valueEl) return;

        const selection = window.getSelection();
        let display = null;     // текст в триггере ('—' для смешанных размеров)
        let activeSize = null;  // размер из палитры для подсветки пункта

        // Если есть выделение — проверяем смешанные размеры
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            const sizes = this._getSelectedFontSizes(selection);
            if (sizes.size > 1) {
                display = '—'; // Смешанные размеры — прочерк, ни один пункт не активен
            } else if (sizes.size === 1) {
                const fontSize = [...sizes][0];
                activeSize = this.fontSizes.reduce((prev, curr) =>
                    Math.abs(curr - fontSize) < Math.abs(prev - fontSize) ? curr : prev
                );
                display = String(activeSize);
            }
        }

        // Курсор без выделения — размер под кареткой с учётом соседних span (B-9).
        if (display === null) {
            let fontSize = 14;
            if (selection && selection.rangeCount > 0) {
                fontSize = this._resolveCaretFontSize(selection.getRangeAt(0));
            } else if (this.activeEditor) {
                fontSize = parseInt(window.getComputedStyle(this.activeEditor).fontSize);
            }
            activeSize = this.fontSizes.reduce((prev, curr) =>
                Math.abs(curr - fontSize) < Math.abs(prev - fontSize) ? curr : prev
            );
            display = String(activeSize);
        }

        valueEl.textContent = display;
        menu?.querySelectorAll('.toolbar-fontsize-option').forEach(opt => {
            const on = activeSize !== null && parseInt(opt.dataset.size) === activeSize;
            opt.classList.toggle('active', on);
            opt.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    },

    /**
     * Собирает уникальные размеры шрифта из выделенного текста
     * @private
     */
    _getSelectedFontSizes(selection) {
        const sizes = new Set();
        const range = selection.getRangeAt(0);
        const ancestor = range.commonAncestorContainer;
        const root = ancestor.nodeType === 3 ? ancestor.parentElement : ancestor;

        if (!root || !this.activeEditor?.contains(root)) return sizes;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                return range.intersectsNode(node)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        });

        let node;
        while (node = walker.nextNode()) {
            const el = node.parentElement;
            if (el) {
                sizes.add(parseInt(window.getComputedStyle(el).fontSize));
            }
        }

        return sizes;
    },

    /**
     * Размер шрифта под кареткой с учётом соседних span'ов (B-9). На стыке
     * <span 12px>|<span 18px> getComputedStyle родителя даёт ~14px — берём
     * явный размер соседа по стороне каретки.
     * @private
     */
    _resolveCaretFontSize(range) {
        const container = range.startContainer;
        const offset = range.startOffset;
        let probe = null;
        if (container.nodeType === 3) {
            if (offset === 0) probe = container.previousSibling || container.parentElement;
            else if (offset === container.textContent.length) probe = container.nextSibling || container.parentElement;
            else probe = container.parentElement;
        } else {
            probe = container.childNodes[offset] || container.childNodes[offset - 1] || container;
        }
        let el = probe?.nodeType === 3 ? probe.parentElement : probe;
        while (el && this.activeEditor?.contains(el)) {
            if (el.style?.fontSize) return parseInt(el.style.fontSize);
            el = el.parentElement;
        }
        const fb = probe?.nodeType === 3 ? probe.parentElement : probe;
        return fb && this.activeEditor?.contains(fb)
            ? parseInt(window.getComputedStyle(fb).fontSize) : 14;
    },

    /**
     * BUG-2: расширяет границы Range наружу contentEditable=false маркеров
     * (.text-link/.text-footnote). Если граница лежит ВНУТРИ текста маркера,
     * range.extractContents() клонирует частично выделенный маркер (дубль ссылки
     * в начале строки). Сдвигаем start перед маркером, end — после, чтобы маркер
     * переместился во фрагмент целиком.
     * @private
     */
    _expandRangeOutOfMarkers(range) {
        const markerAncestor = (node) => {
            let el = node?.nodeType === 3 ? node.parentElement : node;
            while (el && el !== this.activeEditor && this.activeEditor?.contains(el)) {
                // Капсула в inline-правке (editing-mode) — обычный редактируемый
                // контент, за её границы диапазон НЕ расширяем (CARET-1).
                if ((el.classList?.contains('text-link') || el.classList?.contains('text-footnote')) &&
                        !this._isEditingCapsule(el)) {
                    return el;
                }
                el = el.parentElement;
            }
            return null;
        };
        const startMarker = markerAncestor(range.startContainer);
        if (startMarker) range.setStartBefore(startMarker);
        const endMarker = markerAncestor(range.endContainer);
        if (endMarker) range.setEndAfter(endMarker);
    }
});

/**
 * 6.4: нормализует нестандартные размеры шрифта в content текстблоков к
 * ближайшему из палитры (унифицированный акт). Одноразовый идемпотентный проход
 * при загрузке: правит content (span[style]); при изменении возвращает
 * changed=true → вызывающий помечает акт как несохранённый.
 * @param {Object<string,{content:string}>} textBlocks
 * @param {number[]} palette - доступные размеры (textBlockManager.fontSizes)
 * @returns {{changed: boolean, count: number}}
 */
export function normalizeFontSizes(textBlocks, palette) {
    if (!textBlocks || typeof textBlocks !== 'object'
        || !Array.isArray(palette) || !palette.length) {
        return { changed: false, count: 0 };
    }
    const snap = (px) => palette.reduce((best, cur) =>
        Math.abs(cur - px) < Math.abs(best - px) ? cur : best);
    let changed = false;
    let count = 0;
    // #3: инертный <template> — тело парсится без загрузки ресурсов, поэтому
    // сохранённый ранее <img onerror> из content НЕ исполняется (stored-XSS в
    // обход DOMPurify). Живой div.innerHTML запустил бы onerror сразу.
    const tmp = document.createElement('template');
    for (const tb of Object.values(textBlocks)) {
        if (!tb || typeof tb.content !== 'string' || !tb.content) continue;
        tmp.innerHTML = tb.content;
        let blockChanged = false;
        tmp.content.querySelectorAll('[style*="font-size"]').forEach(el => {
            const raw = el.style.fontSize;
            const px = parseFloat(raw);
            // Нормализуем только px; em/%/pt оставляем как есть.
            if (!raw.endsWith('px') || Number.isNaN(px)) return;
            const snapped = snap(px);
            if (snapped !== px) {
                el.style.fontSize = `${snapped}px`;
                blockChanged = true;
                count++;
            }
        });
        if (blockChanged) {
            tb.content = tmp.innerHTML;
            changed = true;
        }
    }
    return { changed, count };
}

window.normalizeFontSizes = normalizeFontSizes;
