/**
 * Деривация колонок таблицы из конфигурации полей формы (доменно-агностично).
 *
 * @typedef {Object} ColumnDef
 * @property {string} key
 * @property {string} label
 * @property {string} type
 * @property {'left'|'right'|'center'} align
 * @property {function(any, Object): string} [format]
 * @property {number} width
 * @property {boolean} longText
 */

/** Дефолтные ширины (px) по типу колонки. */
export const DEFAULT_WIDTHS = {
  id: 70, number: 110, date: 110, dictionary: 90, checkbox: 80,
  text: 160, textarea: 240, 'readonly-text': 160, 'process-picker': 200,
};

function alignFor(type) {
  if (type === 'number') return 'right';
  if (type === 'checkbox') return 'center';
  return 'left';
}

/**
 * Приводит ширину поля к числу (px). Строковые значения вида '140px' парсятся;
 * при невалидном/отсутствующем значении — дефолт по типу колонки.
 * Так строковые ширины из конфига не долетают до колонки (форма читает сырой field.width отдельно).
 */
function toNum(width, type) {
  const n = typeof width === 'number' ? width : parseInt(width, 10);
  return Number.isNaN(n) ? (DEFAULT_WIDTHS[type] || DEFAULT_WIDTHS.text) : n;
}

function toColumn(field) {
  const type = field.type || 'text';
  return {
    key: field.key,
    label: field.label,
    type,
    align: alignFor(type),
    width: toNum(field.width, type),
    longText: type === 'textarea',
    description: field.description, // полное описание для tooltip (undefined — нет)
  };
}

/**
 * Раскрывает конфиг полей в плоский список (учитывает секции и row-группы).
 * Элемент может быть секцией `{section, fields:[...]}`, строкой `{row:[...]}`
 * или самим полем `{key,...}`. Секции — только верхний уровень (без вложения).
 */
export function flattenFields(fields) {
  const flat = [];
  const collect = (item) => {
    if (!item) return;
    if (Array.isArray(item.fields)) item.fields.forEach(collect); // секция
    else if (Array.isArray(item.row)) flat.push(...item.row);
    else if (item.key) flat.push(item);
  };
  for (const item of fields) collect(item);
  return flat;
}

/**
 * Построить плоский список колонок из конфигурации полей формы.
 *
 * @param {Array} fields массив полей; элемент — секция {section,fields}, {row:[...]} или поле
 * @param {Object} [opts] {extra, overrides, order}
 * @param {Array} [opts.extra] read-only колонки, добавляемые впереди
 * @param {Object} [opts.overrides] перекрытия по ключу колонки (label/align/format/filterResolve/...).
 *   Любое поле override спредится в колонку — так словарный `filterResolve` из конфига долетает как и `format`.
 * @param {string[]} [opts.order] явный порядок колонок по ключам
 * @returns {ColumnDef[]}
 */
export function buildColumns(fields, opts = {}) {
  const flat = flattenFields(fields);

  const extraCols = (opts.extra || []).map(e => ({ ...toColumn(e), ...e }));
  let cols = [...extraCols, ...flat.map(toColumn)];

  const overrides = opts.overrides || {};
  cols = cols.map(c => (overrides[c.key] ? { ...c, ...overrides[c.key] } : c));

  if (Array.isArray(opts.order)) {
    const idx = (k) => {
      const i = opts.order.indexOf(k);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    cols = cols
      .map((c, i) => [c, i])
      .sort((a, b) => (idx(a[0].key) - idx(b[0].key)) || (a[1] - b[1]))
      .map(p => p[0]);
  }

  return cols;
}

if (typeof window !== 'undefined') {
  window.buildColumns = buildColumns;
  window.flattenFields = flattenFields;
}
