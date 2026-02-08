/**
 * Менеджер предпросмотра документа
 *
 * Отвечает за рендеринг финальной версии акта в панели предпросмотра.
 * Обрабатывает различные типы контента: таблицы, текстовые блоки,
 * нарушения и древовидную структуру с учетом вложенности.
 */
class PreviewManager {
    /**
     * Обновляет содержимое панели предпросмотра
     *
     * @param {Object|string} options - Настройки отображения или строка 'previewTrim' для обратной совместимости
     */
    static update(options = {}) {
        // Обратная совместимость со старым API
        if (typeof options === 'string') {
            options = {previewTrim: AppConfig.preview.defaultTrimLength};
        }

        const {previewTrim = AppConfig.preview.defaultTrimLength} = options;

        // Используем requestAnimationFrame вместо setTimeout для лучшей производительности
        requestAnimationFrame(() => {
            this._performUpdate(previewTrim);
        });
    }

    /**
     * Текущий tooltip в предпросмотре
     * @private
     */
    static _previewTooltip = null;
    static _previewTooltipTimeout = null;

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

        this._renderTitle(preview);
        this._renderTree(preview, previewTrim);
        this._attachPreviewTooltips(preview);
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
        this.renderNode(AppState.treeData, container, 1, previewTrim);
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

        const tableData = AppState.tables[child.tableId];
        if (tableData) {
            const table = PreviewTableRenderer.create(tableData, previewTrim);
            container.appendChild(table);
        }
    }

    /**
     * Рендерит узел текстового блока
     * @private
     */
    static _renderTextBlockNode(child, container, level, previewTrim) {
        const textBlock = AppState.textBlocks[child.textBlockId];

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
        const violation = AppState.violations[child.violationId];

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
        contentDiv.textContent = this._trimText(child.content, previewTrim);
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
     * Обрезает текст до указанной длины
     * @private
     * @param {string} text - Исходный текст
     * @param {number} maxLength - Максимальная длина
     * @returns {string} Обрезанный текст
     */
    static _trimText(text, maxLength) {
        const str = text.toString();
        return str.length > maxLength ? str.slice(0, maxLength) + '…' : str;
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
        this._performUpdate(AppConfig.preview.defaultTrimLength);
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
