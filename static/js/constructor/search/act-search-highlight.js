/**
 * Слой подсветки совпадений поиска (B1) на CSS Custom Highlight API. Без DOM-
 * обёрток вокруг текста (не ломает капсулы/сноски): подсветка живёт поверх
 * существующих Range через CSS.highlights.
 *
 * Два именованных highlight'а:
 *   'act-find'         — все совпадения;
 *   'act-find-current' — текущее (активное) совпадение.
 * CSS-правила ::highlight(act-find) / ::highlight(act-find-current) добавляет B2
 * в свой CSS-файл; здесь имена только регистрируются в реестре подсветок.
 *
 * Feature-detect: CSS Custom Highlight API есть не везде. При отсутствии — no-op
 * с однократным предупреждением (поиск в B2 продолжит работать без визуальной
 * подсветки; прокрутка к совпадению остаётся).
 */
export const ActSearchHighlight = {
    /** @private Однократность warn'а об отсутствии API. */
    _warned: false,

    /**
     * @private Доступен ли CSS Custom Highlight API (CSS.highlights + Highlight)?
     * @returns {boolean}
     */
    _supported() {
        return typeof CSS !== 'undefined'
            && !!CSS.highlights
            && typeof Highlight !== 'undefined';
    },

    /**
     * @private Однократно предупреждает об отсутствии API.
     * @returns {boolean} поддерживается ли API (false → вызывающий делает no-op)
     */
    _warnOnce() {
        if (this._supported()) return true;
        if (!this._warned) {
            console.warn('CSS Custom Highlight API недоступен — подсветка поиска отключена (поиск/прокрутка работают).');
            this._warned = true;
        }
        return false;
    },

    /**
     * Подсветка ВСЕХ совпадений ('act-find'). Тяжёлая часть (до MAX_MATCHES
     * диапазонов в одном Highlight) — звать только при СМЕНЕ набора совпадений
     * (_runSearch), НЕ на каждую навигацию prev/next (там достаточно renderCurrent).
     * @param {Array<{range:Range}>} matches плоский список (buildAllMatches)
     */
    renderAll(matches) {
        if (!this._warnOnce()) return;
        const ranges = (matches || []).map((m) => m && m.range).filter(Boolean);
        CSS.highlights.set('act-find', new Highlight(...ranges));
    },

    /**
     * Подсветка ТЕКУЩЕГО совпадения ('act-find-current'). Дёшево (один Range):
     * prev/next обновляет только её, не пересобирая весь 'act-find'.
     * @param {Range|null} range текущий диапазон (null — снять подсветку текущего)
     */
    renderCurrent(range) {
        if (!this._warnOnce()) return;
        if (range) {
            CSS.highlights.set('act-find-current', new Highlight(range));
        } else {
            CSS.highlights.delete('act-find-current');
        }
    },

    /**
     * Полная перерисовка: подсветка всех совпадений и текущего.
     * @param {Array<{range:Range}>} matches плоский список (buildAllMatches)
     * @param {number} [currentIdx=-1] индекс текущего совпадения в matches
     */
    render(matches, currentIdx = -1) {
        if (!this._warnOnce()) return;
        this.renderAll(matches);
        const current = (currentIdx >= 0 && matches && matches[currentIdx])
            ? matches[currentIdx].range : null;
        this.renderCurrent(current);
    },

    /** Снимает обе подсветки. */
    clear() {
        if (!this._supported()) return;
        CSS.highlights.delete('act-find');
        CSS.highlights.delete('act-find-current');
    },

    /**
     * Прокручивает контейнер к текущему совпадению (по родителю стартового узла
     * Range — сам текстовый узел scrollIntoView не имеет).
     * @param {Range} range
     */
    scrollToCurrent(range) {
        if (!range || !range.startContainer) return;
        const el = range.startContainer.parentElement;
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'center' });
        }
    },
};

// Window-global для совместимости с inline-скриптами в шаблонах.
window.ActSearchHighlight = ActSearchHighlight;
