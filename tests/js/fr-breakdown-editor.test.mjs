import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRBreakdownEditor } from '../../static/js/portal/ck-fin-res/fr-breakdown-editor.js';

const colorOf = () => '#000';

/**
 * В проекте нет полноценного DOM (tests/js/_browser-stub.mjs: querySelector
 * всегда возвращает null, innerHTML не парсится) — _buildRows «как есть» не
 * прогнать, она делает row.querySelector(...) сразу после row.innerHTML =
 * «шаблон» и упадёт на null. Подменяем document.createElement на фейковый
 * элемент, чей querySelector ищет опорный маркер разметки в СВОЕЙ же
 * innerHTML-строке — этого достаточно, чтобы проверить наличие/отсутствие
 * узлов, не строя полноценный парсер HTML.
 */
function withRowElementStub(fn) {
  const origCreate = document.createElement;
  const MARKERS = {
    'input[type="range"]': 'type="range"',
    '.frb-amount': 'class="frb-amount"',
    '.frb-count': 'class="frb-count"',
    '.frb-give': 'class="frb-give"',
  };
  document.createElement = () => ({
    className: '',
    dataset: {},
    style: {},
    textContent: '',
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    remove() {},
    setAttribute() {},
    querySelector(sel) {
      const marker = MARKERS[sel];
      if (!marker || !this._html.includes(marker)) return null;
      return { addEventListener() {}, value: '', disabled: false, title: '' };
    },
    querySelectorAll: () => [],
  });
  try {
    fn();
  } finally {
    document.createElement = origCreate;
  }
}

/** Фейковый #frbRows: appendChild складывает построенные строки в массив для проверки. */
function makeRowsWrap() {
  const built = [];
  return {
    built,
    dialog: { querySelector: (sel) => (sel === '#frbRows' ? { innerHTML: '', appendChild: (el) => built.push(el) } : null) },
  };
}

test('showCounts:false — в модалке нет инпутов шт., в onApply metric_element_counts=0', () => {
  const terbanks = [{ tb_id: 7, short_name: 'ТБ7', full_name: 'ТБ номер 7' }];

  withRowElementStub(() => {
    const { built, dialog } = makeRowsWrap();
    const opts = { colorOf, showCounts: false };
    assert.doesNotThrow(() => FRBreakdownEditor._buildRows(dialog, { rows: {} }, terbanks, opts));
    const row = built.find((el) => el.className === 'frb-row');
    assert.ok(row, 'строка ТБ должна быть построена');
    assert.ok(!row.innerHTML.includes('frb-count'), 'колонка «шт.» не должна рендериться');
  });

  const captured = [];
  const st = { rows: { '7': { a: 12345, n: 9 } }, flags: { loss: false, ns: false } };
  FRBreakdownEditor._doApply({}, {}, st, terbanks, { showCounts: false, onApply: (r) => captured.push(r) });
  assert.equal(captured[0].breakdown[0].metric_element_counts, 0);
});

test('showFlags:false — блок флагов скрыт', () => {
  const html = FRBreakdownEditor._template({ subtitle: 'x', showFlags: false }, []);
  assert.match(html, /class="frb-group-flags"\s+hidden/);
});

test('без opts — поведение прежнее: шт. и флаги на месте', () => {
  const terbanks = [{ tb_id: 7, short_name: 'ТБ7', full_name: 'ТБ номер 7' }];

  withRowElementStub(() => {
    const { built, dialog } = makeRowsWrap();
    FRBreakdownEditor._buildRows(dialog, { rows: {} }, terbanks, { colorOf });
    const row = built.find((el) => el.className === 'frb-row');
    assert.ok(row.innerHTML.includes('frb-count'), 'без opts колонка «шт.» должна остаться на месте');
  });

  const html = FRBreakdownEditor._template({ subtitle: 'x' }, []);
  assert.doesNotMatch(html, /class="frb-group-flags"\s+hidden/);

  const captured = [];
  const st = { rows: { '7': { a: 12345, n: 9 } }, flags: { loss: false, ns: false } };
  FRBreakdownEditor._doApply({}, {}, st, terbanks, { onApply: (r) => captured.push(r) });
  assert.equal(captured[0].breakdown[0].metric_element_counts, 9);
});

test('_withUnknownTbs: ТБ из развертки вне справочника получает синтетическую строку (сумма не теряется)', () => {
  const dict = [{ tb_id: 7, short_name: 'МБ', full_name: 'Московский банк' }];
  const merged = FRBreakdownEditor._withUnknownTbs(dict, [
    { neg_finder_tb_id: '7', metric_amount_rubles: '1.00' },
    { neg_finder_tb_id: '99', metric_amount_rubles: '5.00' },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(String(merged[1].tb_id), '99');
  assert.match(merged[1].full_name, /вне текущего справочника/);
  // Без неизвестных ТБ — исходный массив как есть (без копии).
  assert.equal(FRBreakdownEditor._withUnknownTbs(dict, [{ neg_finder_tb_id: '7' }]), dict);
});

test('_doApply отдаёт и суммы ТБ вне справочника (строки из _withUnknownTbs)', () => {
  const merged = FRBreakdownEditor._withUnknownTbs([], [
    { neg_finder_tb_id: '99', metric_amount_rubles: '5.00' },
  ]);
  const captured = [];
  FRBreakdownEditor._doApply({}, {}, { rows: { '99': { a: 500, n: 0 } }, flags: {} }, merged, {
    onApply: (r) => captured.push(r),
  });
  assert.equal(captured[0].breakdown.length, 1);
  assert.equal(captured[0].breakdown[0].neg_finder_tb_id, '99');
  assert.equal(captured[0].breakdown[0].metric_amount_rubles, '5.00');
});
