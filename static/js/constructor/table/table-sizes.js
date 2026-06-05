/**
 * Интерактивное изменение ширины колонок таблицы.
 *
 * Ширина колонок — единый источник истины `table.colWidths` (целые относительные
 * веса). Колонки рендерятся через <colgroup> с `width:%` при table-layout:fixed.
 * Ресайз живёт в colgroup: тянем границу → меняем проценты двух соседних <col>,
 * на отпускании фиксируем фактические пиксельные ширины как целые веса в
 * colWidths (нормируются по сумме), помечаем несохранённым и перерисовываем.
 *
 * Высота строк — auto (как в Word); ручного изменения высоты строк больше нет.
 */
import { AppState } from '../state/state-core.js';
import { ItemsRenderer } from '../items/items-renderer.js';
import { pixelWidthsToWeights } from './col-widths.js';
import { makeIdempotentTeardown } from './resize-teardown.js';

export class TableSizes {
    constructor(tableManager) {
        // Ссылка на TableManager для координации операций с таблицами
        this.tableManager = tableManager;
    }

    /**
     * Начало изменения ширины колонки.
     * Тянет границу между колонкой ячейки и следующей: компенсирующее изменение
     * двух соседних <col> в colgroup. На отпускании фиксирует веса в colWidths.
     * @param {MouseEvent} e - событие mousedown на ручке изменения размера
     */
    startColumnResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const section = table.closest('.table-section');
        if (!section) return;

        const tableId = section.dataset.tableId;
        const colgroup = table.querySelector('colgroup');
        if (!colgroup) return;

        const cols = Array.from(colgroup.querySelectorAll('col'));
        const colIndex = parseInt(cell.dataset.col);
        const colspan = cell.colSpan || 1;
        // Граница идёт после последней колонки, перекрытой ячейкой (с учётом colspan).
        const leftIdx = colIndex + colspan - 1;
        const rightIdx = leftIdx + 1;
        if (rightIdx >= cols.length) return;

        const startX = e.clientX;
        const tableWidth = table.offsetWidth || 1;

        // Начальные проценты пары колонок (из реальной геометрии).
        const startLeftPct = (cols[leftIdx].offsetWidth || this._colPixelWidth(table, leftIdx)) / tableWidth * 100;
        const startRightPct = (cols[rightIdx].offsetWidth || this._colPixelWidth(table, rightIdx)) / tableWidth * 100;
        const pairPct = startLeftPct + startRightPct;

        // Минимальная ширина колонки в процентах (80px от ширины таблицы).
        const minPct = (80 / tableWidth) * 100;

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        const onMouseMove = (ev) => {
            const diffPct = ((ev.clientX - startX) / tableWidth) * 100;
            let newLeft = startLeftPct + diffPct;
            // Кламп: обе колонки не уже минимума, сумма пары неизменна.
            newLeft = Math.max(minPct, Math.min(pairPct - minPct, newLeft));
            const newRight = pairPct - newLeft;
            cols[leftIdx].style.width = `${newLeft}%`;
            cols[rightIdx].style.width = `${newRight}%`;
        };

        // Единая разборка: снимаем все слушатели, восстанавливаем курсор и
        // фиксируем текущие веса. Идемпотентна — выполнится ровно один раз,
        // на каком бы из событий завершения/прерывания ни сработала.
        const teardown = makeIdempotentTeardown(() => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('blur', onInterrupt);
            document.removeEventListener('pointercancel', onInterrupt);
            document.removeEventListener('lostpointercapture', onInterrupt);
            // Прерывание (потеря mouseup при alt-tab/отмене указателя) трактуем
            // как обычное завершение: фиксируем веса, чтобы начатый ресайз
            // не пропал.
            this._commitColWidths(tableId, table);
        });

        const onMouseUp = () => teardown();
        // window blur (alt-tab/смена окна) и отмена указателя — те же ветки
        // завершения. Без них слушатели mousemove/mouseup утекали бы при
        // потерянном mouseup, и следующее взаимодействие вело бы себя неверно.
        const onInterrupt = () => teardown();

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        window.addEventListener('blur', onInterrupt);
        document.addEventListener('pointercancel', onInterrupt);
        document.addEventListener('lostpointercapture', onInterrupt);
    }

    /**
     * Фиксирует фактические пиксельные ширины колонок как целые веса colWidths,
     * помечает состояние несохранённым и перерисовывает таблицу из colWidths.
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM-элемент <table>
     * @private
     */
    _commitColWidths(tableId, tableElement) {
        const table = AppState.tables[tableId];
        if (!table) return;

        const colgroup = tableElement.querySelector('colgroup');
        if (!colgroup) return;

        const cols = Array.from(colgroup.querySelectorAll('col'));
        const prevWeights = Array.isArray(table.colWidths) ? table.colWidths : [];

        // Ширина колонки: offsetWidth <col>, иначе bounding-width заголовочной
        // ячейки этой колонки, иначе текущий вес. Не даём 0 уйти в веса (иначе
        // pixelWidthsToWeights схлопнет всё в 1 при детаче/ре-рендере).
        const pixels = cols.map((col, i) => {
            const headerCell = tableElement.querySelector(`th[data-col="${i}"]`);
            return (
                col.offsetWidth ||
                headerCell?.getBoundingClientRect().width ||
                prevWeights[i] ||
                0
            );
        });
        table.colWidths = pixelWidthsToWeights(pixels);

        if (typeof StorageManager !== 'undefined' && StorageManager.markAsUnsaved) {
            StorageManager.markAsUnsaved();
        }

        // Перерисовка из colWidths (colgroup пересоберётся из новых весов).
        ItemsRenderer.updateTable(tableId);
    }

    /**
     * Резервная оценка пиксельной ширины колонки по её доле в colWidths.
     * Нужна, когда col.offsetWidth ещё не посчитан браузером.
     * @param {HTMLElement} tableElement - DOM-элемент <table>
     * @param {number} idx - Индекс колонки
     * @returns {number} Оценка ширины в пикселях
     * @private
     */
    _colPixelWidth(tableElement, idx) {
        const section = tableElement.closest('.table-section');
        const table = section ? AppState.tables[section.dataset.tableId] : null;
        const widths = table?.colWidths || [];
        const total = widths.reduce((a, b) => a + b, 0) || widths.length || 1;
        const share = (widths[idx] || 1) / total;
        return (tableElement.offsetWidth || 1) * share;
    }
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.TableSizes = TableSizes;
