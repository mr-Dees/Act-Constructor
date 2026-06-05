/**
 * Рендерер таблиц для предпросмотра
 *
 * Создает HTML-представление таблиц с поддержкой объединения ячеек
 * и обработкой заголовков.
 */
import { iterateVisibleCells } from '../table/grid-merges.js';
import { colWidthsToPercents } from '../table/col-widths.js';

export class PreviewTableRenderer {
    /**
     * Создает элемент таблицы для предпросмотра
     *
     * @param {Object} tableData - Данные таблицы из состояния
     * @param {number} [_previewTrim] - Не используется: содержимое ячеек
     *   показывается целиком, как в .docx (F1). Параметр сохранён в сигнатуре
     *   ради обратной совместимости вызовов (preview.js, version-preview.js).
     * @returns {HTMLElement} Контейнер с таблицей
     */
    static create(tableData, _previewTrim) {
        const wrapper = this._createWrapper();
        const table = this._createTable(tableData);

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
    static _createTable(tableData) {
        const table = document.createElement('table');
        table.className = 'preview-table';

        const grid = tableData.grid || [];

        if (grid.length === 0) {
            return this._createEmptyTable();
        }

        // Колонки рендерятся из colWidths через colgroup — единый источник истины
        // ширин (тот же, что у редактора и DOCX-билдера). При table-layout:fixed
        // даёт Word-подобную раскладку пропорционально весам.
        const numCols = grid[0]?.length || 0;
        table.style.tableLayout = 'fixed';
        table.appendChild(this._createColgroup(tableData.colWidths, numCols));

        this._renderRows(table, grid);
        return table;
    }

    /**
     * Строит <colgroup> с шириной каждой колонки в процентах из colWidths.
     * При рассинхроне длины (нет/неверный colWidths) делит ширину поровну.
     * Пропорции совпадают с DOCX-билдером (`_compute_col_widths`: weight/sum).
     * @param {number[]} colWidths - Веса колонок таблицы
     * @param {number} numCols - Фактическое число колонок по grid
     * @returns {HTMLElement} Элемент <colgroup>
     * @private
     */
    static _createColgroup(colWidths, numCols) {
        const colgroup = document.createElement('colgroup');
        const widths = Array.isArray(colWidths) && colWidths.length === numCols
            ? colWidths
            : new Array(numCols).fill(100);
        const percents = colWidthsToPercents(widths);
        percents.forEach(pct => {
            const col = document.createElement('col');
            col.style.width = `${pct}%`;
            colgroup.appendChild(col);
        });
        return colgroup;
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
    static _renderRows(table, grid) {
        grid.forEach(rowData => {
            const row = this._createRow(rowData);
            if (row.children.length > 0) {
                table.appendChild(row);
            }
        });
    }

    /**
     * Создает строку таблицы
     * @private
     */
    static _createRow(rowData) {
        const row = document.createElement('tr');

        // Единый обход видимых (не поглощённых) ячеек — общий helper.
        iterateVisibleCells([rowData], (cellData) => {
            const cell = this._createCell(cellData);
            row.appendChild(cell);
        });

        return row;
    }

    /**
     * Создает ячейку таблицы
     * @private
     */
    static _createCell(cellData) {
        const cell = document.createElement(cellData.isHeader ? 'th' : 'td');

        // Содержимое ячейки — целиком, без обрезки: предпросмотр повторяет .docx,
        // где текст не урезается (F1). textContent (XSS-safe) сохраняет \n как
        // есть; переносы рендерятся за счёт white-space: pre-wrap в CSS листа (F4).
        cell.textContent = cellData.content || '';

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
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.PreviewTableRenderer = PreviewTableRenderer;
