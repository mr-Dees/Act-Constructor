/**
 * Движок поиска/замены по текстовым блокам акта (B1). Только логика поиска,
 * сбора «пробегов» текста и безопасной замены — БЕЗ UI (find-bar приходит в B2 и
 * потребляет этот экспортируемый API).
 *
 * Флагманская гарантия безопасности: текст КАПСУЛ (span.text-link /
 * span.text-footnote, contenteditable="false") НИКОГДА не попадает в пробеги
 * (runs) → совпадение математически не может зайти внутрь капсулы или пересечь
 * её. Капсула, <br> и любая капсула-элемент разрывают пробег; caret-guard'ы
 * (U+FEFF) и якоря размера (U+200B) исключаются как zero-width.
 *
 * Предикаты капсул/zero-width переиспользуются из textBlockManager
 * (textblock-editor.js навешивает их на прототип; импортируем его как
 * side-effect, чтобы _isCapsule/_isZeroWidthNode гарантированно существовали вне
 * зависимости от порядка загрузки).
 *
 * Персистентность: замена (replaceRange) МУТИРУЕТ текстовые узлы живого DOM;
 * ЕДИНСТВЕННЫЙ санкционированный путь фиксации после серии замен —
 * textBlockManager.finalizeEdit(editor) (он же TextBlockSearchTarget.persist()).
 * Сам движок finalizeEdit НЕ зовёт — это ответственность вызывающего (B2).
 *
 * TreeWalker(SHOW_TEXT) сознательно НЕ используется в collectRuns: разрыв
 * пробега требует НАБЛЮДАТЬ граничные элементы (капсулу/<br>), которых
 * text-only-обходчик не видит; ручной DFS даёт точную семантику разрывов и
 * тестируется на фейковом дереве узлов без реального DOM.
 */
import { textBlockManager } from '../textblock/textblock-core.js';
import '../textblock/textblock-editor.js'; // side-effect: _isCapsule/_isZeroWidthNode на прототипе

/** Класс «словесного» символа для whole-word границ. JS `\b` — ASCII-only и
 *  НЕВЕРЕН для кириллицы ('акт' ложно матчился бы внутри 'характеристика').
 *  Берём Unicode-буквы/цифры/подчёркивание (требует флаг `u`). */
const WORD_CHAR = '[\\p{L}\\p{N}_]';

/**
 * SearchTarget — абстракция «искомой поверхности». Позволяет позже добавить
 * ячейки таблиц, не трогая движок. Контракт (duck-typing):
 *   {
 *     id: string,                         // стабильный идентификатор цели
 *     getElement(): HTMLElement,          // корневой редактируемый элемент
 *     collectRuns(): Run[],               // пробеги текста (см. collectRuns)
 *     replaceRange(range: Range, text): void, // безопасная замена
 *     persist(): void                     // зафиксировать правку (finalizeEdit)
 *   }
 * v1: реализована только TextBlockSearchTarget (текстблоки). Ячейки таблиц —
 * будущая цель.
 *
 * Run (пробег): { text: string, segments: Array<{node: Text, start, end}> }
 *   text     — склеенный текст пробега;
 *   segments — карта [start,end) глобального смещения В ПРОБЕГЕ обратно на
 *              (текстовый узел, локальное смещение). start сегмента ↔ смещение 0
 *              в его узле, end ↔ длина узла. Пробег может охватывать несколько
 *              текстовых узлов (сквозь inline-форматирование b/i/u/span).
 */

/** Реализация SearchTarget над .textblock-editor. */
export class TextBlockSearchTarget {
    /** @param {HTMLElement} editor Элемент .textblock-editor[data-text-block-id]. */
    constructor(editor) {
        this._editor = editor;
        this.id = (editor && editor.dataset) ? editor.dataset.textBlockId : null;
    }

    /** @returns {HTMLElement} */
    getElement() {
        return this._editor;
    }

    /** @returns {Array} Пробеги текста редактора. */
    collectRuns() {
        return ActSearchEngine.collectRuns(this._editor);
    }

    /**
     * Безопасная замена диапазона (делегат движка). Капсулы не трогает.
     * @param {Range} range
     * @param {string} text
     */
    replaceRange(range, text) {
        return ActSearchEngine.replaceRange(range, text);
    }

    /**
     * Фиксирует правку: единственный санкционированный сток текстблока
     * (нормализация капсул + перенумерация сносок + запись в state + превью).
     */
    persist() {
        textBlockManager.finalizeEdit(this._editor);
    }
}

export const ActSearchEngine = {
    /**
     * Жёсткий лимит совпадений: при превышении поиск останавливается и помечает
     * результат capped=true (защита от зависания на «e» в огромном акте).
     */
    MAX_MATCHES: 5000,

    /**
     * Собирает цели поиска в порядке документа (v1 — только текстблоки).
     * Ячейки таблиц — будущая цель через ту же SearchTarget-абстракцию.
     * @returns {TextBlockSearchTarget[]}
     */
    buildTargets() {
        const container = (typeof document !== 'undefined' && document.getElementById)
            ? (document.getElementById('itemsContainer') || document)
            : document;
        const editors = container.querySelectorAll('.textblock-editor[data-text-block-id]');
        const targets = [];
        editors.forEach((ed) => targets.push(new TextBlockSearchTarget(ed)));
        return targets;
    },

    /**
     * Собирает пробеги текста редактора ручным DFS. Правила:
     *  - текстовый узел с предком-капсулой — исключён (сюда DFS не спускается);
     *  - чистый zero-width узел (caret-guard U+FEFF / якорь размера U+200B /
     *    пустой) — пропускается, НЕ разрывая пробег;
     *  - капсула (.text-link/.text-footnote) — АТОМ: её текст не входит ни в один
     *    пробег, граница разрывает пробег;
     *  - <br> и <img> — АТОМЫ/void: разрывают пробег. <img> тоже, иначе
     *    совпадение, «перепрыгнувшее» картинку, при replaceRange удалило бы её
     *    (deleteContents) — картинки в текстблоках значимы (_toggleEmptyClass);
     *  - прочий inline/блок (b/i/u/span-формат) — прозрачно обходится, его текст
     *    склеивается в текущий пробег.
     * @param {HTMLElement} editor
     * @returns {Array<{text:string, segments:Array<{node:Node,start:number,end:number}>}>}
     */
    collectRuns(editor) {
        const runs = [];
        let current = null;
        const tbm = textBlockManager;

        const flush = () => {
            if (current && current.text.length > 0) runs.push(current);
            current = null;
        };

        const visit = (node) => {
            for (let child = node.firstChild; child; child = child.nextSibling) {
                if (child.nodeType === Node.TEXT_NODE) {
                    // Чистый zero-width (guard/якорь/пустой) — не текст: пропускаем
                    // без разрыва пробега.
                    if (tbm._isZeroWidthNode(child)) continue;
                    const text = child.data != null ? child.data : (child.textContent || '');
                    if (!text) continue;
                    if (!current) current = { text: '', segments: [] };
                    const start = current.text.length;
                    current.segments.push({ node: child, start, end: start + text.length });
                    current.text += text;
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    if (tbm._isCapsule(child)) {
                        flush(); // капсула-атом: текст исключён, граница рвёт пробег
                    } else if (child.tagName === 'BR' || child.tagName === 'IMG') {
                        flush(); // void-атом: пробег не должен его пересекать
                    } else {
                        visit(child); // прозрачный inline/блок — текст склеивается
                    }
                }
            }
        };

        if (editor) visit(editor);
        flush();
        return runs;
    },

    /**
     * @private Экранирует спецсимволы regex в литеральном запросе. Набор
     * `[.*+?^${}()|[\]\\]` безопасен и под флагом `u`.
     * @param {string} s
     * @returns {string}
     */
    _escapeRegExp(s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    /**
     * @private Оборачивает источник паттерна в Unicode-границы слова.
     * @param {string} source
     * @returns {string}
     */
    _wholeWordWrap(source) {
        return `(?<!${WORD_CHAR})(?:${source})(?!${WORD_CHAR})`;
    },

    /**
     * @private Строит скомпилированный матчер. Компиляция regex обёрнута в
     * try/catch — невалидный паттерн возвращает СТРУКТУРНУЮ ошибку, никогда не
     * бросает. Пустой запрос → {empty:true} (не ошибка, просто нет совпадений).
     * @param {string} query
     * @param {{caseSensitive?:boolean, wholeWord?:boolean, regex?:boolean}} [opts]
     * @returns {{regex:RegExp}|{error:string}|{empty:true, regex:null}}
     */
    _buildMatcher(query, opts = {}) {
        const { caseSensitive = false, wholeWord = false, regex = false } = opts;
        if (typeof query !== 'string' || query === '') {
            return { empty: true, regex: null };
        }
        let source = regex ? query : this._escapeRegExp(query);
        let unicode = false;
        if (wholeWord) {
            source = this._wholeWordWrap(source);
            unicode = true; // \p{L} требует флаг `u`
        }
        let flags = 'g';
        if (!caseSensitive) flags += 'i';
        if (unicode) flags += 'u';
        try {
            return { regex: new RegExp(source, flags) };
        } catch (e) {
            return { error: e && e.message ? e.message : String(e) };
        }
    },

    /**
     * @private Прогоняет ГОТОВЫЙ глобальный regex по строке. Обрабатывает
     * пустые совпадения (сдвиг lastIndex, чтобы не зациклиться) и жёсткий лимит.
     * Совпадения НЕ перекрываются (продвигаемся за конец каждого — семантика
     * indexOf). Сбрасывает lastIndex — безопасно переиспользовать regex по
     * нескольким пробегам.
     * @param {string} str
     * @param {RegExp} regex глобальный (флаг g)
     * @param {number} cap максимум совпадений
     * @returns {{matches:Array<{start:number,end:number}>, capped:boolean}}
     */
    _scanWithRegex(str, regex, cap) {
        const matches = [];
        let capped = false;
        regex.lastIndex = 0;
        let m;
        while ((m = regex.exec(str)) !== null) {
            if (m[0].length === 0) {
                // Пустое совпадение (напр. \d* без цифр, ^, \b) — двигаем курсор,
                // но НЕ добавляем: пустой матч бессмыслен для поиска и опасен для
                // замены (его Range охватил бы весь пробег → потеря текста).
                regex.lastIndex += 1;
                continue;
            }
            matches.push({ start: m.index, end: m.index + m[0].length });
            if (matches.length >= cap) { capped = true; break; }
        }
        return { matches, capped };
    },

    /**
     * ЧИСТАЯ функция (без DOM): все совпадения query в строке str.
     * @param {string} str
     * @param {string} query
     * @param {{caseSensitive?:boolean, wholeWord?:boolean, regex?:boolean, cap?:number}} [opts]
     * @returns {{matches:Array<{start:number,end:number}>, capped:boolean, error?:string}}
     */
    _matchesInString(str, query, opts = {}) {
        const built = this._buildMatcher(query, opts);
        if (built.error) return { matches: [], capped: false, error: built.error };
        if (!built.regex) return { matches: [], capped: false }; // пустой запрос
        const cap = opts.cap != null ? opts.cap : this.MAX_MATCHES;
        return this._scanWithRegex(str, built.regex, cap);
    },

    /**
     * ЧИСТАЯ функция (без DOM): совпадения по массиву пробегов. Компилирует
     * матчер один раз; лимит — суммарный по всем пробегам.
     * @param {Array<{text:string}>} runs
     * @param {string} query
     * @param {object} [opts] см. _matchesInString
     * @returns {{matches:Array<{runIndex:number,start:number,end:number}>, capped:boolean, error?:string}}
     */
    findInRuns(runs, query, opts = {}) {
        const built = this._buildMatcher(query, opts);
        if (built.error) return { matches: [], capped: false, error: built.error };
        if (!built.regex) return { matches: [], capped: false };
        const cap = opts.cap != null ? opts.cap : this.MAX_MATCHES;
        const out = [];
        let capped = false;
        for (let ri = 0; ri < runs.length; ri++) {
            const remaining = cap - out.length;
            if (remaining <= 0) { capped = true; break; }
            const scan = this._scanWithRegex(runs[ri].text, built.regex, remaining);
            for (const mt of scan.matches) {
                out.push({ runIndex: ri, start: mt.start, end: mt.end });
            }
            if (scan.capped) { capped = true; break; }
        }
        return { matches: out, capped };
    },

    /**
     * @private Локализует смещение В ПРОБЕГЕ на (текстовый узел, локальное
     * смещение). isEnd=true — предпочитает КОНЕЦ узла на стыке сегментов, чтобы
     * совпадение внутри одного узла давало start и end в ОДНОМ узле (быстрый путь
     * replaceRange). Возвращает null для пустого пробега.
     * @param {{segments:Array}} run
     * @param {number} offset
     * @param {boolean} isEnd
     * @returns {{node:Node, offset:number}|null}
     */
    _locate(run, offset, isEnd) {
        // offset<=0 — начало пробега (для start и для end одинаково: позиция 0).
        // Без этого ветка isEnd (offset > seg.start) провалилась бы в fallthrough
        // и вернула КОНЕЦ последнего сегмента (Range охватил бы весь пробег).
        if (offset <= 0) {
            const first = run.segments[0];
            return first ? { node: first.node, offset: 0 } : null;
        }
        for (const seg of run.segments) {
            if (isEnd) {
                if (offset > seg.start && offset <= seg.end) {
                    return { node: seg.node, offset: offset - seg.start };
                }
            } else if (offset >= seg.start && offset < seg.end) {
                return { node: seg.node, offset: offset - seg.start };
            }
        }
        const last = run.segments[run.segments.length - 1];
        if (!last) return null;
        return { node: last.node, offset: last.end - last.start }; // граница/конец пробега
    },

    /**
     * @private Строит DOM-Range из смещений [start,end) пробега. Требует реального
     * document.createRange (живой DOM) — в node-тестах не вызывается.
     * @param {object} run
     * @param {number} start
     * @param {number} end
     * @returns {Range}
     */
    _rangeFromRun(run, start, end) {
        const s = this._locate(run, start, false);
        const e = this._locate(run, end, true);
        const range = document.createRange();
        range.setStart(s.node, s.offset);
        range.setEnd(e.node, e.offset);
        return range;
    },

    /**
     * Ищет совпадения в одной цели, возвращая DOM-Range на каждое (требует живой
     * DOM). Порядок — как в пробегах (порядок документа).
     * @param {object} target SearchTarget
     * @param {string} query
     * @param {object} [opts]
     * @returns {{matches:Array<{range:Range,runIndex:number,start:number,end:number}>, capped:boolean, error?:string}}
     */
    findInTarget(target, query, opts = {}) {
        const runs = target.collectRuns();
        const res = this.findInRuns(runs, query, opts);
        if (res.error) return { matches: [], capped: false, error: res.error };
        const matches = res.matches.map((m) => ({
            range: this._rangeFromRun(runs[m.runIndex], m.start, m.end),
            runIndex: m.runIndex,
            start: m.start,
            end: m.end,
        }));
        return { matches, capped: res.capped };
    },

    /**
     * Плоский упорядоченный список совпадений по ВСЕМ целям (порядок документа).
     * Невалидный regex — структурная ошибка {error}, без исключения. Лимит —
     * глобальный.
     * @param {string} query
     * @param {object} [opts]
     * @returns {{matches:Array<{targetId:string,range:Range,runIndex:number,start:number,end:number}>, capped:boolean, error?:string}}
     */
    buildAllMatches(query, opts = {}) {
        const built = this._buildMatcher(query, opts);
        if (built.error) return { matches: [], capped: false, error: built.error };
        if (!built.regex) return { matches: [], capped: false };
        const cap = this.MAX_MATCHES;
        const targets = this.buildTargets();
        const out = [];
        let capped = false;
        for (const target of targets) {
            if (out.length >= cap) { capped = true; break; }
            const runs = target.collectRuns();
            for (let ri = 0; ri < runs.length && out.length < cap; ri++) {
                const scan = this._scanWithRegex(runs[ri].text, built.regex, cap - out.length);
                for (const mt of scan.matches) {
                    out.push({
                        targetId: target.id,
                        range: this._rangeFromRun(runs[ri], mt.start, mt.end),
                        runIndex: ri,
                        start: mt.start,
                        end: mt.end,
                    });
                }
                if (scan.capped) { capped = true; break; }
            }
            if (capped) break;
        }
        return { matches: out, capped };
    },

    /**
     * @private Есть ли у узла (или он сам) предок-капсула? Защита от замены,
     * пересекающей капсулу.
     * @param {Node} node
     * @returns {boolean}
     */
    _hasCapsuleAncestor(node) {
        let n = node;
        while (n) {
            if (textBlockManager._isCapsule(n)) return true;
            n = n.parentNode;
        }
        return false;
    },

    /**
     * Безопасно заменяет текст диапазона. Defense-in-depth: если любая граница
     * диапазона лежит ВНУТРИ капсулы — бросает (движок никогда не производит
     * такие диапазоны, но публичный API может получить произвольный Range).
     * Один текстовый узел → сплайс nodeValue; иначе deleteContents + insertNode
     * текстового узла. Внутренности капсул не трогает. После серии замен
     * вызывающий обязан вызвать persist()/finalizeEdit.
     * @param {Range} range
     * @param {string} replacement
     */
    replaceRange(range, replacement) {
        if (this._hasCapsuleAncestor(range.startContainer)
            || this._hasCapsuleAncestor(range.endContainer)) {
            throw new Error('ActSearchEngine.replaceRange: диапазон пересекает капсулу — замена отклонена');
        }
        const sc = range.startContainer;
        if (sc === range.endContainer && sc.nodeType === Node.TEXT_NODE) {
            const s = range.startOffset;
            const e = range.endOffset;
            sc.nodeValue = sc.nodeValue.slice(0, s) + replacement + sc.nodeValue.slice(e);
            const caret = s + replacement.length;
            range.setStart(sc, caret);
            range.setEnd(sc, caret);
        } else {
            range.deleteContents();
            const tn = document.createTextNode(replacement);
            range.insertNode(tn);
            range.setStartAfter(tn);
            range.setEndAfter(tn);
        }
    },
};

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.ActSearchEngine = ActSearchEngine;
window.TextBlockSearchTarget = TextBlockSearchTarget;
