/**
 * Форматирование размеров данных (байты → человекочитаемый вид).
 *
 * Единый источник для конструктора (картинки нарушений, буфер обмена дерева)
 * и чата — раньше та же арифметика была продублирована тремя копиями.
 */

/**
 * Байты → мегабайты с одной десятичной цифрой, без хвостового «.0».
 *
 * @param {number} bytes
 * @returns {string} например «1.5» или «2»
 */
export function formatMb(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '');
}

/**
 * Байты → человекочитаемый размер с единицей (Б / КБ / МБ).
 *
 * @param {number} bytes
 * @returns {string} например «512 Б», «1.5 КБ», «2.0 МБ»
 */
export function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}
