/**
 * Масштабирование листа предпросмотра под ширину панели (fit-to-width).
 *
 * Лист A4 имеет фиксированную ширину 210mm. Когда панель уже листа, вместо
 * горизонтальной прокрутки лист масштабируется вниз через CSS transform:scale,
 * сохраняя точные пропорции A4 (главная WYSIWYG-фича). Масштаб капится на 100%
 * (лист никогда не увеличивается крупнее натурального).
 *
 * Паттерн: sizer-обёртка занимает МАСШТАБИРОВАННЫЙ footprint (иначе transform,
 * будучи paint-only, оставил бы пустоту под уменьшенным листом и сломал бы
 * вертикальную прокрутку). Пересчёт — на ResizeObserver панели + RAF-коалесинг.
 */

/**
 * Чистый расчёт масштаба: доля ширины панели к натуральной ширине листа,
 * но не больше 1 (не увеличиваем). Безопасен к нулю/NaN.
 * @param {number} innerWidth Внутренняя (content-box) ширина панели, px.
 * @param {number} naturalWidth Натуральная ширина листа, px.
 * @returns {number} Коэффициент масштаба в (0, 1].
 */
export function computeFitScale(innerWidth, naturalWidth) {
    if (!naturalWidth || naturalWidth <= 0) return 1;
    if (!Number.isFinite(innerWidth) || innerWidth <= 0) return 1;
    return Math.min(innerWidth / naturalWidth, 1);
}

export class PreviewFitScaler {
    constructor() {
        this._pane = null;
        this._ro = null;
        this._rafScheduled = false;
        this._apply = this._apply.bind(this);
        this._schedule = this._schedule.bind(this);
    }

    /**
     * Привязывает скейлер к панели-холсту. Идемпотентно: повторный attach к той
     * же панели не плодит observer'ы. Сразу выполняет первый расчёт.
     * @param {HTMLElement} pane Панель-холст (#preview или #previewMenuBody).
     */
    attach(pane) {
        if (!pane) return;
        if (this._pane === pane && this._ro) { this._schedule(); return; }
        this.detach();
        this._pane = pane;
        this._ro = new ResizeObserver(this._schedule);
        this._ro.observe(pane);
        this._schedule();
    }

    /** Принудительный пересчёт (после перерисовки контента — меняется высота). */
    refresh() { this._schedule(); }

    /** Отвязывает observer. */
    detach() {
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        this._pane = null;
        this._rafScheduled = false;
    }

    /** @private Коалесинг пересчётов в один кадр. */
    _schedule() {
        if (this._rafScheduled) return;
        this._rafScheduled = true;
        requestAnimationFrame(this._apply);
    }

    /** @private Пересчёт и применение масштаба. */
    _apply() {
        this._rafScheduled = false;
        const pane = this._pane;
        // Пропускаем скрытую/несвёрстанную панель (clientWidth === 0): на шаге 2
        // #preview лежит в display:none-контейнере. Измерять её бессмысленно
        // (даст 0×0 footprint); при возврате на шаг 1 перерендер заново привяжет
        // и пересчитает масштаб уже на видимой панели.
        if (!pane || !pane.isConnected || pane.clientWidth === 0) return;

        const sheet = pane.querySelector('.preview-sheet');
        const sizer = pane.querySelector('.preview-sheet-sizer');
        const indicator = pane.querySelector('.preview-zoom-indicator');
        if (!sheet || !sizer) {
            if (indicator) indicator.style.display = 'none';
            return;
        }

        // Натуральные размеры меряем при сброшенном transform: свежесозданный
        // лист может не иметь transform, а прежний — иметь; сброс гарантирует
        // истинный размер. Всё в пределах одного кадра, лишней отрисовки нет.
        sheet.style.transform = 'none';
        const rect = sheet.getBoundingClientRect();
        const natW = rect.width;
        const natH = rect.height;

        const cs = getComputedStyle(pane);
        const padX = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
        const innerW = pane.clientWidth - padX;

        const k = computeFitScale(innerW, natW);
        sheet.style.transform = `scale(${k})`;
        sizer.style.width = `${natW * k}px`;
        sizer.style.height = `${natH * k}px`;

        if (indicator) {
            indicator.style.display = '';
            indicator.textContent = `${Math.round(k * 100)}%`;
        }
    }
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
// Guard: модуль также импортируется в node:test, где window отсутствует.
if (typeof window !== 'undefined') {
    window.computeFitScale = computeFitScale;
    window.PreviewFitScaler = PreviewFitScaler;
}
