/**
 * Движок поиска/замены по текстовым блокам акта (B1). Только логика поиска,
 * сбора «пробегов» текста и безопасной замены — БЕЗ UI (find-bar приходит в B2 и
 * потребляет этот экспортируемый API).
 *
 * Флагманская гарантия безопасности: собственный видимый текст КАПСУЛ
 * (span.text-link / span.text-footnote, contenteditable="false") попадает в
 * ОТДЕЛЬНЫЙ пробег, помеченный capsuleText:true, — искать и подсвечивать его
 * можно, но он остаётся математически неприкасаемым для ЗАМЕНЫ: границу
 * замены держит не пометка пробега, а replaceRange._hasCapsuleAncestor,
 * отклоняющая любой Range с предком-капсулой — совпадение видит текст
 * капсулы, но реально заменить его (или зацепить окружающий текст через
 * границу капсулы) не может. Капсула, <br> и любой void-элемент разрывают
 * ОКРУЖАЮЩИЙ (не капсульный) пробег; caret-guard'ы (U+FEFF) и якоря размера
 * (U+200B) исключаются как zero-width — как снаружи, так и внутри капсулы.
 *
 * Предикаты капсул/zero-width — самостоятельные функции isCapsuleNode/
 * isZeroWidthNode из textblock-core.js (единый источник истины, туда же
 * делегируют прототипные _isCapsule/_isZeroWidthNode). Движок импортирует их
 * НАПРЯМУЮ — не завися от side-effect навешивания миксина textblock-editor.js на
 * прототип (тот UI-тяжёлый; порядок/факт его загрузки не должен решать
 * работоспособность «чистого, без UI» движка).
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
 *
 * Тело сноски (data-footnote-text) — ВТОРАЯ, принципиально невидимая в DOM
 * поверхность поиска: значение атрибута нигде не рендерится текстовым узлом,
 * поэтому у совпадений внутри него физически не может быть DOM Range.
 * FootnoteBodySearchTarget — второй SearchTarget (после TextBlockSearchTarget):
 * один экземпляр на span.text-footnote, collectRuns() отдаёт единственный run
 * { text: <значение атрибута>, segments: [], footnoteBody: true, footnoteEl }.
 * buildAllMatches/findInTarget не зовут _rangeFromRun для пробега без сегментов
 * (упал бы на createRange по несуществующему узлу) — такие матчи несут
 * range: null плюс footnoteBody/footnoteEl/смещения как метаданные. UI-слой
 * (find-bar.js) обязан отличать их: подсветка (CSS Custom Highlight) их молча
 * не включает (нет Range — уже гарантировано фильтром в act-search-highlight.js),
 * навигация/скролл — через сам элемент капсулы + форсированный tooltip
 * (textblock-links-footnotes.js::showFootnoteSearchTooltip), замена — сплайсом
 * строки атрибута data-footnote-text, а не через Range API.
 */
import { textBlockManager, isCapsuleNode, isZeroWidthNode } from '../textblock/textblock-core.js';

/** Класс «словесного» символа для whole-word границ. JS `\b` — ASCII-only и
 *  НЕВЕРЕН для кириллицы ('акт' ложно матчился бы внутри 'характеристика').
 *  Берём Unicode-буквы/цифры/подчёркивание (требует флаг `u`). */
const WORD_CHAR = '[\\p{L}\\p{N}_]';

/**
 * SearchTarget — абстракция «искомой поверхности». Позволяет позже добавить
 * ячейки таблиц, не трогая движок. Контракт (duck-typing):
 *   {
 *     id: string,                         // стабильный идентификатор цели
 *     collectRuns(): Run[],               // пробеги текста (см. collectRuns)
 *     persist(): void                     // зафиксировать правку (finalizeEdit)
 *   }
 * Замену выполняет статический ActSearchEngine.replaceRange(range, text) (см.
 * FindBar) — по Range, а не по цели, НО только для пробегов с реальными DOM-
 * сегментами; пробег тела сноски (footnoteBody, ниже) заменяется вызывающим
 * напрямую сплайсом атрибута — см. FootnoteBodySearchTarget. v1: реализованы
 * TextBlockSearchTarget (видимый текст блока) и FootnoteBodySearchTarget (тело
 * сноски). Ячейки таблиц — будущая цель.
 *
 * Run (пробег): { text: string, segments: Array<{node: Text, start, end}>, capsuleText?: true, footnoteBody?: true, footnoteEl?: HTMLElement }
 *   text         — склеенный текст пробега;
 *   segments     — карта [start,end) глобального смещения В ПРОБЕГЕ обратно на
 *                  (текстовый узел, локальное смещение). start сегмента ↔ смещение 0
 *                  в его узле, end ↔ длина узла. Пробег может охватывать несколько
 *                  текстовых узлов (сквозь inline-форматирование b/i/u/span);
 *   capsuleText  — true, если пробег собран из СОБСТВЕННОГО видимого текста
 *                  капсулы (см. collectRuns/_collectCapsuleTextRun); искать
 *                  можно, заменить нельзя (replaceRange отклоняет по
 *                  _hasCapsuleAncestor независимо от этой пометки). На
 *                  обычных пробегах поле отсутствует (falsy).
 *   footnoteBody — true для пробега ТЕЛА сноски (FootnoteBodySearchTarget).
 *                  segments ВСЕГДА [] — текст взят из атрибута
 *                  data-footnote-text, а не из видимого DOM, у него физически
 *                  нет текстового узла. На всех прочих пробегах поле
 *                  отсутствует.
 *   footnoteEl   — ссылка на сам span.text-footnote (только у footnoteBody-
 *                  пробега) — вызывающий (find-bar.js) использует её для
 *                  скролла/tooltip/замены атрибута напрямую, в обход Range API.
 */

/** Реализация SearchTarget над .textblock-editor. */
export class TextBlockSearchTarget {
    /** @param {HTMLElement} editor Элемент .textblock-editor[data-text-block-id]. */
    constructor(editor) {
        this._editor = editor;
        this.id = (editor && editor.dataset) ? editor.dataset.textBlockId : null;
        // Совпадает с id у ЭТОЙ цели, но выделено отдельным полем ради
        // симметрии с FootnoteBodySearchTarget: там id (цель) и blockId
        // (владеющий текстблок, нужен для custom-undo снимка content'а в
        // find-bar.js) — РАЗНЫЕ значения.
        this.blockId = this.id;
    }

    /** @returns {Array} Пробеги текста редактора (кэш движка, инвалидируется по мутациям). */
    collectRuns() {
        return ActSearchEngine._collectRunsCached(this._editor);
    }

    /**
     * Фиксирует правку: единственный санкционированный сток текстблока
     * (нормализация капсул + перенумерация сносок + запись в state + превью).
     */
    persist() {
        textBlockManager.finalizeEdit(this._editor);
    }
}

/**
 * Реализация SearchTarget над ТЕЛОМ сноски (data-footnote-text) — невидимой в
 * DOM поверхностью (см. модульный докстринг). Один экземпляр на
 * span.text-footnote. В отличие от TextBlockSearchTarget, collectRuns() НЕ
 * обходит DOM: тело сноски нигде не рендерится текстовым узлом, поэтому у
 * совпадений внутри него физически нет DOM Range (run.segments всегда []).
 */
export class FootnoteBodySearchTarget {
    /** @param {HTMLElement} footnoteEl span.text-footnote[data-footnote-id]. */
    constructor(footnoteEl) {
        this._footnoteEl = footnoteEl;
        this._editor = footnoteEl.closest('.textblock-editor');
        // Владеющий текстблок — нужен find-bar.js для custom-undo снимка
        // content'а (правка тела сноски в итоге персистится ЧЕРЕЗ content
        // блока, см. persist()/finalizeEdit); НЕ совпадает с this.id.
        this.blockId = (this._editor && this._editor.dataset) ? this._editor.dataset.textBlockId : null;
        const footnoteId = footnoteEl.getAttribute('data-footnote-id') || '';
        // Составной id: отдельная от TextBlockSearchTarget цель того же блока
        // (тот использует голый blockId) — targetId должен однозначно указывать
        // на КОНКРЕТНУЮ сноску, иначе группировка совпадений/replace не отличили
        // бы правку видимого текста блока от правки тела конкретной его сноски.
        this.id = `${this.blockId || ''}:footnote:${footnoteId}`;
    }

    /**
     * @returns {Array} Один run (пустой массив — сноска без тела, симметрично
     * flush()/_collectCapsuleTextRun, которые тоже не пушат пустой пробег):
     * текст ЦЕЛИКОМ из data-footnote-text, БЕЗ DOM-сегментов.
     */
    collectRuns() {
        const text = this._footnoteEl.getAttribute('data-footnote-text') || '';
        if (!text) return [];
        return [{ text, segments: [], footnoteBody: true, footnoteEl: this._footnoteEl }];
    }

    /**
     * Фиксирует правку тела сноски — ТОТ ЖЕ сток, что и у TextBlockSearchTarget
     * (finalizeEdit читает editor.innerHTML, куда уже входит обновлённый
     * data-footnote-text — атрибут живого DOM-узла, мутировавшего до вызова).
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

    /** @private @type {Map<HTMLElement,Array>|null} Кэш пробегов по редактору. */
    _runsCache: null,
    /** @private @type {MutationObserver|null} Инвалидатор кэша пробегов. */
    _cacheObserver: null,

    /**
     * @private Ленивая инициализация кэша пробегов + наблюдателя-инвалидатора.
     * Между поисками (набор в строке поиска, переключение опций, навигация) DOM
     * текстблоков НЕ меняется — повторный DFS-обход всех редакторов на каждый
     * ввод избыточен. Кэшируем пробеги по редактору; ЛЮБАЯ мутация поддерева
     * текстблоков (ввод в блок, замена, структурная правка) сбрасывает кэш
     * целиком. Class/attr-мутации (node-selected, подсветка) НЕ наблюдаем — на
     * пробеги не влияют, а сброс на них съел бы весь выигрыш при наборе запроса.
     * Без MutationObserver/контейнера кэш НЕ включается (надёжной инвалидации
     * нет → отдаём свежий обход, staleness исключён).
     * @returns {Map|null}
     */
    _ensureRunsCache() {
        if (this._runsCache) return this._runsCache;
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined'
            || typeof document.getElementById !== 'function') return null;
        const container = document.getElementById('itemsContainer');
        if (!container) return null;
        this._runsCache = new Map();
        this._cacheObserver = new MutationObserver(() => { this._runsCache.clear(); });
        this._cacheObserver.observe(container, { subtree: true, childList: true, characterData: true });
        return this._runsCache;
    },

    /**
     * @private Пробеги редактора с кэшем (инвалидируется наблюдателем и явно
     * после replaceRange). Fallback без кэша — прямой collectRuns.
     * @param {HTMLElement} editor
     * @returns {Array}
     */
    _collectRunsCached(editor) {
        const cache = this._ensureRunsCache();
        if (!cache) return this.collectRuns(editor);
        let runs = cache.get(editor);
        if (!runs) {
            runs = this.collectRuns(editor);
            cache.set(editor, runs);
        }
        return runs;
    },

    /**
     * Синхронно сбрасывает кэш пробегов. Наблюдатель ловит мутации асинхронно
     * (microtask), поэтому replaceRange, за которым СИНХРОННО идёт пересбор
     * совпадений (FindBar), обязан сбросить кэш сам — иначе пересбор построил бы
     * Range по устаревшим (до замены) пробегам.
     */
    invalidateRunsCache() {
        if (this._runsCache) this._runsCache.clear();
    },

    /**
     * Собирает цели поиска в порядке документа: на каждый текстблок — его
     * TextBlockSearchTarget (видимый текст), сразу следом — по одной
     * FootnoteBodySearchTarget на КАЖДУЮ сноску этого блока (их может быть
     * несколько), в порядке появления в DOM. Ячейки таблиц — будущая цель
     * через ту же SearchTarget-абстракцию.
     * @returns {Array<TextBlockSearchTarget|FootnoteBodySearchTarget>}
     */
    buildTargets() {
        const container = (typeof document !== 'undefined' && document.getElementById)
            ? (document.getElementById('itemsContainer') || document)
            : document;
        const editors = container.querySelectorAll('.textblock-editor[data-text-block-id]');
        const targets = [];
        editors.forEach((ed) => {
            targets.push(new TextBlockSearchTarget(ed));
            ed.querySelectorAll('.text-footnote').forEach((fn) => {
                targets.push(new FootnoteBodySearchTarget(fn));
            });
        });
        return targets;
    },

    /**
     * Собирает пробеги текста редактора ручным DFS. Правила:
     *  - текстовый узел с предком-капсулой в основной обход не попадает (DFS
     *    сюда не спускается) — только в отдельный пробег капсулы, см. ниже;
     *  - чистый zero-width узел (caret-guard U+FEFF / якорь размера U+200B /
     *    пустой) — пропускается, НЕ разрывая пробег (в т.ч. внутри капсулы);
     *  - капсула (.text-link/.text-footnote) — АТОМ для ОКРУЖАЮЩЕГО текста:
     *    граница капсулы разрывает пробег снаружи. Собственный видимый текст
     *    капсулы при этом собирается в ОТДЕЛЬНЫЙ пробег с пометкой
     *    capsuleText:true (_collectCapsuleTextRun) и пушится в runs сразу по
     *    месту (между «до» и «после» — порядок документа). Искать/подсвечивать
     *    его можно; заменить — нельзя (replaceRange отклоняет по
     *    _hasCapsuleAncestor вне зависимости от пометки пробега);
     *  - <br> и <img> — АТОМЫ/void: разрывают пробег. <img> тоже, иначе
     *    совпадение, «перепрыгнувшее» картинку, при replaceRange удалило бы её
     *    (deleteContents) — картинки в текстблоках значимы (_toggleEmptyClass);
     *  - прочий inline/блок (b/i/u/span-формат) — прозрачно обходится, его текст
     *    склеивается в текущий пробег (снаружи капсулы и внутри неё одинаково).
     * @param {HTMLElement} editor
     * @returns {Array<{text:string, segments:Array<{node:Node,start:number,end:number}>, capsuleText?:true}>}
     */
    collectRuns(editor) {
        const runs = [];
        let current = null;

        const flush = () => {
            if (current && current.text.length > 0) runs.push(current);
            current = null;
        };

        const visit = (node) => {
            for (let child = node.firstChild; child; child = child.nextSibling) {
                if (child.nodeType === Node.TEXT_NODE) {
                    // Чистый zero-width (guard/якорь/пустой) — не текст: пропускаем
                    // без разрыва пробега.
                    if (isZeroWidthNode(child)) continue;
                    const text = child.data != null ? child.data : (child.textContent || '');
                    if (!text) continue;
                    if (!current) current = { text: '', segments: [] };
                    const start = current.text.length;
                    current.segments.push({ node: child, start, end: start + text.length });
                    current.text += text;
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    if (isCapsuleNode(child)) {
                        flush(); // капсула-атом: граница рвёт ОКРУЖАЮЩИЙ пробег
                        // Собственный текст капсулы — отдельный пробег, пушится
                        // сразу по месту (порядок документа сохраняется).
                        const capsuleRun = this._collectCapsuleTextRun(child);
                        if (capsuleRun) runs.push(capsuleRun);
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
     * @private Собирает СОБСТВЕННЫЙ видимый текст капсулы (ссылки/сноски) в
     * один пробег, помеченный capsuleText:true. Рекурсия транзитивно обходит
     * вложенное inline-форматирование (b/i/span) — так же, как основной
     * DFS снаружи капсулы; isCapsuleNode здесь НЕ проверяется, т.к. капсулы в
     * этом кодовой базе не вкладываются друг в друга (§3 дев-гайда). Сегменты
     * указывают на РЕАЛЬНЫЕ текстовые узлы капсулы (не синтетика) — чтобы
     * _locate/_rangeFromRun работали без изменений. Пустая капсула (без
     * видимого текста) → null, пробег не добавляется (симметрично flush()
     * основного DFS, который тоже не пушит пустые пробеги).
     * @param {Node} capsuleNode
     * @returns {{text:string, segments:Array<{node:Node,start:number,end:number}>, capsuleText:true}|null}
     */
    _collectCapsuleTextRun(capsuleNode) {
        const run = { text: '', segments: [], capsuleText: true };
        const walk = (node) => {
            for (let child = node.firstChild; child; child = child.nextSibling) {
                if (child.nodeType === Node.TEXT_NODE) {
                    if (isZeroWidthNode(child)) continue;
                    const text = child.data != null ? child.data : (child.textContent || '');
                    if (!text) continue;
                    const start = run.text.length;
                    run.segments.push({ node: child, start, end: start + text.length });
                    run.text += text;
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    walk(child); // прозрачная рекурсия — форматирование внутри капсулы
                }
            }
        };
        walk(capsuleNode);
        return run.text.length > 0 ? run : null;
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
        // Флаг `u` — ВСЕГДА, независимо от тумблеров. Причины: (1) whole-word
        // оборачивает в \p{L} (требует `u`); (2) без `u` regex-точка/класс бьёт
        // суррогатные пары — эмодзи режется пополам, и replaceRange портит
        // астральный символ. Единый флаг развязывает `u` от «Слово целиком»:
        // включение whole-word больше НЕ меняет валидность и число совпадений
        // ранее рабочего regex-паттерна (в обоих положениях тумблера — один режим).
        let source = regex ? query : this._escapeRegExp(query);
        if (wholeWord) {
            source = this._wholeWordWrap(source);
        }
        let flags = 'g';
        if (!caseSensitive) flags += 'i';
        flags += 'u';
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
     * матчер один раз; лимит — суммарный по всем пробегам. Если пробег помечен
     * capsuleText:true (текст капсулы, см. collectRuns) или footnoteBody:true
     * (тело сноски, см. FootnoteBodySearchTarget), пометка (и footnoteEl —
     * для footnoteBody) переносится на каждый его матч — потребитель
     * (FindBar/подсветка) может отличить «найдено внутри капсулы»/«найдено в
     * теле сноски» от обычного совпадения. На обычных пробегах эти поля у
     * матча отсутствуют (не false — именно отсутствуют, как и у самого пробега).
     * @param {Array<{text:string, capsuleText?:true, footnoteBody?:true, footnoteEl?:HTMLElement}>} runs
     * @param {string} query
     * @param {object} [opts] см. _matchesInString
     * @returns {{matches:Array<{runIndex:number,start:number,end:number,capsuleText?:true,footnoteBody?:true,footnoteEl?:HTMLElement}>, capped:boolean, error?:string}}
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
                const match = { runIndex: ri, start: mt.start, end: mt.end };
                if (runs[ri].capsuleText) match.capsuleText = true;
                if (runs[ri].footnoteBody) {
                    match.footnoteBody = true;
                    match.footnoteEl = runs[ri].footnoteEl;
                }
                out.push(match);
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
     * DOM), КРОМЕ пробегов без реальных DOM-сегментов (footnoteBody, см. модульный
     * докстринг) — там range:null, а footnoteBody/footnoteEl переносятся на матч
     * вместо него (_rangeFromRun не зовётся: упал бы на createRange по
     * несуществующему узлу). Порядок — как в пробегах (порядок документа).
     * @param {object} target SearchTarget
     * @param {string} query
     * @param {object} [opts]
     * @returns {{matches:Array<{range:Range|null,runIndex:number,start:number,end:number,capsuleText?:true,footnoteBody?:true,footnoteEl?:HTMLElement}>, capped:boolean, error?:string}}
     */
    findInTarget(target, query, opts = {}) {
        const runs = target.collectRuns();
        const res = this.findInRuns(runs, query, opts);
        if (res.error) return { matches: [], capped: false, error: res.error };
        const matches = res.matches.map((m) => {
            const run = runs[m.runIndex];
            const hasSegments = Array.isArray(run.segments) && run.segments.length > 0;
            const match = {
                range: hasSegments ? this._rangeFromRun(run, m.start, m.end) : null,
                runIndex: m.runIndex,
                start: m.start,
                end: m.end,
            };
            if (m.capsuleText) match.capsuleText = true;
            if (m.footnoteBody) {
                match.footnoteBody = true;
                match.footnoteEl = m.footnoteEl;
            }
            return match;
        });
        return { matches, capped: res.capped };
    },

    /**
     * Плоский упорядоченный список совпадений по ВСЕМ целям (порядок документа).
     * Невалидный regex — структурная ошибка {error}, без исключения. Лимит —
     * глобальный. Совпадения из пробега текста капсулы (capsuleText:true, см.
     * collectRuns) несут ту же пометку — потребитель отличит «найдено в
     * капсуле» (искать/подсвечивать можно, заменять по-прежнему нельзя) от
     * обычного совпадения; на обычных матчах поле отсутствует. Совпадения из
     * пробега БЕЗ реальных DOM-сегментов (footnoteBody:true — тело сноски, см.
     * FootnoteBodySearchTarget) несут range:null вместо DOM-Range (строить
     * его физически не из чего — _rangeFromRun не зовётся) плюс footnoteBody/
     * footnoteEl как метаданные для UI-слоя (find-bar.js).
     * @param {string} query
     * @param {object} [opts]
     * @returns {{matches:Array<{targetId:string,range:Range|null,runIndex:number,start:number,end:number,capsuleText?:true,footnoteBody?:true,footnoteEl?:HTMLElement}>, capped:boolean, error?:string}}
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
                const run = runs[ri];
                const hasSegments = Array.isArray(run.segments) && run.segments.length > 0;
                const scan = this._scanWithRegex(run.text, built.regex, cap - out.length);
                for (const mt of scan.matches) {
                    const match = {
                        targetId: target.id,
                        // Пробег без DOM-сегментов (тело сноски) — Range физически
                        // не построить (нет текстового узла с этим содержимым
                        // нигде в DOM): range:null + метаданные вместо него.
                        range: hasSegments ? this._rangeFromRun(run, mt.start, mt.end) : null,
                        runIndex: ri,
                        start: mt.start,
                        end: mt.end,
                    };
                    if (run.capsuleText) match.capsuleText = true;
                    if (run.footnoteBody) {
                        match.footnoteBody = true;
                        match.footnoteEl = run.footnoteEl;
                    }
                    out.push(match);
                }
                if (scan.capped) { capped = true; break; }
            }
            if (capped) break;
        }
        return { matches: out, capped };
    },

    /**
     * @private Есть ли у узла (или он сам) предок-капсула? Защита от замены,
     * пересекающей капсулу. Обход сознательно локален (движок «чистый, без UI» —
     * не тянет editor-привязанный _capsuleAncestor), но предикат — общий
     * isCapsuleNode (единый с textblock-core, чтобы «граница капсулы» не дрейфовала).
     * @param {Node} node
     * @returns {boolean}
     */
    _hasCapsuleAncestor(node) {
        let n = node;
        while (n) {
            if (isCapsuleNode(n)) return true;
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
            // replaceData(s, e-s, ...), НЕ nodeValue=: правит смещения только в
            // [s, e), сохраняя ДРУГИЕ живые Range в этом же узле. Присваивание
            // nodeValue эквивалентно replaceData(0, len, ...) — схлопывает ВСЕ
            // границы к 0 и ломает back-to-front replace-all при нескольких
            // совпадениях в одном текст-узле (обычный абзац): «кот кот кот» →
            // «пёспёскот кот пёс» вместо «пёс пёс пёс».
            sc.replaceData(s, e - s, replacement);
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
        // Пробеги затронутого редактора устарели — сбрасываем кэш синхронно
        // (наблюдатель сработал бы только на microtask, а пересбор совпадений
        // в FindBar идёт сразу после серии replaceRange).
        this.invalidateRunsCache();
    },
};

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.ActSearchEngine = ActSearchEngine;
window.TextBlockSearchTarget = TextBlockSearchTarget;
window.FootnoteBodySearchTarget = FootnoteBodySearchTarget;
