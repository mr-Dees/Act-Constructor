/**
 * Чистая логика таблицы: фильтрация (по ОТОБРАЖАЕМОМУ значению ячейки),
 * сортировка с учётом типа, пагинация. Без DOM — полностью юнит-тестируемо.
 */

function displayValue(record, column, dicts) {
  const raw = record[column.key];
  if (column.format) return column.format(raw, dicts || {});
  return raw == null ? '' : String(raw);
}

/**
 * Нормализация для сравнения: нижний регистр + схлопывание любых пробелов
 * (включая неразрывные  /  из toLocaleString) к обычному. Иначе
 * фильтр по числу «1 234» не нашёл бы «1 234,50» с неразрывным разделителем.
 */
function norm(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Проходит ли запись ВСЕ непустые фильтры (комбинируются по И).
 * @returns {boolean}
 */
export function rowMatchesFilters(record, columns, filterMap, dicts) {
  for (const col of columns) {
    const q = norm(filterMap[col.key] || '');
    if (!q) continue;
    if (!norm(displayValue(record, col, dicts)).includes(q)) return false;
  }
  return true;
}

export function filterRows(rows, columns, filterMap, dicts) {
  const active = Object.values(filterMap || {}).some(v => (v || '').trim());
  if (!active) return rows.slice();
  return rows.filter(r => rowMatchesFilters(r, columns, filterMap, dicts));
}

/**
 * Сравнение двух записей по ОДНОЙ колонке с учётом типа и направления.
 * @returns {number} <0 / 0 / >0
 */
export function compareBy(a, b, column, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  const isNum = column.type === 'number';
  const va = a[column.key] ?? (isNum ? 0 : '');
  const vb = b[column.key] ?? (isNum ? 0 : '');
  if (isNum) return (Number(va) - Number(vb)) * sign;
  return String(va).localeCompare(String(vb), 'ru') * sign;
}

/**
 * Многоколоночная сортировка: `specs` — упорядоченный по приоритету список
 * `{column, dir}`. Сравнение идёт по колонкам слева направо: следующая колонка
 * учитывается только при равенстве по предыдущим (как ORDER BY c1, c2, …).
 */
export function sortRowsMulti(rows, specs) {
  const list = (specs || []).filter(s => s && s.column);
  if (!list.length) return rows.slice();
  return rows.slice().sort((a, b) => {
    for (const { column, dir } of list) {
      const c = compareBy(a, b, column, dir);
      if (c !== 0) return c;
    }
    return 0;
  });
}

/** Одноколоночная сортировка (обёртка над sortRowsMulti). */
export function sortRows(rows, column, dir) {
  return sortRowsMulti(rows, [{ column, dir }]);
}

export function paginate(rows, page, pageSize) {
  if (!pageSize || pageSize <= 0) return { pageRows: rows.slice(), totalPages: 1 };
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  const start = (p - 1) * pageSize;
  return { pageRows: rows.slice(start, start + pageSize), totalPages };
}

if (typeof window !== 'undefined') {
  Object.assign(window, { rowMatchesFilters, filterRows, compareBy, sortRows, sortRowsMulti, paginate });
}
