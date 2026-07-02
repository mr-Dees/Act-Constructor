/**
 * Чистая логика таблицы: фильтрация (по СЫРОМУ значению ячейки, типизированный
 * контракт FilterSpec), типо-осознанная сортировка, пагинация. Без DOM —
 * полностью юнит-тестируемо.
 *
 * Канон фильтра — СЫРЬЁ: клиент и сервер сопоставляют одно и то же сырое
 * значение (адаптацию под тип — словарь имя→id, дата от/до, деньги — делает
 * слой представления, а сюда приходит уже готовый FilterSpec). Это убирает
 * расхождение client-mode ↔ server-mode.
 *
 * FilterSpec (по одной на колонку):
 *   {op:'contains', value}                — подстрока по сырому тексту
 *   {op:'eq',       value}                — точное равенство по сырому тексту
 *   {op:'in',       values:[...]}         — членство по сырым значениям (словари)
 *   {op:'range',    from?, to?, cast}     — диапазон (cast: 'date' | 'numeric')
 */

/**
 * Нормализация для сравнения: нижний регистр + схлопывание любых пробелов
 * (включая неразрывные из toLocaleString) к обычному.
 */
function norm(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Активен ли спек (может ли реально отфильтровать). Пустой in → активен (совпадений нет). */
function specActive(spec) {
  if (!spec || !spec.op) return false;
  if (spec.op === 'in') return Array.isArray(spec.values);
  if (spec.op === 'range') {
    return (spec.from != null && spec.from !== '') || (spec.to != null && spec.to !== '');
  }
  return spec.value != null && spec.value !== '';
}

/**
 * Проходит ли сырое значение `raw` фильтр `spec`.
 * @returns {boolean}
 */
export function specMatches(raw, spec) {
  if (!spec || !spec.op) return true;
  switch (spec.op) {
    case 'contains': {
      const q = norm(spec.value ?? '');
      if (!q) return true;
      return norm(raw == null ? '' : String(raw)).includes(q);
    }
    case 'eq': {
      if (spec.value == null || spec.value === '') return true;
      return String(raw ?? '') === String(spec.value);
    }
    case 'in': {
      const vals = (spec.values || []).map(String);
      return vals.includes(String(raw ?? ''));
    }
    case 'range': {
      const parse = spec.cast === 'date'
        ? (v) => (v == null || v === '' ? null : Date.parse(v))
        : (v) => (v == null || v === '' ? null : Number(v));
      const r = parse(raw);
      const f = parse(spec.from);
      const t = parse(spec.to);
      if (r == null || Number.isNaN(r)) return f == null && t == null; // нет значения — только если нет границ
      if (f != null && !Number.isNaN(f) && !(r >= f)) return false;
      if (t != null && !Number.isNaN(t) && !(r <= t)) return false;
      return true;
    }
    default:
      return true;
  }
}

/**
 * Проходит ли запись ВСЕ активные фильтры (комбинируются по И).
 * `filterMap` — dict[colKey → FilterSpec]. `dicts` не используется (адаптация
 * уже произведена при построении спека) — параметр сохранён для совместимости.
 * @returns {boolean}
 */
export function rowMatchesFilters(record, columns, filterMap, dicts) {
  for (const col of columns) {
    const spec = (filterMap || {})[col.key];
    if (!specActive(spec)) continue;
    if (!specMatches(record[col.key], spec)) return false;
  }
  return true;
}

export function filterRows(rows, columns, filterMap, dicts) {
  const active = Object.values(filterMap || {}).some(specActive);
  if (!active) return rows.slice();
  return rows.filter(r => rowMatchesFilters(r, columns, filterMap, dicts));
}

/** Типы, которые сравниваются как числа (id — тоже число, иначе '10' < '2'). */
const NUMERIC_TYPES = new Set(['number', 'id']);

/**
 * Сравнение двух записей по ОДНОЙ колонке с учётом типа и направления.
 * Числовые типы — численно, дата — хронологически, остальное (в т.ч. словарь)
 * — строкой по СЫРОМУ значению (согласовано с серверным ORDER BY col).
 * @returns {number} <0 / 0 / >0
 */
export function compareBy(a, b, column, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  const va = a[column.key];
  const vb = b[column.key];
  if (NUMERIC_TYPES.has(column.type)) {
    const na = va == null || va === '' ? -Infinity : Number(va);
    const nb = vb == null || vb === '' ? -Infinity : Number(vb);
    return (na - nb) * sign;
  }
  if (column.type === 'date') {
    const da = va ? Date.parse(va) : NaN;
    const db = vb ? Date.parse(vb) : NaN;
    const na = Number.isNaN(da) ? -Infinity : da;
    const nb = Number.isNaN(db) ? -Infinity : db;
    return (na - nb) * sign;
  }
  return String(va ?? '').localeCompare(String(vb ?? ''), 'ru') * sign;
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
  Object.assign(window, { rowMatchesFilters, filterRows, specMatches, compareBy, sortRows, sortRowsMulti, paginate });
}
