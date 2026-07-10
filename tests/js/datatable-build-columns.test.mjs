import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildColumns, DEFAULT_WIDTHS } from '../../static/js/shared/datatable/build-columns.js';

const fields = [
  { key: 'metric_code', label: 'Метрика', type: 'dictionary' },
  { row: [
    { key: 'num_sz', label: '№ с/з', type: 'text' },
    { key: 'metric_amount_rubles', label: 'Сумма (руб.)', type: 'number' },
  ] },
  { key: 'deviation_description', label: 'Описание', type: 'textarea' },
];

test('разворачивает row-группы в плоский список', () => {
  const cols = buildColumns(fields);
  assert.deepEqual(cols.map(c => c.key),
    ['metric_code', 'num_sz', 'metric_amount_rubles', 'deviation_description']);
});

test('number → align right, textarea → longText', () => {
  const cols = buildColumns(fields);
  const sum = cols.find(c => c.key === 'metric_amount_rubles');
  assert.equal(sum.align, 'right');
  assert.equal(cols.find(c => c.key === 'deviation_description').longText, true);
});

test('extra-колонки идут впереди', () => {
  const cols = buildColumns(fields, { extra: [{ key: 'id', label: 'ID', type: 'id' }] });
  assert.equal(cols[0].key, 'id');
});

test('overrides перекрывают label/align/format', () => {
  const fmt = v => `#${v}`;
  const cols = buildColumns(fields, { overrides: { metric_code: { label: 'Код метрики', format: fmt } } });
  const c = cols.find(x => x.key === 'metric_code');
  assert.equal(c.label, 'Код метрики');
  assert.equal(c.format(7), '#7');
});

test('order переупорядочивает колонки', () => {
  const cols = buildColumns(fields, { order: ['deviation_description', 'metric_code'] });
  assert.equal(cols[0].key, 'deviation_description');
  assert.equal(cols[1].key, 'metric_code');
});

test('description поля пробрасывается в колонку (для tooltip)', () => {
  const cols = buildColumns([{ key: 'x', label: 'X', type: 'number', description: 'Полное описание X' }]);
  assert.equal(cols.find(c => c.key === 'x').description, 'Полное описание X');
});

test('ширина по типу из DEFAULT_WIDTHS, поле.width перекрывает', () => {
  const cols = buildColumns([
    { key: 'd', label: 'D', type: 'date' },
    { key: 'w', label: 'W', type: 'text', width: 333 },
  ]);
  assert.equal(cols[0].width, DEFAULT_WIDTHS.date);
  assert.equal(cols[1].width, 333);
});

test('#1 строковая ширина «140px» приводится к числу', () => {
  const cols = buildColumns([{ key: 's', label: 'S', type: 'text', width: '140px' }]);
  const c = cols.find(x => x.key === 's');
  assert.strictEqual(c.width, 140);
  assert.equal(typeof c.width, 'number');
});

test('#1 невалидная/битая ширина → дефолт по типу', () => {
  const cols = buildColumns([
    { key: 'x', label: 'X', type: 'date', width: 'abc' },
    { key: 'y', label: 'Y', type: 'number', width: undefined },
  ]);
  assert.equal(cols.find(c => c.key === 'x').width, DEFAULT_WIDTHS.date);
  assert.equal(cols.find(c => c.key === 'y').width, DEFAULT_WIDTHS.number);
});

test('#2 filterResolve пробрасывается в колонку через overrides (как format)', () => {
  const resolve = (q) => [String(q)];
  const cols = buildColumns(fields, { overrides: { metric_code: { filterResolve: resolve } } });
  const c = cols.find(x => x.key === 'metric_code');
  assert.equal(typeof c.filterResolve, 'function');
  assert.deepEqual(c.filterResolve('7', {}), ['7']);
});

test('#2 filterResolve пробрасывается на extra-колонке', () => {
  const resolve = () => ['x'];
  const cols = buildColumns(fields, { extra: [{ key: 'id', label: 'ID', type: 'id', filterResolve: resolve }] });
  assert.equal(typeof cols.find(c => c.key === 'id').filterResolve, 'function');
});

test('checkbox без override → дефолтный format «Да»/«Нет», пусто для null', () => {
  const cols = buildColumns([{ key: 'flag', label: 'Флаг', type: 'checkbox' }]);
  const c = cols.find(x => x.key === 'flag');
  assert.equal(typeof c.format, 'function');
  assert.equal(c.format(true), 'Да');
  assert.equal(c.format(false), 'Нет');
  assert.equal(c.format(null), '');
});

test('checkbox с явным format в overrides → используется явный', () => {
  const fmt = () => 'кастом';
  const cols = buildColumns(
    [{ key: 'flag', label: 'Флаг', type: 'checkbox' }],
    { overrides: { flag: { format: fmt } } },
  );
  assert.equal(cols.find(c => c.key === 'flag').format, fmt);
});

// ── Группы колонок из секций формы (Задача 5) ───────────────────────────────

const sectionedFields = [
  { section: 'Метрика', key: 'metric', fields: [
    { key: 'metric_code', label: 'Метрика', type: 'dictionary' },
  ] },
  { section: 'Прочее', key: 'misc', fields: [
    { key: 'deviation_description', label: 'Описание', type: 'textarea' },
  ] },
];

test('колонка из секции формы получает group = имя секции', () => {
  const cols = buildColumns(sectionedFields);
  assert.equal(cols.find(c => c.key === 'metric_code').group, 'Метрика');
  assert.equal(cols.find(c => c.key === 'deviation_description').group, 'Прочее');
});

test('плоский конфиг без секций — group не выставляется ни одной колонке', () => {
  const cols = buildColumns(fields); // fields сверху файла — без секций
  assert.ok(cols.every(c => c.group === undefined));
});

test('extra-колонка с явным group сохраняет его (секции его не перекрывают)', () => {
  const cols = buildColumns(sectionedFields, {
    extra: [{ key: 'id', label: 'ID', type: 'id', group: 'Служебные' }],
  });
  assert.equal(cols.find(c => c.key === 'id').group, 'Служебные');
});

test('override с group перекрывает секционный', () => {
  const cols = buildColumns(sectionedFields, {
    overrides: { metric_code: { group: 'Другая группа' } },
  });
  assert.equal(cols.find(c => c.key === 'metric_code').group, 'Другая группа');
});
