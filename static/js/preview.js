/**
 * Управление панелью предпросмотра документа.
 * Отвечает за рендеринг финальной версии акта для пользователя с обработкой
 * различных типов контента: таблиц, текстовых блоков, нарушений и древовидной структуры.
 */
class PreviewManager {
    /**
     * Обновляет содержимое панели предпросмотра на основе текущего состояния документа.
     * Очищает предыдущий контент и рендерит всю структуру заново.
     * @param {Object} options - Настройки отображения
     * @param {number} options.previewTrim - Максимальная длина текста для обрезки (по умолчанию 30 символов)
     */
    static update(options = {}) {
        const {previewTrim = 30} = options;
        const preview = document.getElementById('preview');

        if (!preview) return;

        preview.innerHTML = '';

        // Добавляем заголовок документа
        const title = document.createElement('h1');
        title.textContent = 'АКТ';
        preview.appendChild(title);

        // Рендерим структуру документа из дерева
        this.renderNode(AppState.treeData, preview, 1, previewTrim);
    }

    /**
     * Рекурсивно рендерит узел дерева и все его дочерние элементы.
     * Обрабатывает различные типы узлов: таблицы, текстовые блоки, нарушения и обычные пункты.
     * @param {Object} node - Узел дерева для рендеринга
     * @param {HTMLElement} container - Контейнер для вставки элементов
     * @param {number} level - Уровень вложенности для определения размера заголовков (h2, h3, h4)
     * @param {number} previewTrim - Максимальная длина текста для обрезки
     */
    static renderNode(node, container, level, previewTrim) {
        if (!node.children) return;

        node.children.forEach(child => {
            // Рендеринг таблицы
            if (child.type === 'table') {
                const tableTitle = document.createElement('h4');
                tableTitle.textContent = child.label;
                tableTitle.style.fontWeight = 'bold';
                tableTitle.style.marginTop = '1rem';
                tableTitle.style.marginBottom = '0.5rem';
                container.appendChild(tableTitle);

                if (AppState.tables[child.tableId]) {
                    const table = this.createPreviewTable(AppState.tables[child.tableId], previewTrim);
                    container.appendChild(table);
                }

                return;
            }

            // Рендеринг текстового блока с форматированием
            if (child.type === 'textblock') {
                const textBlock = AppState.textBlocks[child.textBlockId];

                if (textBlock) {
                    const textBlockDiv = document.createElement('div');
                    textBlockDiv.className = 'preview-textblock';

                    // Заголовок текстового блока
                    const title = document.createElement('div');
                    title.className = 'preview-textblock-title';
                    title.textContent = child.label;
                    textBlockDiv.appendChild(title);

                    // Содержимое с сохранением HTML-форматирования
                    const content = document.createElement('div');
                    content.className = 'preview-textblock-content';

                    // Применяем сохраненные настройки форматирования
                    if (textBlock.formatting?.fontSize) {
                        content.style.fontSize = `${textBlock.formatting.fontSize}px`;
                    }

                    if (textBlock.formatting?.alignment) {
                        content.style.textAlign = textBlock.formatting.alignment;
                    }

                    // Вставляем HTML-контент (поддерживает жирный, курсив, подчеркивание и переносы строк)
                    content.innerHTML = textBlock.content || 'Пусто';
                    textBlockDiv.appendChild(content);
                    container.appendChild(textBlockDiv);
                }

                return;
            }

            // Рендеринг нарушения в компактном текстовом формате
            if (child.type === 'violation') {
                const violation = AppState.violations[child.violationId];

                if (violation) {
                    const violationDiv = document.createElement('div');
                    violationDiv.className = 'preview-violation';

                    /**
                     * Обрезает текст до указанной длины с добавлением многоточия.
                     * @param {string} text - Исходный текст
                     * @param {number} maxLength - Максимальная длина (по умолчанию 15)
                     * @returns {string} Обрезанный текст с многоточием или "—" для пустого
                     */
                    const truncate = (text, maxLength = 15) => {
                        if (!text) return '—';
                        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
                    };

                    // Блок "Нарушено"
                    const violatedLine = document.createElement('div');
                    violatedLine.className = 'preview-violation-line';
                    violatedLine.innerHTML = `Нарушено: ${truncate(violation.violated)}`;
                    violationDiv.appendChild(violatedLine);

                    // Блок "Установлено"
                    const establishedLine = document.createElement('div');
                    establishedLine.className = 'preview-violation-line';
                    establishedLine.innerHTML = `Установлено: ${truncate(violation.established)}`;
                    violationDiv.appendChild(establishedLine);

                    // Список описаний с подсчетом непустых метрик
                    if (violation.descriptionList.enabled && violation.descriptionList.items.length > 0) {
                        const itemsCount = violation.descriptionList.items.filter(item => item.trim()).length;

                        if (itemsCount > 0) {
                            const listLine = document.createElement('div');
                            listLine.className = 'preview-violation-line';
                            // Правильное склонение числительного для русского языка
                            listLine.innerHTML = `В том числе: ${itemsCount} ${itemsCount === 1 ? 'метрика' : itemsCount < 5 ? 'метрики' : 'метрик'}`;
                            violationDiv.appendChild(listLine);
                        }
                    }

                    // Дополнительный контент с нумерацией элементов
                    if (violation.additionalContent && violation.additionalContent.enabled) {
                        const items = violation.additionalContent.items || [];

                        // Вычисляем номера для последовательных элементов каждого типа
                        let caseNumber = 1;
                        let imageNumber = 1;
                        let textNumber = 1;

                        items.forEach((item) => {
                            const itemType = item.type;

                            // Кейс - сбрасывает счетчики изображений и текстов
                            if (itemType === 'case' && item.content.trim()) {
                                const caseLine = document.createElement('div');
                                caseLine.className = 'preview-violation-line';
                                caseLine.innerHTML = `Кейс ${caseNumber}: ${truncate(item.content, 50)}`;
                                violationDiv.appendChild(caseLine);
                                caseNumber++;
                                // Изображение - сбрасывает счетчик кейсов
                            } else if (itemType === 'image') {
                                const imageLine = document.createElement('div');
                                imageLine.className = 'preview-violation-line';
                                const caption = item.caption ? ` - ${truncate(item.caption, 30)}` : '';
                                imageLine.innerHTML = `Изображение ${imageNumber}: ${truncate(item.filename, 30)}${caption}`;
                                violationDiv.appendChild(imageLine);
                                caseNumber = 1;
                                imageNumber++;
                                // Свободный текст - сбрасывает счетчик кейсов
                            } else if (itemType === 'freeText' && item.content.trim()) {
                                const textLine = document.createElement('div');
                                textLine.className = 'preview-violation-line';
                                textLine.innerHTML = `Текст ${textNumber}: ${truncate(item.content, 50)}`;
                                violationDiv.appendChild(textLine);
                                caseNumber = 1;
                                textNumber++;
                            }
                        });
                    }

                    // Причины нарушения (опциональное поле)
                    if (violation.reasons.enabled && violation.reasons.content) {
                        const reasonsLine = document.createElement('div');
                        reasonsLine.className = 'preview-violation-line';
                        reasonsLine.innerHTML = `Причины: ${truncate(violation.reasons.content)}`;
                        violationDiv.appendChild(reasonsLine);
                    }

                    // Последствия нарушения (опциональное поле)
                    if (violation.consequences.enabled && violation.consequences.content) {
                        const consequencesLine = document.createElement('div');
                        consequencesLine.className = 'preview-violation-line';
                        consequencesLine.innerHTML = `Последствия: ${truncate(violation.consequences.content)}`;
                        violationDiv.appendChild(consequencesLine);
                    }

                    // Ответственное лицо (опциональное поле)
                    if (violation.responsible.enabled && violation.responsible.content) {
                        const responsibleLine = document.createElement('div');
                        responsibleLine.className = 'preview-violation-line';
                        responsibleLine.innerHTML = `Ответственный за решение проблем: ${truncate(violation.responsible.content)}`;
                        violationDiv.appendChild(responsibleLine);
                    }

                    container.appendChild(violationDiv);
                }

                return;
            }

            // Заголовок обычного пункта с ограничением уровня до h4
            const heading = document.createElement(`h${Math.min(level + 1, 4)}`);
            heading.textContent = child.label;
            container.appendChild(heading);

            // Контент пункта с обрезкой длинного текста
            if (child.content && child.content.trim()) {
                const contentDiv = document.createElement('div');
                contentDiv.className = 'preview-content';
                contentDiv.style.marginBottom = '1rem';
                contentDiv.style.padding = '0.5rem';

                const text = child.content.toString();
                const trimmed = text.length > previewTrim ? text.slice(0, previewTrim) + '…' : text;
                contentDiv.textContent = trimmed;
                container.appendChild(contentDiv);
            }

            // Рекурсивно обрабатываем дочерние элементы с увеличением уровня вложенности
            if (child.children && child.children.length > 0) {
                this.renderNode(child, container, level + 1, previewTrim);
            }
        });
    }

    /**
     * Создает HTML-таблицу для предпросмотра на основе матричной структуры данных.
     * Обрабатывает объединенные ячейки (colspan/rowspan) и пропускает spanned ячейки.
     * @param {Object} tableData - Данные таблицы из состояния с grid-структурой
     * @param {number} previewTrim - Максимальная длина текста в ячейках
     * @returns {HTMLElement} Контейнер с отрендеренной таблицей
     */
    static createPreviewTable(tableData, previewTrim) {
        const tableWrapper = document.createElement('div');
        tableWrapper.style.marginBottom = '1.5rem';
        tableWrapper.style.overflowX = 'auto';

        const table = document.createElement('table');
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';
        table.style.marginBottom = '1rem';

        // Получаем матричную структуру таблицы
        const grid = tableData.grid || [];

        // Если нет grid, возвращаем заглушку с информацией
        if (!grid || grid.length === 0) {
            const emptyCell = document.createElement('td');
            emptyCell.textContent = '[Пустая таблица]';
            emptyCell.style.padding = '8px';
            const emptyRow = document.createElement('tr');
            emptyRow.appendChild(emptyCell);
            table.appendChild(emptyRow);
            tableWrapper.appendChild(table);
            return tableWrapper;
        }

        // Обрабатываем каждую строку таблицы с учетом матричной структуры
        grid.forEach(rowData => {
            const tr = document.createElement('tr');

            rowData.forEach(cellData => {
                // Пропускаем ячейки, поглощенные объединением
                if (cellData.isSpanned) return;

                // Создаем ячейку заголовка или обычную
                const cellEl = document.createElement(cellData.isHeader ? 'th' : 'td');

                // Обрезаем длинный текст с добавлением многоточия
                const text = (cellData.content || '').toString();
                const trimmed = text.length > previewTrim ? text.slice(0, previewTrim) + '…' : text;
                cellEl.textContent = trimmed;

                // Базовая стилизация ячейки
                cellEl.style.border = '1px solid #ddd';
                cellEl.style.padding = '8px';
                cellEl.style.textAlign = 'left';

                // Дополнительная стилизация для заголовков
                if (cellData.isHeader) {
                    cellEl.style.backgroundColor = '#f5f5f5';
                    cellEl.style.fontWeight = 'bold';
                }

                // Применяем объединение ячеек из матричной модели
                if (cellData.colSpan > 1) cellEl.colSpan = cellData.colSpan;
                if (cellData.rowSpan > 1) cellEl.rowSpan = cellData.rowSpan;

                tr.appendChild(cellEl);
            });

            table.appendChild(tr);
        });

        tableWrapper.appendChild(table);
        return tableWrapper;
    }
}
