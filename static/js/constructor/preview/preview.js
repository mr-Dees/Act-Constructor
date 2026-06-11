/**
 * Менеджер предпросмотра документа
 *
 * Отвечает за рендеринг финальной версии акта в панели предпросмотра.
 * Обрабатывает различные типы контента: таблицы, текстовые блоки,
 * нарушения и древовидную структуру с учетом вложенности.
 */
import { PreviewTableRenderer } from './preview-table-renderer.js';
import { PreviewTextBlockRenderer } from './preview-textblock-renderer.js';
import { PreviewViolationRenderer } from './preview-violation-renderer.js';
import { AppState, _unwrap } from '../state/state-core.js';
import { AppConfig } from '../../shared/app-config.js';
import { invalidateTableWarningsCache, getCachedTableWarnings } from '../header/notifications-source-tables.js';
import { PreviewFitScaler } from './preview-fit.js';

export class PreviewManager {
    /**
     * Флаг запланированного RAF-обновления (дедупликация в пределах одного кадра).
     * @private
     */
    static _pendingUpdate = false;
    static _pendingOptions = null;

    /**
     * Единый скейлер fit-to-width для inline-панели предпросмотра (#preview).
     * Лениво создаётся в _performUpdate. У модального меню — свой экземпляр.
     * @private
     */
    static _fitScaler = null;

    /**
     * Обновляет содержимое панели предпросмотра.
     * Дедуплицирует подряд идущие вызовы в пределах одного animation frame:
     * на N вызовов выполнится ровно один _performUpdate с последними опциями.
     *
     * @param {Object|string} options - Настройки отображения или строка 'previewTrim' для обратной совместимости
     */
    static update(options = {}) {
        // Обратная совместимость со старым API
        if (typeof options === 'string') {
            options = {previewTrim: AppConfig.preview.defaultTrimLength};
        }

        if (this._pendingUpdate) {
            // Подряд идущий вызов в том же кадре — мержим опции и выходим,
            // существующий RAF подберёт обновлённый _pendingOptions.
            Object.assign(this._pendingOptions, options);
            return;
        }

        this._pendingUpdate = true;
        this._pendingOptions = {...options};

        requestAnimationFrame(() => {
            const opts = this._pendingOptions;
            this._pendingUpdate = false;
            this._pendingOptions = null;
            const {previewTrim = AppConfig.preview.defaultTrimLength} = opts || {};
            // Сбрасываем кеш замечаний ДО рендера: _applyTableOutlines (рамки) и
            // collectTableItems (колокольчик) пересчитают снимок один раз и
            // переиспользуют его. Инвалидация здесь, а не на content-changed,
            // потому что событие летит ПОСЛЕ outlines — иначе рамки читали бы
            // устаревший кеш.
            invalidateTableWarningsCache();
            this._performUpdate(previewTrim);
            this._emitContentChanged();
        });
    }

    /** @private Уведомляет подписчиков (колокольчик) об изменении содержимого. */
    static _emitContentChanged() {
        if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent('preview:content-changed'));
        }
    }

    /**
     * Текущий tooltip в предпросмотре
     * @private
     */
    static _previewTooltip = null;
    static _previewTooltipTimeout = null;

    /**
     * Debounce-таймер для typing-flow (textblock/violation input).
     * @private
     */
    static _typingTimer = null;
    static _TYPING_DEBOUNCE_MS = 150;

    /**
     * Планирует обновление предпросмотра с debounce 150 мс.
     * Используется в typing-handler'ах (textblock-editor, violation textarea),
     * чтобы серия input-событий не запускала рендер на каждый кадр.
     *
     * @param {Object|string} options - Настройки отображения
     */
    static scheduleTyping(options = {}) {
        clearTimeout(this._typingTimer);
        this._typingTimer = setTimeout(() => {
            this._typingTimer = null;
            this.update(options);
        }, this._TYPING_DEBOUNCE_MS);
    }

    /**
     * Выполняет обновление предпросмотра
     * @private
     * @param {number} previewTrim - Максимальная длина текста
     */
    static _performUpdate(previewTrim) {
        const preview = document.getElementById('preview');
        if (!preview) return;

        this._hidePreviewTooltip();
        preview.innerHTML = '';

        // Единая сборка документа (лист + sizer + индикатор зума) — общая для
        // inline-панели и модального меню, исключает расхождение их рендера.
        this.renderDocumentInto(preview, { previewTrim });

        // Fit-to-width: масштабирует лист под ширину панели. attach идемпотентен —
        // на перерендере наблюдаем ту же #preview и просто перепланируем расчёт.
        if (!this._fitScaler) this._fitScaler = new PreviewFitScaler();
        this._fitScaler.attach(preview);
    }

    /**
     * Собирает единую структуру документа предпросмотра в указанный контейнер.
     *
     * ЕДИНЫЙ источник рендера и для inline-панели (#preview), и для модального
     * меню (#previewMenuBody) — благодаря этому оба предпросмотра выглядят
     * идентично (устраняет прежнее расхождение, когда меню строило документ
     * вручную). Структура: sizer-обёртка → лист A4 (.preview-sheet) с заголовком,
     * деревом и tooltip'ами, плюс индикатор зума поверх холста.
     *
     * @param {HTMLElement} container - Холст (#preview или #previewMenuBody).
     * @param {Object} opts
     * @param {number} opts.previewTrim - Максимальная длина текста.
     * @returns {{sheet: HTMLElement, sizer: HTMLElement, indicator: HTMLElement}}
     */
    static renderDocumentInto(container, { previewTrim }) {
        // Sizer занимает масштабированный footprint листа (см. preview-fit.js).
        const sizer = document.createElement('div');
        sizer.className = 'preview-sheet-sizer';

        // Белый лист A4 с полями и типографикой Word; масштабируется fit-скейлером.
        const sheet = document.createElement('div');
        sheet.className = 'preview-sheet';

        sizer.appendChild(sheet);
        container.appendChild(sizer);

        this._renderTitle(sheet);
        this._renderTree(sheet, previewTrim);
        this._attachPreviewTooltips(sheet);

        // Цветные рамки проблемных таблиц на листе (источник — те же замечания,
        // что и колокольчик). Внутри renderDocumentInto, поэтому работает и для
        // inline-панели, и для модального меню.
        this._applyTableOutlines(sheet);

        // Индикатор текущего масштаба (обновляется скейлером).
        const indicator = document.createElement('div');
        indicator.className = 'preview-zoom-indicator';
        indicator.textContent = '100%';
        container.appendChild(indicator);

        return { sheet, sizer, indicator };
    }

    /**
     * Навешивает на проблемные таблицы листа цветную рамку по критичности
     * (error→красная, warning→оранжевая). Источник — те же замечания, что и
     * колокольчик. Для одной таблицы error важнее warning.
     * @param {HTMLElement} sheet Контейнер с .preview-table-wrapper[data-table-id].
     */
    static _applyTableOutlines(sheet) {
        // Закешированный снимок замечаний (тот же, что и у колокольчика). Геттер
        // сам глотает исключения сборки и отдаёт [] — отдельный try/catch не нужен.
        const warnings = getCachedTableWarnings();
        const sev = new Map();
        for (const w of warnings) {
            if (w.tableId == null) continue;
            const key = String(w.tableId);
            if (sev.get(key) === 'error') continue;
            sev.set(key, w.severity === 'error' ? 'error' : (sev.get(key) || 'warning'));
        }
        sheet.querySelectorAll('.preview-table-wrapper[data-table-id]').forEach((el) => {
            el.classList.remove('preview-table-wrapper--error', 'preview-table-wrapper--warning');
            const s = sev.get(el.dataset.tableId);
            if (s === 'error') el.classList.add('preview-table-wrapper--error');
            else if (s === 'warning') el.classList.add('preview-table-wrapper--warning');
        });
    }

    /**
     * Рендерит заголовок документа
     * @private
     * @param {HTMLElement} container - Контейнер для заголовка
     */
    static _renderTitle(container) {
        const title = document.createElement('h1');
        title.textContent = 'АКТ';
        container.appendChild(title);
    }

    /**
     * Рендерит дерево структуры документа
     * @private
     * @param {HTMLElement} container - Контейнер для дерева
     * @param {number} previewTrim - Максимальная длина текста
     */
    static _renderTree(container, previewTrim) {
        // Read-only обход — по raw-дереву (без Proxy get-трапов).
        this.renderNode(_unwrap(AppState.treeData), container, 1, previewTrim);
    }

    /**
     * Рекурсивно рендерит узел дерева и его дочерние элементы
     *
     * @param {Object} node - Узел дерева для рендеринга
     * @param {HTMLElement} container - Контейнер для вставки элементов
     * @param {number} level - Уровень вложенности для размера заголовков
     * @param {number} previewTrim - Максимальная длина текста
     */
    static renderNode(node, container, level, previewTrim) {
        if (!node.children) return;

        node.children.forEach(child => {
            const renderer = this._getRenderer(child.type);
            renderer.call(this, child, container, level, previewTrim);
        });
    }

    /**
     * Получает функцию-рендерер для типа узла
     * @private
     * @param {string} type - Тип узла
     * @returns {Function} Функция рендеринга
     */
    static _getRenderer(type) {
        const renderers = {
            'table': this._renderTableNode,
            'textblock': this._renderTextBlockNode,
            'violation': this._renderViolationNode
        };

        return renderers[type] || this._renderItemNode;
    }

    /**
     * Рендерит узел таблицы
     * @private
     */
    static _renderTableNode(child, container, level, previewTrim) {
        // Показываем название только если customLabel задан явно
        if (child.customLabel !== '') {
            const tableTitle = document.createElement('h4');
            tableTitle.textContent = child.customLabel || child.number || child.label;
            tableTitle.className = 'preview-table-title';
            container.appendChild(tableTitle);
        }

        // Read-only: raw-таблица (рендерер ячеек только читает grid).
        const tableData = _unwrap(AppState.tables)[child.tableId];
        if (tableData) {
            const table = PreviewTableRenderer.create(tableData, previewTrim, { tableId: child.tableId });
            container.appendChild(table);
        }
    }

    /**
     * Рендерит узел текстового блока
     * @private
     */
    static _renderTextBlockNode(child, container, level, previewTrim) {
        const textBlock = _unwrap(AppState.textBlocks)[child.textBlockId];

        if (this._hasContent(textBlock)) {
            const element = PreviewTextBlockRenderer.create(textBlock);
            container.appendChild(element);
        }
    }

    /**
     * Рендерит узел нарушения
     * @private
     */
    static _renderViolationNode(child, container, level, previewTrim) {
        const violation = _unwrap(AppState.violations)[child.violationId];

        if (violation) {
            const element = PreviewViolationRenderer.create(violation, previewTrim);
            container.appendChild(element);
        }
    }

    /**
     * Рендерит обычный узел-пункт
     * @private
     */
    static _renderItemNode(child, container, level, previewTrim) {
        this._renderHeading(child, container, level);
        this._renderContent(child, container, previewTrim);

        // Рекурсивная обработка дочерних элементов
        if (child.children?.length > 0) {
            this.renderNode(child, container, level + 1, previewTrim);
        }
    }

    /**
     * Рендерит заголовок пункта
     * @private
     */
    static _renderHeading(child, container, level) {
        const headingLevel = Math.min(level + 1, AppConfig.preview.maxHeadingLevel);
        const heading = document.createElement(`h${headingLevel}`);
        heading.textContent = child.number ? child.number + '. ' + child.label : child.label;
        container.appendChild(heading);
    }

    /**
     * Рендерит содержимое пункта
     * @private
     */
    static _renderContent(child, container, previewTrim) {
        if (!child.content?.trim()) return;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'preview-content';
        // M.5: content пункта выводится полностью (DOCX не обрезает),
        // previewTrim к нему не применяется.
        contentDiv.textContent = child.content;
        container.appendChild(contentDiv);
    }

    /**
     * Проверяет наличие содержимого в текстовом блоке
     * @private
     */
    static _hasContent(textBlock) {
        return textBlock?.content?.trim();
    }

    /**
     * Создает HTML-таблицу для предпросмотра
     * @deprecated Используйте PreviewTableRenderer.create()
     */
    static createPreviewTable(tableData, previewTrim) {
        console.warn('PreviewManager.createPreviewTable устарел, используйте PreviewTableRenderer.create()');
        return PreviewTableRenderer.create(tableData, previewTrim);
    }

    /**
     * Принудительное обновление предпросмотра
     * Используется после загрузки акта или изменения структуры
     */
    static forceUpdate() {
        // Та же инвалидация кеша замечаний перед рендером, что и в update().
        invalidateTableWarningsCache();
        this._performUpdate(AppConfig.preview.defaultTrimLength);
        this._emitContentChanged();
    }

    /**
     * Привязывает обработчики tooltip к ссылкам и сноскам в предпросмотре
     * @private
     * @param {HTMLElement} preview - Контейнер предпросмотра
     */
    static _attachPreviewTooltips(preview) {
        const elements = preview.querySelectorAll('.text-link, .text-footnote');

        elements.forEach(element => {
            element.addEventListener('mouseenter', () => {
                this._previewTooltipTimeout = setTimeout(() => {
                    this._showPreviewTooltip(element);
                }, 700);
            });

            element.addEventListener('mouseleave', () => {
                this._hidePreviewTooltip();
            });
        });
    }

    /**
     * Показывает tooltip для ссылки/сноски в предпросмотре
     * @private
     * @param {HTMLElement} element - Элемент ссылки или сноски
     */
    static _showPreviewTooltip(element) {
        // Guard: элемент мог быть удалён из DOM пока ждали debounce/hover-timeout
        // (например, перерендер preview). Без проверки getBoundingClientRect
        // вернёт нули, tooltip окажется в углу с position:fixed.
        if (!element || !document.body.contains(element)) return;

        this._hidePreviewTooltip();

        const isLink = element.classList.contains('text-link');
        const content = isLink
            ? element.getAttribute('data-link-url')
            : element.getAttribute('data-footnote-text');

        if (!content) return;

        const tooltip = document.createElement('div');
        tooltip.className = 'link-footnote-tooltip';
        tooltip.textContent = content;

        document.body.appendChild(tooltip);

        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        let top = rect.bottom + 8;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (left + tooltipRect.width > viewportWidth) {
            left = viewportWidth - tooltipRect.width - 10;
        }
        if (left < 10) {
            left = 10;
        }

        if (top + tooltipRect.height > viewportHeight) {
            top = rect.top - tooltipRect.height - 8;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;

        this._previewTooltip = tooltip;
    }

    /**
     * Скрывает tooltip в предпросмотре
     * @private
     */
    static _hidePreviewTooltip() {
        if (this._previewTooltip) {
            this._previewTooltip.remove();
            this._previewTooltip = null;
        }
        if (this._previewTooltipTimeout) {
            clearTimeout(this._previewTooltipTimeout);
            this._previewTooltipTimeout = null;
        }
    }
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.PreviewManager = PreviewManager;
