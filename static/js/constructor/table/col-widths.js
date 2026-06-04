/**
 * Чистые помощники весов колонок таблицы.
 *
 * `colWidths` — единственный источник ширины колонок: массив положительных
 * ЦЕЛЫХ относительных весов. DOCX-билдер (builders/tables.py `_compute_col_widths`)
 * нормирует их по сумме, поэтому канонический смысл — относительные веса, а не px.
 * Редактор рендерит колонки через colgroup из процентов (weight/sum*100).
 *
 * Все функции чистые (без DOM), не мутируют входные массивы и НИКОГДА не отдают
 * дробей — иначе pydantic (`colWidths: list[int]`) вернёт 422 и акт не сохранится.
 */

/**
 * Вставляет новый целый вес в позицию `index`.
 * Новый вес — округлённое среднее существующих весов (минимум 1); для пустого
 * массива — 100.
 * @param {number[]} colWidths Текущие веса колонок.
 * @param {number} index Позиция вставки.
 * @returns {number[]} Новый массив весов (целые ≥ 1).
 */
export function insertColumnWeight(colWidths, index) {
    const widths = colWidths.slice();
    let weight;
    if (widths.length === 0) {
        weight = 100;
    } else {
        const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
        weight = Math.max(1, Math.round(avg));
    }
    widths.splice(index, 0, weight);
    return widths;
}

/**
 * Удаляет вес колонки по индексу.
 * @param {number[]} colWidths Текущие веса колонок.
 * @param {number} index Индекс удаляемой колонки.
 * @returns {number[]} Новый массив весов без указанного индекса.
 */
export function removeColumnWeight(colWidths, index) {
    const widths = colWidths.slice();
    widths.splice(index, 1);
    return widths;
}

/**
 * Разделяет вес колонки `index` на два целых, в сумме равных исходному.
 * Делит как floor(w/2) и w-floor(w/2); каждый результат ≥ 1.
 * @param {number[]} colWidths Текущие веса колонок.
 * @param {number} index Индекс разделяемой колонки.
 * @returns {number[]} Новый массив весов длиной +1 (целые ≥ 1).
 */
export function splitColumnWeight(colWidths, index) {
    const widths = colWidths.slice();
    const original = Math.max(2, widths[index] || 2);
    const first = Math.max(1, Math.floor(original / 2));
    const second = Math.max(1, original - first);
    widths.splice(index, 1, first, second);
    return widths;
}

/**
 * Пересчитывает веса в проценты (weight/sum*100) для colgroup редактора.
 * При пустом массиве — пустой массив; при нулевой сумме — делит поровну.
 * @param {number[]} colWidths Веса колонок.
 * @returns {number[]} Проценты, в сумме ≈ 100.
 */
export function colWidthsToPercents(colWidths) {
    const n = colWidths.length;
    if (n === 0) return [];
    const total = colWidths.reduce((a, b) => a + b, 0);
    if (total <= 0) {
        return new Array(n).fill(100 / n);
    }
    return colWidths.map((w) => (w / total) * 100);
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
// Guard: модуль также импортируется в node:test, где window отсутствует.
if (typeof window !== 'undefined') {
    window.insertColumnWeight = insertColumnWeight;
    window.removeColumnWeight = removeColumnWeight;
    window.splitColumnWeight = splitColumnWeight;
    window.colWidthsToPercents = colWidthsToPercents;
}
