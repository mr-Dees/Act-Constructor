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
 *   {op:'contains_any', values:[...]}     — содержит любую из фраз
 *
 * Колонка может нести опциональный аксессор `filterValue(record) -> raw`,
 * которым в client-mode добывается сырое значение вместо `record[col.key]`
 * (например, когда физическое значение — массив объектов, а фильтровать нужно
 * по проекции скаляров). Для raw-массива скаляров contains/eq/in матчат, если
 * условию удовлетворяет хотя бы один элемент (см. specMatches).
 */

/**
 * Нормализация для сравнения: нижний регистр + схлопывание любых пробелов
 * (включая неразрывные из toLocaleString) к обычному.
 */
function norm(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Календарный ДЕНЬ значения в местном времени (мс локальной полуночи).
 * Дата-only строка разбирается вручную: Date.parse('YYYY-MM-DD') трактует её
 * как UTC, а 'YYYY-MM-DDTHH:MM' — как местное время; смешение ронял бы строки
 * ровно на границе диапазона. Зеркало серверного CAST(col AS DATE) —
 * сравнение диапазона дат идёт по дням, время внутри дня не участвует.
 * @returns {number} мс местной полуночи дня или NaN
 */
function dayLocal(v) {
  const s = String(v).trim();
  if (DATE_ONLY_RE.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return NaN;
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Активен ли спек (может ли реально отфильтровать). Пустой in → активен (совпадений нет). */
function specActive(spec) {
  if (!spec || !spec.op) return false;
  if (spec.op === 'in') return Array.isArray(spec.values);
  if (spec.op === 'contains_any') {
    return Array.isArray(spec.values) && spec.values.some(v => v != null && String(v).trim() !== '');
  }
  if (spec.op === 'range') {
    return (spec.from != null && spec.from !== '') || (spec.to != null && spec.to !== '');
  }
  return spec.value != null && spec.value !== '';
}

/**
 * Проходит ли сырое значение `raw` фильтр `spec`. Если `raw` — МАССИВ скаляров
 * (даёт колоночный аксессор filterValue, напр. развертка по ТБ), для
 * contains/eq/in действует семантика «хотя бы один элемент проходит скалярную
 * проверку»: рекурсивный вызов на каждом элементе переиспользует ту же логику,
 * что и для одиночного значения (String-сравнение — как для скаляров).
 * @returns {boolean}
 */
export function specMatches(raw, spec) {
  if (!spec || !spec.op) return true;
  if (Array.isArray(raw) && (spec.op === 'contains' || spec.op === 'eq' || spec.op === 'in' || spec.op === 'contains_any')) {
    return raw.some(item => specMatches(item, spec));
  }
  switch (spec.op) {
    case 'contains': {
      const q = norm(spec.value ?? '');
      if (!q) return true;
      return norm(raw == null ? '' : String(raw)).includes(q);
    }
    case 'contains_any': {
      const vals = (spec.values || []).map(v => norm(v ?? '')).filter(Boolean);
      if (!vals.length) return true;
      const hay = norm(raw == null ? '' : String(raw));
      return vals.some(q => hay.includes(q));
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
      // Даты сравниваются по КАЛЕНДАРНОМУ ДНЮ в местном времени (dayLocal):
      // и граница «по», и timestamp-значение строки попадают в день целиком —
      // как в серверном CAST(col AS DATE) >= / <=.
      const parse = spec.cast === 'date'
        ? (v) => (v == null || v === '' ? null : dayLocal(v))
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
 * Сырое значение колонки берётся через `col.filterValue(record)`, если
 * колонка его несёт; иначе — как раньше, `record[col.key]` (поведение колонок
 * без аксессора не меняется).
 * @returns {boolean}
 */
export function rowMatchesFilters(record, columns, filterMap, dicts) {
  for (const col of columns) {
    const spec = (filterMap || {})[col.key];
    if (!specActive(spec)) continue;
    const raw = typeof col.filterValue === 'function' ? col.filterValue(record) : record[col.key];
    if (!specMatches(raw, spec)) return false;
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
    // Нечисловое содержимое в числовой колонке (например, синтетический
    // групповой id «36|КМ-…») — фолбэк на строковое сравнение: NaN в
    // компараторе превращал бы сортировку в no-op.
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      return String(va ?? '').localeCompare(String(vb ?? ''), 'ru') * sign;
    }
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
