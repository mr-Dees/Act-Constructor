/**
 * Построитель <colgroup> для таблиц редактора и предпросмотра.
 *
 * Вынесен в отдельный модуль, чтобы НЕ вносить DOM в «чистый» col-widths.js
 * (тот тестируется без jsdom). Ширины колонок берутся из colWidths — единого
 * источника истины (того же, что у DOCX-билдера). При table-layout:fixed это
 * даёт Word-подобную раскладку пропорционально весам.
 */
import { colWidthsToPercents } from './col-widths.js';

/**
 * Строит <colgroup> с шириной каждой колонки в процентах из colWidths.
 * При рассинхроне длины (нет/неверный colWidths) делит ширину поровну.
 * Пропорции совпадают с DOCX-билдером (`_compute_col_widths`: weight/sum).
 * @param {number[]} colWidths - Веса колонок таблицы
 * @param {number} numCols - Фактическое число колонок по grid
 * @returns {HTMLElement} Элемент <colgroup>
 */
export function buildColgroup(colWidths, numCols) {
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
