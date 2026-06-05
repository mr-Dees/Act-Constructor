/**
 * Чистое ядро контентной валидации таблиц (без DOM/AppState).
 *
 * Работает напрямую с dense-сеткой (`grid` — массив строк ячеек). Вынесено из
 * `validation-table.js`, чтобы покрыть подсчёт шапки и наличие данных unit-
 * тестами (node:test) без браузера.
 *
 * Ключевое отличие от прежней логики: шапка может занимать НЕСКОЛЬКО строк
 * подряд (как у таблицы метрик: «Код метрики» + «ФЛ»/«ЮЛ»). Считаем подряд
 * идущие сверху строки-заголовки (mirror DOCX `_header_row_count`), а данными
 * считаем всё, что ниже. Прежний код брал только ПЕРВУЮ строку-заголовок, из-за
 * чего вторая строка шапки ошибочно засчитывалась как данные (E5), а таблица
 * без шапки молча проходила (E6).
 */

/**
 * Проверяет, что сетка непустая и является массивом строк.
 * @param {Object[][]} grid
 * @returns {boolean}
 */
function isUsableGrid(grid) {
  return Array.isArray(grid) && grid.length > 0;
}

/**
 * Является ли строка строкой-заголовком (содержит хотя бы одну ячейку isHeader).
 * @param {Object[]} row
 * @returns {boolean}
 */
function isHeaderRow(row) {
  return Array.isArray(row) && row.some((cell) => cell.isHeader === true);
}

/**
 * Считает количество подряд идущих сверху строк-заголовков.
 *
 * Останавливается на первой не-заголовочной строке: заголовок, расположенный
 * ниже строк данных, в шапку не входит.
 *
 * @param {Object[][]} grid Dense-сетка.
 * @returns {number} Число строк шапки (0 — шапки нет).
 */
export function countHeaderRows(grid) {
  if (!isUsableGrid(grid)) return 0;
  let count = 0;
  for (const row of grid) {
    if (!isHeaderRow(row)) break;
    count += 1;
  }
  return count;
}

/**
 * Есть ли среди ячеек шапки (всех строк заголовка) пустые видимые ячейки.
 *
 * Поглощённые объединением ячейки (`isSpanned`) игнорируются — их содержимое
 * несёт ведущая ячейка.
 *
 * @param {Object[][]} grid Dense-сетка.
 * @returns {boolean} true — есть пустой заголовок.
 */
export function hasEmptyHeaders(grid) {
  const headerRowCount = countHeaderRows(grid);
  if (headerRowCount === 0) return false;

  for (let r = 0; r < headerRowCount; r++) {
    for (const cell of grid[r]) {
      if (!cell.isSpanned && cell.isHeader && (!cell.content || !cell.content.trim())) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Есть ли хотя бы одна заполненная строка данных под шапкой.
 *
 * Данные — всё, что ниже строк шапки. Ячейка считается заполненной, если она не
 * поглощённая и её содержимое непустое.
 *
 * @param {Object[][]} grid Dense-сетка.
 * @returns {boolean} true — данные есть.
 */
export function hasDataRows(grid) {
  if (!isUsableGrid(grid)) return false;
  const dataStartIndex = countHeaderRows(grid);

  for (let r = dataStartIndex; r < grid.length; r++) {
    for (const cell of grid[r]) {
      if (!cell.isSpanned && cell.content && cell.content.trim()) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Агрегирует контентные проблемы таблицы.
 *
 * @param {Object[][]} grid Dense-сетка.
 * @returns {{noHeader:boolean, emptyHeaders:boolean, noData:boolean}}
 *   - noHeader: нет ни одной строки-заголовка (E6);
 *   - emptyHeaders: в шапке есть пустые ячейки;
 *   - noData: под шапкой нет заполненных строк данных (E5).
 */
export function validateTableContent(grid) {
  if (!isUsableGrid(grid)) {
    return { noHeader: false, emptyHeaders: false, noData: false };
  }

  const headerRowCount = countHeaderRows(grid);
  const noHeader = headerRowCount === 0;

  return {
    noHeader,
    emptyHeaders: hasEmptyHeaders(grid),
    noData: hasDataRows(grid) === false,
  };
}

// Дублируем в window ради inline-скриптов в шаблонах (см. CLAUDE.md).
// Guard: модуль также импортируется в node:test, где window отсутствует.
if (typeof window !== 'undefined') {
  window.countHeaderRows = countHeaderRows;
  window.hasEmptyHeaders = hasEmptyHeaders;
  window.hasDataRows = hasDataRows;
  window.validateTableContent = validateTableContent;
}
