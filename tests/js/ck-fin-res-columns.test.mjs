import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CkFinResConfig } from '../../static/js/portal/ck-fin-res/ck-fin-res-config.js';
import { flattenFields } from '../../static/js/shared/datatable/build-columns.js';

test('логический порядок: id первым, «Код метрики» вплотную к «Метрике»', () => {
  const keys = CkFinResConfig.columns.map(c => c.key);
  assert.equal(keys[0], 'id');
  const ci = keys.indexOf('metric_code');
  assert.equal(keys[ci + 1], 'metric_name'); // код метрики идёт сразу перед названием
  for (const k of ['km_id', 'metric_amount_rubles', 'deviation_description', 'num_sz', 'created_at']) {
    assert.ok(keys.includes(k), `нет колонки ${k}`);
  }
});

test('metric_code → «Код метрики», metric_name → «Метрика»', () => {
  const cols = CkFinResConfig.columns;
  assert.equal(cols.find(c => c.key === 'metric_code').label, 'Код метрики');
  assert.equal(cols.find(c => c.key === 'metric_name').label, 'Метрика');
});

test('сумма: align right + формат с разделителями тысяч', () => {
  const sum = CkFinResConfig.columns.find(c => c.key === 'metric_amount_rubles');
  assert.equal(sum.align, 'right');
  assert.equal(typeof sum.format, 'function');
  assert.match(sum.format(1234567.89), /1.234.567/);
});

test('служебные колонки ID/Создано/Изменено скрыты по умолчанию; Изменено присутствует', () => {
  const cols = CkFinResConfig.columns;
  const upd = cols.find(c => c.key === 'updated_at');
  assert.ok(upd, 'нет колонки updated_at');
  assert.equal(upd.label, 'Изменено');
  for (const k of ['id', 'created_at', 'updated_at']) {
    assert.equal(cols.find(c => c.key === k).hidden, true, `${k} должна быть hidden по умолчанию`);
  }
});

test('Сумма (руб.): описание-подсказка для tooltip', () => {
  const sum = CkFinResConfig.columns.find(c => c.key === 'metric_amount_rubles');
  assert.match(sum.description, /финансового результата банка/);
});

test('ТБ форматируется через terbanks; длинные тексты — longText', () => {
  const cols = CkFinResConfig.columns;
  const tb = cols.find(c => c.key === 'neg_finder_tb_id');
  assert.equal(tb.label, 'ТБ');
  assert.equal(tb.format(1, { terbanks: [{ tb_id: 1, short_name: 'ВВБ' }] }), 'ВВБ');
  assert.equal(cols.find(c => c.key === 'deviation_description').longText, true);
});

test('#15: каждое поле формы присутствует среди колонок (общий flattenFields)', () => {
  const colKeys = new Set(CkFinResConfig.columns.map(c => c.key));
  for (const f of flattenFields(CkFinResConfig.fields)) {
    assert.ok(colKeys.has(f.key), `поле формы ${f.key} отсутствует среди колонок`);
  }
});

test('ТБ несёт словарный резолвер (имя ТБ → массив сырых tb_id)', () => {
  const tb = CkFinResConfig.columns.find(c => c.key === 'neg_finder_tb_id');
  assert.equal(tb.type, 'dictionary'); // тип сохранён → хедер-UI применит резолвер
  assert.equal(typeof tb.filterResolve, 'function');
  const dicts = { terbanks: [{ tb_id: 1, short_name: 'ВВБ' }, { tb_id: 14, short_name: 'СЗБ' }] };
  assert.deepEqual(tb.filterResolve('в', dicts), ['1']);
});

test('Дата СЗ (dt_sz) — фильтр одной датой (dateFilter=single); прочие даты — диапазон', () => {
  const dtSz = CkFinResConfig.columns.find(c => c.key === 'dt_sz');
  assert.equal(dtSz.dateFilter, 'single');
  for (const k of ['rev_start_dt', 'rev_end_dt', 'execution_deadline']) {
    const c = CkFinResConfig.columns.find(x => x.key === k);
    assert.equal(c.dateFilter, undefined, `${k} должна оставаться диапазоном`);
  }
});
