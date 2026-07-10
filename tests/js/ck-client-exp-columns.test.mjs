import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CkClientExpConfig } from '../../static/js/portal/ck-client-exp/ck-client-exp-config.js';
import { flattenFields } from '../../static/js/shared/datatable/build-columns.js';

test('логический порядок: id в хвосте после reestr_metric_id (группы панели без «дребезга»); «Код метрики» вплотную к «Метрике»', () => {
  const keys = CkClientExpConfig.columns.map(c => c.key);
  const idIdx = keys.indexOf('id');
  assert.equal(keys[idIdx - 1], 'reestr_metric_id');
  assert.equal(keys[idIdx + 1], 'created_at');
  const ci = keys.indexOf('metric_code');
  assert.equal(keys[ci + 1], 'metric_name'); // код метрики идёт сразу перед названием
  for (const k of ['km_id', 'metric_amount_rubles', 'metric_unic_clients', 'num_sz', 'created_at']) {
    assert.ok(keys.includes(k), `нет колонки ${k}`);
  }
});

test('metric_code → «Код метрики», metric_name → «Метрика»', () => {
  const cols = CkClientExpConfig.columns;
  assert.equal(cols.find(c => c.key === 'metric_code').label, 'Код метрики');
  assert.equal(cols.find(c => c.key === 'metric_name').label, 'Метрика');
});

test('сумма: align right + формат с разделителями тысяч', () => {
  const sum = CkClientExpConfig.columns.find(c => c.key === 'metric_amount_rubles');
  assert.equal(sum.align, 'right');
  assert.equal(typeof sum.format, 'function');
  assert.match(sum.format(1234567.89), /1.234.567/);
});

test('metric_unic_clients присутствует как колонка с align right', () => {
  const col = CkClientExpConfig.columns.find(c => c.key === 'metric_unic_clients');
  assert.ok(col, 'нет колонки metric_unic_clients');
  assert.equal(col.align, 'right');
});

test('служебные колонки ID/Создано/Изменено скрыты по умолчанию; Изменено присутствует', () => {
  const cols = CkClientExpConfig.columns;
  const upd = cols.find(c => c.key === 'updated_at');
  assert.ok(upd, 'нет колонки updated_at');
  assert.equal(upd.label, 'Изменено');
  for (const k of ['id', 'created_at', 'updated_at']) {
    assert.equal(cols.find(c => c.key === k).hidden, true, `${k} должна быть hidden по умолчанию`);
  }
});

test('ТБ форматируется через terbanks', () => {
  const tb = CkClientExpConfig.columns.find(c => c.key === 'neg_finder_tb_id');
  assert.equal(tb.label, 'ТБ');
  assert.equal(tb.format(1, { terbanks: [{ tb_id: 1, short_name: 'ВВБ' }] }), 'ВВБ');
});

test('#15: каждое поле формы присутствует среди колонок (общий flattenFields)', () => {
  const colKeys = new Set(CkClientExpConfig.columns.map(c => c.key));
  for (const f of flattenFields(CkClientExpConfig.fields)) {
    assert.ok(colKeys.has(f.key), `поле формы ${f.key} отсутствует среди колонок`);
  }
});

test('ТБ несёт словарный резолвер (имя ТБ → массив сырых tb_id)', () => {
  const tb = CkClientExpConfig.columns.find(c => c.key === 'neg_finder_tb_id');
  assert.equal(tb.type, 'dictionary'); // тип сохранён → хедер-UI применит резолвер
  assert.equal(typeof tb.filterResolve, 'function');
  const dicts = { terbanks: [{ tb_id: 1, short_name: 'ВВБ' }, { tb_id: 14, short_name: 'СЗБ' }] };
  assert.deepEqual(tb.filterResolve('в', dicts), ['1']);
});

test('Дата СЗ (dt_sz) — фильтр одной датой (dateFilter=single)', () => {
  const dtSz = CkClientExpConfig.columns.find(c => c.key === 'dt_sz');
  assert.equal(dtSz.dateFilter, 'single');
});

// --- Задача 7: группы колонок панели видимости и типовые дефолты фильтров ---

test('группы extra-колонок: id/created_at/updated_at → «Системное», metric_name → «Метрика», act_sub_number → «Идентификация»', () => {
  const byKey = Object.fromEntries(CkClientExpConfig.columns.map((c) => [c.key, c]));
  for (const k of ['id', 'created_at', 'updated_at']) {
    assert.equal(byKey[k].group, 'Системное', `${k}.group должен быть «Системное»`);
  }
  assert.equal(byKey.metric_name.group, 'Метрика');
  assert.equal(byKey.act_sub_number.group, 'Идентификация');
});

test('группы полевых колонок наследуются из секций формы: km_id → «Идентификация», process_number → «Процесс и владельцы», metric_code → «Метрика», reestr_metric_id → «Системное»', () => {
  const byKey = Object.fromEntries(CkClientExpConfig.columns.map((c) => [c.key, c]));
  assert.equal(byKey.km_id.group, 'Идентификация');
  assert.equal(byKey.process_number.group, 'Процесс и владельцы');
  assert.equal(byKey.metric_code.group, 'Метрика');
  assert.equal(byKey.reestr_metric_id.group, 'Системное');
});

test('порядок групп панели видимости — без «дребезга» (группа не появляется повторно после другой)', () => {
  let last = null;
  const seq = [];
  for (const c of CkClientExpConfig.columns) {
    const g = c.group || null;
    if (g && g !== last) seq.push(g);
    last = g;
  }
  assert.deepEqual(seq, ['Идентификация', 'Процесс и владельцы', 'Метрика', 'Системное']);
  assert.equal(new Set(seq).size, seq.length, 'ни одна группа не должна повторяться');
});

test('is_sent_to_top_brass (checkbox): формат «Да»/«Нет»/пусто — дефолт тулкита, override в CS не задан', () => {
  const col = CkClientExpConfig.columns.find((c) => c.key === 'is_sent_to_top_brass');
  assert.equal(col.type, 'checkbox');
  assert.equal(col.format(true), 'Да');
  assert.equal(col.format(false), 'Нет');
  assert.equal(col.format(null), '');
});

test('metric_amount_rubles: type number без filterPicker/noFilter — диапазон включится дефолтом тулкита', () => {
  const col = CkClientExpConfig.columns.find((c) => c.key === 'metric_amount_rubles');
  assert.equal(col.type, 'number');
  assert.equal(col.filterPicker, undefined);
  assert.equal(col.noFilter, undefined);
});

test('neg_finder_tb_id несёт filterResolve — одиночный текстовый инпут вместо чекбокс-пикера', () => {
  const col = CkClientExpConfig.columns.find((c) => c.key === 'neg_finder_tb_id');
  assert.equal(typeof col.filterResolve, 'function');
  assert.equal(col.filterPicker, undefined);
});
