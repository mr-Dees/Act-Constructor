/**
 * Выравнивание объединённых по горизонтали ячеек шапки таблицы.
 *
 * Зеркало серверного набора styles.py::CENTERED_MERGED_HEADER_TEXTS — при правке
 * формулировок шапок в шаблонах таблиц СИНХРОНИЗИРОВАТЬ оба места вручную
 * (импорт из Python невозможен; та же договорённость, что и names.py↔frontend).
 *
 * Правило (совпадает с DOCX-билдером _fill_cell):
 *   - не шапка → null (спец-выравнивание не применяется);
 *   - одиночная ячейка шапки (colSpan ≤ 1) → 'center';
 *   - объединённая шапка (colSpan > 1): 'center', если текст в centered-наборе,
 *     иначе 'left'.
 */

/** Тексты объединённых шапок, которые ОСТАЮТСЯ по центру (зеркало styles.py). */
export const CENTERED_MERGED_HEADER_TEXTS = new Set([
    'Количество клиентов / элементов, ед.',
]);

/** Нормализация как _normalize_text в Python: схлоп пробелов + trim. */
function normalizeHeaderText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Возвращает выравнивание для ячейки шапки: 'left' | 'center' | null.
 * @param {string} content Текст ячейки.
 * @param {number} colSpan Горизонтальное объединение (число колонок).
 * @param {boolean} isHeader Является ли ячейка заголовочной.
 * @returns {('left'|'center'|null)}
 */
export function mergedHeaderAlign(content, colSpan, isHeader) {
    if (!isHeader) return null;
    if (!(colSpan > 1)) return 'center';
    return CENTERED_MERGED_HEADER_TEXTS.has(normalizeHeaderText(content)) ? 'center' : 'left';
}

// Window-globals для inline-скриптов (guard для node:test, где window нет).
if (typeof window !== 'undefined') {
    window.CENTERED_MERGED_HEADER_TEXTS = CENTERED_MERGED_HEADER_TEXTS;
    window.mergedHeaderAlign = mergedHeaderAlign;
}
