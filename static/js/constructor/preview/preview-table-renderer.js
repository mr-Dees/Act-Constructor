/**
 * Рендерер таблиц для предпросмотра
 *
 * Создает HTML-представление таблиц с поддержкой объединения ячеек
 * и обработкой заголовков.
 */
class PreviewTableRenderer {
    /**
     * Создает элемент таблицы для предпросмотра
     *
     * @param {Object} tableData - Данные таблицы из состояния
     * @param {number} [previewTrim] - Максимальная длина текста (по умолчанию из конфига)
     * @returns {HTMLElement} Контейнер с таблицей
     */
    static create(tableData, previewTrim = AppConfig.preview.defaultTrimLength) {
        const wrapper = this._createWrapper();
        const table = this._createTable(tableData, previewTrim);

        wrapper.appendChild(table);
        return wrapper;
    }

    /**
     * Создает контейнер-обертку для таблицы
     * @private
     */
    static _createWrapper() {
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-table-wrapper';
        return wrapper;
    }

    /**
     * Создает элемент таблицы
     * @private
     */
    static _createTable(tableData, previewTrim) {
        const table = document.createElement('table');
        table.className = 'preview-table';

        const grid = tableData.grid || [];

        if (grid.length === 0) {
            return this._createEmptyTable();
        }

        this._renderRows(table, grid, previewTrim);
        return table;
    }

    /**
     * Создает пустую таблицу-заглушку
     * @private
     */
    static _createEmptyTable() {
        const table = document.createElement('table');
        table.className = 'preview-table preview-table-empty';

        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.textContent = '[Пустая таблица]';
        cell.className = 'preview-table-empty-cell';

        row.appendChild(cell);
        table.appendChild(row);

        return table;
    }

    /**
     * Рендерит все строки таблицы
     * @private
     */
    static _renderRows(table, grid, previewTrim) {
        grid.forEach(rowData => {
            const row = this._createRow(rowData, previewTrim);
            if (row.children.length > 0) {
                table.appendChild(row);
            }
        });
    }

    /**
     * Создает строку таблицы
     * @private
     */
    static _createRow(rowData, previewTrim) {
        const row = document.createElement('tr');

        rowData.forEach(cellData => {
            if (cellData.isSpanned) return;

            const cell = this._createCell(cellData, previewTrim);
            row.appendChild(cell);
        });

        return row;
    }

    /**
     * Создает ячейку таблицы
     * @private
     */
    static _createCell(cellData, previewTrim) {
        const cell = document.createElement(cellData.isHeader ? 'th' : 'td');

        cell.textContent = this._trimText(cellData.content || '', previewTrim);

        if (cellData.isHeader) {
            cell.className = 'preview-table-header';
        }

        this._applyCellSpan(cell, cellData);

        return cell;
    }

    /**
     * Применяет объединение ячеек
     * @private
     */
    static _applyCellSpan(cell, cellData) {
        if (cellData.colSpan > 1) {
            cell.colSpan = cellData.colSpan;
        }
        if (cellData.rowSpan > 1) {
            cell.rowSpan = cellData.rowSpan;
        }
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
}
