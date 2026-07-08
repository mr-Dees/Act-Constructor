import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CkFinResConfig } from '../../static/js/portal/ck-fin-res/ck-fin-res-config.js';
import { flattenFields } from '../../static/js/shared/datatable/build-columns.js';

test('логический порядок: id первым, «Код метрики» вплотную к «Метрике»; групповой блок «Метрика» — по брифу', () => {
  const cols = CkFinResConfig.columns;
  const keys = cols.map(c => c.key);
  assert.equal(keys[0], 'id');
  const ci = keys.indexOf('metric_code');
  assert.equal(keys[ci + 1], 'metric_name'); // код метрики идёт сразу перед названием

  // Task 10: групповая модель — сумма-итог → развертка по ТБ → счётчики → флаги.
  const metricBlock = ['metric_code', 'metric_name', 'total_amount', 'tb_breakdown', 'total_counts', 'tb_count', 'real_loss', 'is_sent_to_top_brass', 'ck_comment'];
  const idxs = metricBlock.map(k => keys.indexOf(k));
  assert.deepEqual(idxs, [...idxs].sort((a, b) => a - b), 'блок «Метрика» должен идти в порядке брифа');

  for (const k of ['km_id', 'tb_leader', 'total_amount', 'tb_breakdown', 'deviation_description', 'num_sz', 'created_at']) {
    assert.ok(keys.includes(k), `нет колонки ${k}`);
  }
  // Физические per-ТБ поля ушли из fields вместе со старыми колонками.
  for (const k of ['metric_amount_rubles', 'metric_element_counts', 'neg_finder_tb_id']) {
    assert.ok(!keys.includes(k), `колонка ${k} должна быть удалена вместе с полем`);
  }

  // Короткие подписи групповых флагов (override).
  assert.equal(cols.find(c => c.key === 'real_loss').label, 'Реальные потери');
  assert.equal(cols.find(c => c.key === 'is_sent_to_top_brass').label, 'На НС');
});

test('metric_code → «Код метрики», metric_name → «Метрика»', () => {
  const cols = CkFinResConfig.columns;
  assert.equal(cols.find(c => c.key === 'metric_code').label, 'Код метрики');
  assert.equal(cols.find(c => c.key === 'metric_name').label, 'Метрика');
});

test('«Сумма — итого» (total_amount): align right, тип number, render — DOM без исключений', () => {
  const col = CkFinResConfig.columns.find(c => c.key === 'total_amount');
  assert.equal(col.align, 'right');
  assert.equal(col.type, 'number');
  assert.equal(typeof col.render, 'function');
  // Групповая ячейка — DOM (число + мини-бар композиции по ТБ), не строка format().
  assert.doesNotThrow(() => col.render(0, { tb_count: 0, tb_breakdown: [] }));
  assert.doesNotThrow(() => col.render(1000000, { tb_count: 2, tb_breakdown: [
    { neg_finder_tb_id: '1', metric_amount_rubles: '700000.00' },
    { neg_finder_tb_id: '4', metric_amount_rubles: '300000.00' },
  ] }));
  // Форматирование сумм — общий хелпер рендера (разделители тысяч).
  assert.match(CkFinResConfig.fmtMoney(1234567.89), /1.234.567/);
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

test('«ТБ, выявившие отклонение» (tb_breakdown): noFilter, noSort, render — чипы; пустая развертка → «—»', () => {
  const col = CkFinResConfig.columns.find(c => c.key === 'tb_breakdown');
  assert.equal(col.label, 'ТБ, выявившие отклонение');
  assert.equal(col.noFilter, true);
  assert.equal(col.noSort, true); // ключ колонки (чипы) неизвестен бэкенду — сортировка на сервере уведёт в ValueError
  assert.equal(col.width, 320);
  assert.equal(typeof col.render, 'function');
  // Описание поля формы (амаунт-развертки) переживает override — остаётся tooltip'ом колонки.
  assert.match(col.description, /финансового результата банка/);

  const empty = col.render([], { tb_breakdown: [] }, {});
  assert.equal(empty.className, 'frb-cell-chips');
  assert.equal(empty.textContent, '—');

  const list = [{ neg_finder_tb_id: '1', metric_amount_rubles: '700000.00' }];
  assert.doesNotThrow(() => col.render(list, { tb_breakdown: list }, { terbanks: [{ tb_id: 1, short_name: 'ББ' }] }));
});

test('pivot-колонки: noFilter+noSort+hidden', () => {
  const dicts = { terbanks: [{ tb_id: 1, short_name: 'ББ' }, { tb_id: 4, short_name: 'ВВБ' }] };
  const cols = CkFinResConfig.tbPivotColumns(dicts);
  assert.equal(cols.length, 2);
  for (const c of cols) {
    assert.ok(c.key.startsWith('piv:'), `ключ ${c.key} должен начинаться с piv:`);
    assert.equal(c.hidden, true);
    assert.equal(c.noFilter, true);
    assert.equal(c.noSort, true); // piv:<tb_id> — тоже неизвестен бэкенду, тот же риск ValueError
  }
});

test('ТБ-руководитель проверки (tb_leader) форматируется через terbanks; длинные тексты — longText', () => {
  const cols = CkFinResConfig.columns;
  const tb = cols.find(c => c.key === 'tb_leader');
  assert.equal(tb.label, 'ТБ-рук. проверки');
  assert.equal(tb.format(1, { terbanks: [{ tb_id: 1, short_name: 'ВВБ' }] }), 'ВВБ');
  assert.equal(cols.find(c => c.key === 'deviation_description').longText, true);
});

test('#15: каждое поле формы присутствует среди колонок (общий flattenFields)', () => {
  const colKeys = new Set(CkFinResConfig.columns.map(c => c.key));
  for (const f of flattenFields(CkFinResConfig.fields)) {
    assert.ok(colKeys.has(f.key), `поле формы ${f.key} отсутствует среди колонок`);
  }
});

test('tb_leader несёт словарный резолвер (имя ТБ → массив сырых tb_id)', () => {
  const tb = CkFinResConfig.columns.find(c => c.key === 'tb_leader');
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
