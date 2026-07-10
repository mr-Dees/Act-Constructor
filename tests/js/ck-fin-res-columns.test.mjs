import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CkFinResConfig } from '../../static/js/portal/ck-fin-res/ck-fin-res-config.js';
import { CkFinResPage } from '../../static/js/portal/ck-fin-res/ck-fin-res-page.js';
import { flattenFields } from '../../static/js/shared/datatable/build-columns.js';

/**
 * _browser-stub.mjs даёт document.createElement с no-op appendChild — вложенность
 * (родитель→дети) не трекается, поэтому wrap.textContent/querySelector не видят
 * дочерние узлы. Для рендеров вида «div-обёртка + дочерние div/span» (renderAmountTotal,
 * renderBreakdownChips) перехватываем createElement на время рендера и проверяем
 * сами созданные узлы (className/textContent/style), а не их привязку к родителю.
 */
function captureCreatedElements(fn) {
  const created = [];
  const orig = document.createElement;
  document.createElement = (tag) => {
    const el = orig(tag);
    created.push(el);
    return el;
  };
  try {
    return { result: fn(), created };
  } finally {
    document.createElement = orig;
  }
}

test('логический порядок: id первым, «Код метрики» вплотную к «Метрике»; групповой блок «Метрика» — по брифу', () => {
  const cols = CkFinResConfig.columns;
  const keys = cols.map(c => c.key);
  assert.equal(keys[0], 'id');
  const ci = keys.indexOf('metric_code');
  assert.equal(keys[ci + 1], 'metric_name'); // код метрики идёт сразу перед названием

  // Task 10: групповая модель — сумма-итог → развертка по ТБ → счётчики → флаги.
  // Task 6 (цикл 2): total_npl_amount встаёт сразу после total_amount.
  const metricBlock = ['metric_code', 'metric_name', 'total_amount', 'total_npl_amount', 'tb_breakdown', 'total_counts', 'tb_count', 'real_loss', 'is_sent_to_top_brass', 'ck_comment'];
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

test('renderAmountTotal (total_amount): «не распределено» без минибара при tb_count=0; число + минибар с исходным title при tb_count>0 — рефактор без визуальной регрессии', () => {
  const col = CkFinResConfig.columns.find(c => c.key === 'total_amount');
  const empty = captureCreatedElements(() => col.render(0, { tb_count: 0, tb_breakdown: [] }));
  assert.ok(!empty.created.some(el => el.className === 'frb-cell-minibar'), 'без распределения минибара быть не должно');
  const emptyNum = empty.created.find(el => el.className === 'frb-cell-total');
  assert.equal(emptyNum.textContent, 'не распределено');

  const list = [
    { neg_finder_tb_id: '1', metric_amount_rubles: '700000.00' },
    { neg_finder_tb_id: '4', metric_amount_rubles: '300000.00' },
  ];
  const full = captureCreatedElements(() => col.render(1000000, { tb_count: 2, tb_breakdown: list }));
  const fullNum = full.created.find(el => el.className === 'frb-cell-total');
  assert.match(fullNum.textContent, /1.000.000,00/);
  const segs = full.created.filter(el => el.style && el.style.width);
  assert.equal(segs.length, 2, 'по сегменту на каждый элемент развертки');
  assert.match(segs[0].title, /ББ — 700.000,00 ₽/);
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

test('«ТБ, выявившие отклонение» (tb_breakdown): чекбокс-фильтр, noSort, render — чипы; пустая развертка → «—»', () => {
  const col = CkFinResConfig.columns.find(c => c.key === 'tb_breakdown');
  assert.equal(col.label, 'ТБ, выявившие отклонение');
  // Фильтр «группа содержит такой ТБ» включён: спек op=in уходит на бэк под
  // ключом tb_breakdown (membership-алиас, HAVING — итоги группы не искажаются).
  assert.equal(col.noFilter, undefined);
  assert.equal(col.type, 'dictionary');
  // Текстовый словарный резолвер снят (Task 6, цикл 2) — фильтр теперь
  // чекбокс-пикер по col.filterOptions (состав/label/short — отдельный тест).
  assert.equal(col.filterResolve, undefined);
  assert.equal(col.filterPicker, 'checkbox');
  // filterValue — аксессор сырого значения для client-mode: record.tb_breakdown —
  // массив объектов, а фильтровать нужно по массиву голых tb_id (см. datatable-logic).
  assert.equal(typeof col.filterValue, 'function');
  assert.deepEqual(col.filterValue({ tb_breakdown: [{ neg_finder_tb_id: 7 }, { neg_finder_tb_id: 8 }] }), ['7', '8']);
  assert.deepEqual(col.filterValue({ tb_breakdown: [] }), []);
  assert.deepEqual(col.filterValue({}), []); // нет развертки — не падает
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

test('Кол-во ТБ (tb_count): noFilter — агрегат без строкового фильтра, сортировка остаётся', () => {
  const col = CkFinResConfig.columns.find(c => c.key === 'tb_count');
  assert.equal(col.noFilter, true); // ключа tb_count нет в ALLOWED_COLUMNS бэка — фильтр молча игнорировался бы
  assert.equal(col.noSort, undefined); // сортировка по COUNT(*) поддержана бэком (AGG_SORT_EXPR)
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

test('tbPivotColumns(dicts, {keyPrefix, breakdownField, labelSuffix}): pivnpl-пара — суффикс в label, описание с «NPL 90+», рендер из своего breakdownField', () => {
  const dicts = { terbanks: [{ tb_id: 14, short_name: 'ЦА', full_name: 'Центральный аппарат' }] };
  const sumCols = CkFinResConfig.tbPivotColumns(dicts);
  const nplCols = CkFinResConfig.tbPivotColumns(dicts, { keyPrefix: 'pivnpl', breakdownField: 'npl_breakdown', labelSuffix: ' · NPL' });
  assert.equal(sumCols[0].key, 'piv:14');
  assert.equal(sumCols[0].label, 'ЦА');
  assert.equal(nplCols[0].key, 'pivnpl:14');
  assert.equal(nplCols[0].label, 'ЦА · NPL');
  assert.match(nplCols[0].description, /NPL 90\+/);
  for (const c of nplCols) {
    assert.equal(c.hidden, true);
    assert.equal(c.noFilter, true);
    assert.equal(c.noSort, true);
  }

  // Рендер pivnpl-колонки берёт значение из npl_breakdown записи, а не tb_breakdown.
  const record = {
    tb_breakdown: [{ neg_finder_tb_id: '14', metric_amount_rubles: '999999.00' }],
    npl_breakdown: [{ neg_finder_tb_id: '14', metric_amount_rubles: '55000.00' }],
  };
  assert.match(nplCols[0].render(null, record).textContent, /55.000,00/);
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

test('NPL_METRIC_CODES содержит 602', () => {
  assert.ok(CkFinResConfig.NPL_METRIC_CODES.has('602'));
});

test('в полях формы есть npl_breakdown типа amount-breakdown с подсказкой про 602, сразу после tb_breakdown', () => {
  const flat = flattenFields(CkFinResConfig.fields);
  const f = flat.find((x) => x.key === 'npl_breakdown');
  assert.ok(f, 'поле npl_breakdown должно быть в конфиге формы');
  assert.equal(f.type, 'amount-breakdown');
  assert.match(f.description, /602/);
  assert.ok(!f.required);
  const idx = flat.findIndex((x) => x.key === 'npl_breakdown');
  const tbIdx = flat.findIndex((x) => x.key === 'tb_breakdown');
  assert.equal(idx, tbIdx + 1, 'npl_breakdown должно идти сразу после tb_breakdown');
});

test('«NPL 90+ по ТБ» (npl_breakdown): чекбокс-фильтр, noSort, render — чипы (полная симметрия с tb_breakdown); пустая развертка → «—»', () => {
  const col = CkFinResConfig.columns.find((c) => c.key === 'npl_breakdown');
  assert.ok(col, 'колонка npl_breakdown должна существовать (#15 — каждое поле формы среди колонок)');
  assert.equal(col.label, 'NPL 90+ по ТБ');
  assert.notEqual(col.hidden, true, 'колонка полноценная — видна по умолчанию, не служебная заглушка');
  assert.equal(col.noFilter, undefined);
  assert.equal(col.type, 'dictionary');
  assert.equal(col.filterPicker, 'checkbox');
  assert.equal(col.filterOptions.length, 12);
  assert.deepEqual(
    new Set(col.filterOptions.map((o) => o.value)),
    new Set(Object.keys(CkFinResConfig.TB_ABBR)),
  );
  assert.equal(typeof col.filterValue, 'function');
  assert.deepEqual(col.filterValue({ npl_breakdown: [{ neg_finder_tb_id: 7 }, { neg_finder_tb_id: 8 }] }), ['7', '8']);
  assert.deepEqual(col.filterValue({ npl_breakdown: [] }), []);
  assert.deepEqual(col.filterValue({}), []); // нет развертки — не падает
  assert.equal(col.noSort, true); // ключ колонки (чипы) неизвестен бэкенду — сортировка на сервере уведёт в ValueError
  assert.equal(col.width, 260);
  assert.match(col.description, /602/); // унаследовано от поля формы, override его не трогает

  const empty = col.render([], { npl_breakdown: [] }, {});
  assert.equal(empty.className, 'frb-cell-chips');
  assert.equal(empty.textContent, '—');

  const list = [{ neg_finder_tb_id: '7', metric_amount_rubles: '120000.00' }];
  const full = captureCreatedElements(() => col.render(list, { npl_breakdown: list }, { terbanks: [{ tb_id: 7, short_name: 'МБ' }] }));
  assert.ok(full.created.some((el) => el.className === 'frb-chip'), 'непустая развертка должна давать чипы');
});

// --- Task 6 (цикл 2): подключение фильтров-попапов и колонки total_npl_amount ---

test('tb_breakdown: чекбокс-фильтр по словарю ТБ (12 опций, short=аббревиатура)', () => {
  const col = CkFinResConfig.columns.find((c) => c.key === 'tb_breakdown');
  assert.equal(col.filterPicker, 'checkbox');
  assert.equal(col.filterOptions.length, 12);
  assert.ok(col.filterOptions.every((o) => o.value && o.label.includes('—') && o.short));
  // Набор value — ровно tb_id из TB_ABBR (тот же фиксированный список ТБ, что у палитры/аббревиатур).
  assert.deepEqual(
    new Set(col.filterOptions.map((o) => o.value)),
    new Set(Object.keys(CkFinResConfig.TB_ABBR)),
  );
  const vvb = col.filterOptions.find((o) => o.value === '4');
  assert.equal(vvb.short, 'ВВБ');
  assert.match(vvb.label, /^ВВБ — .+/);
});

test('total_amount и total_npl_amount: диапазон-фильтр (filterPicker numrange)', () => {
  const cols = CkFinResConfig.columns;
  const colTotal = cols.find((c) => c.key === 'total_amount');
  const colNpl = cols.find((c) => c.key === 'total_npl_amount');
  assert.equal(colTotal.filterPicker, 'numrange');
  assert.equal(colNpl.filterPicker, 'numrange');
});

test('total_npl_amount: render — «—» без минибара при пустой развертке; сумма + минибар при непустой (симметрично total_amount)', () => {
  const col = CkFinResConfig.columns.find((c) => c.key === 'total_npl_amount');
  assert.equal(typeof col.render, 'function');

  const empty = captureCreatedElements(() => col.render(0, {}));
  assert.ok(!empty.created.some((el) => el.className === 'frb-cell-minibar'), 'без развертки минибара быть не должно');
  const emptyNum = empty.created.find((el) => el.className === 'frb-cell-total');
  assert.equal(emptyNum.textContent, '—');

  const list = [{ neg_finder_tb_id: '7', metric_amount_rubles: '120000.50' }];
  const full = captureCreatedElements(() => col.render(120000.5, { npl_breakdown: list }));
  const fullNum = full.created.find((el) => el.className === 'frb-cell-total');
  assert.match(fullNum.textContent, /120.000,50/);
  assert.ok(full.created.some((el) => el.className === 'frb-cell-minibar'), 'при непустой развертке должен быть минибар');
});

test('total_npl_amount: label и description содержат «NPL 90+» и «602»', () => {
  const col = CkFinResConfig.columns.find((c) => c.key === 'total_npl_amount');
  assert.match(col.label, /NPL 90\+/);
  assert.match(col.description, /602/);
});

test('total_npl_amount: сразу после total_amount, видима по умолчанию, сортируется как total_amount', () => {
  const cols = CkFinResConfig.columns;
  const keys = cols.map((c) => c.key);
  assert.equal(keys.indexOf('total_npl_amount'), keys.indexOf('total_amount') + 1);
  const col = cols.find((c) => c.key === 'total_npl_amount');
  assert.notEqual(col.hidden, true);
  // Сортировка не отключена — включена тем же способом, что у total_amount
  // (отсутствие noSort; бэк уже знает total_npl_amount в AGG_SORT_EXPR).
  assert.equal(col.noSort, undefined);
  assert.equal(col.align, 'right');
  assert.equal(col.type, 'number');
  assert.equal(col.width, 140);
});

// --- Task 7: tbFilterOptions(dicts) — опции чекбокс-фильтра ТБ из живого словаря ---

test('tbFilterOptions(dicts): опции строятся из живого словаря terbanks (порядок как в словаре)', () => {
  const dicts = { terbanks: [
    { tb_id: 4, short_name: 'ВВБ', full_name: 'Волго-Вятский банк (живой)' },
    { tb_id: 99, short_name: 'НБ', full_name: 'Новый банк' },
  ] };
  const opts = CkFinResConfig.tbFilterOptions(dicts);
  assert.deepEqual(opts, [
    { value: '4', label: 'ВВБ — Волго-Вятский банк (живой)', short: 'ВВБ' },
    { value: '99', label: 'НБ — Новый банк', short: 'НБ' },
  ]);
});

test('tbFilterOptions(dicts): без словаря (отсутствует/пуст) — фолбэк на статику TB_ABBR/TB_NAMES', () => {
  for (const dicts of [undefined, {}, { terbanks: [] }]) {
    const opts = CkFinResConfig.tbFilterOptions(dicts);
    assert.equal(opts.length, 12);
    assert.deepEqual(new Set(opts.map((o) => o.value)), new Set(Object.keys(CkFinResConfig.TB_ABBR)));
    const vvb = opts.find((o) => o.value === '4');
    assert.equal(vvb.short, 'ВВБ');
    assert.match(vvb.label, /^ВВБ — .+/);
  }
});

// --- Задача 4: полная симметрия NPL (pivot-пары страницы, переключатель вида) ---

test('интерливинг pivot-пар страницы (flatMap _initComponents): piv:X, pivnpl:X, piv:Y, pivnpl:Y, ...', () => {
  const dicts = { terbanks: [
    { tb_id: 1, short_name: 'ББ' }, { tb_id: 4, short_name: 'ВВБ' }, { tb_id: 14, short_name: 'ЦА' },
  ] };
  const sumPivots = CkFinResConfig.tbPivotColumns(dicts);
  const nplPivots = CkFinResConfig.tbPivotColumns(dicts, { keyPrefix: 'pivnpl', breakdownField: 'npl_breakdown', labelSuffix: ' · NPL' });
  const interleaved = sumPivots.flatMap((c, i) => [c, nplPivots[i]]);
  assert.deepEqual(
    interleaved.map((c) => c.key),
    ['piv:1', 'pivnpl:1', 'piv:4', 'pivnpl:4', 'piv:14', 'pivnpl:14'],
  );
});

test('CkFinResPage._applyTbView: «pivot» показывает обе pivot-пары и скрывает обе чип-колонки; «chips» — наоборот', () => {
  const visible = {};
  CkFinResPage._viewState = {
    setVisible: (key, val) => { visible[key] = val; },
    setExtra: () => {},
  };
  CkFinResPage._dataTable = { refresh: () => {} };
  CkFinResPage._colvisApi = null;

  const columns = [{ key: 'piv:1' }, { key: 'pivnpl:1' }, { key: 'piv:4' }, { key: 'pivnpl:4' }, { key: 'tb_breakdown' }, { key: 'npl_breakdown' }];

  CkFinResPage._applyTbView('pivot', columns);
  assert.equal(visible['piv:1'], true);
  assert.equal(visible['pivnpl:1'], true);
  assert.equal(visible['piv:4'], true);
  assert.equal(visible['pivnpl:4'], true);
  assert.equal(visible['tb_breakdown'], false);
  assert.equal(visible['npl_breakdown'], false);

  CkFinResPage._applyTbView('chips', columns);
  assert.equal(visible['piv:1'], false);
  assert.equal(visible['pivnpl:1'], false);
  assert.equal(visible['piv:4'], false);
  assert.equal(visible['pivnpl:4'], false);
  assert.equal(visible['tb_breakdown'], true);
  assert.equal(visible['npl_breakdown'], true);
});
