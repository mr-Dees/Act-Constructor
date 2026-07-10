import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachColumnResize } from '../../static/js/shared/datatable/column-resize.js';
import { ColumnVisibility } from '../../static/js/shared/datatable/column-visibility.js';
import { DataTable } from '../../static/js/shared/datatable/data-table.js';

test('UI-экспорты доступны и не падают на стаб-DOM', () => {
  const thead = document.createElement('thead');
  assert.doesNotThrow(() => attachColumnResize({
    theadEl: thead, columns: [{ key: 'a' }], viewState: { getWidth: () => 100, setWidth() {} },
  }));
  assert.equal(typeof ColumnVisibility.mount, 'function');
});

test('DataTable.render не падает в client-mode (стаб-DOM)', async () => {
  const columns = [
    { key: 'id', label: 'ID', type: 'id', align: 'left', width: 70 },
    { key: 'name', label: 'Имя', type: 'text', align: 'left', width: 160 },
  ];
  const view = {
    getVisibleKeys: () => ['id', 'name'],
    isVisible: () => true,
    getWidth: () => 100,
  };
  const ds = { mode: 'client', total: 2, getAllRows: () => [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] };
  const dt = new DataTable({
    mountEl: document.createElement('div'), columns, viewState: view, dataSource: ds,
    dicts: {}, pageSize: 50, onRowSelect: () => {},
  });
  await assert.doesNotReject(async () => dt.render());
  assert.equal(dt.getVisibleColumns().length, 2);
});

test('_buildHeaderCell (заголовок-поле) строится без отдельной строки фильтров', () => {
  const view = { getWidth: () => 120 };
  const dt = new DataTable({
    mountEl: document.createElement('div'),
    columns: [{ key: 'code', label: 'Код метрики', type: 'text' }],
    viewState: view, dataSource: { mode: 'client', total: 0, getAllRows: () => [] },
    dicts: {}, pageSize: 50,
  });
  // На стаб-DOM проверяем, что построение ячейки-заголовка не бросает
  // (инпут поиска + каретка сортировки + крестик внутри одной th).
  assert.doesNotThrow(() => dt._buildHeaderCell({ key: 'code', label: 'Код метрики' }));
});

test('noSort-колонка не создаёт кнопку сортировки в заголовке', () => {
  const view = { getWidth: () => 120 };
  const dt = new DataTable({
    mountEl: document.createElement('div'),
    columns: [{ key: 'amt', label: 'Сумма', type: 'text' }],
    viewState: view, dataSource: { mode: 'client', total: 0, getAllRows: () => [] },
    dicts: {}, pageSize: 50,
  });
  // Стаб-DOM не хранит детей (appendChild — no-op) и querySelector всегда
  // возвращает null, поэтому дерево заголовка не обойти. Вместо этого ловим
  // сами createElement-вызовы: у элементов с className 'dt-th-sort' (кнопка
  // сортировки) он выставляется на тот же объект уже ПОСЛЕ создания, а ссылка
  // сохранена — читаем className постфактум.
  const origCreateElement = document.createElement;
  const created = [];
  document.createElement = (tag) => {
    const el = origCreateElement(tag);
    created.push(el);
    return el;
  };
  try {
    dt._buildHeaderCell({ key: 'amt', label: 'Сумма', noSort: true });
  } finally {
    document.createElement = origCreateElement;
  }
  assert.ok(!created.some(el => el.className === 'dt-th-sort'),
    'noSort-колонка не должна создавать кнопку сортировки (.dt-th-sort)');
});

// ── Попап-оболочка (_openPopover/_closePopover) и опт-ин filterPicker ──────
//
// window.addEventListener/removeEventListener не застаблены в _browser-stub.mjs
// (в отличие от document.*) — Node global их не знает. _openPopover зовёт их из
// отложенной (setTimeout) подписки; каждый тест ниже закрывает попап до своего
// конца (clearTimeout отменяет колбэк), но no-op добавлен и на случай гонки —
// иначе сработавший таймер уронит процесс TypeError'ом вне теста.
if (typeof globalThis.addEventListener !== 'function') globalThis.addEventListener = () => {};
if (typeof globalThis.removeEventListener !== 'function') globalThis.removeEventListener = () => {};

function makeTable() {
  return new DataTable({
    mountEl: document.createElement('div'),
    columns: [{ key: 'id', label: 'ID', type: 'id' }],
    viewState: { getWidth: () => 120, getVisibleKeys: () => ['id'] },
    dataSource: { mode: 'client', total: 0, getAllRows: () => [] },
    dicts: {}, pageSize: 50,
  });
}

/**
 * Минимальный CSS-селектор для querySelector(All) честного фейк-элемента:
 * цепочка потомков через пробел, каждое звено — tag, tag.class или
 * tag[attr=value] (ровно то, что используют column-visibility.js/
 * column-resize.js: 'input[type=checkbox]', 'tr.dt-head-row th').
 */
function matchesSimpleSelector(node, part) {
  const m = part.match(/^([a-z0-9]*)(?:\.([\w-]+))?(?:\[([\w-]+)=([\w-]+)\])?$/i);
  if (!m) return false;
  const [, tag, cls, attr, attrVal] = m;
  if (tag && node._tag !== tag) return false;
  if (cls && !node.classList.contains(cls)) return false;
  if (attr && String(node[attr]) !== attrVal) return false;
  return true;
}

function queryAllDescendants(root, selector) {
  let level = [root];
  for (const part of selector.trim().split(/\s+/)) {
    const next = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (matchesSimpleSelector(child, part)) next.push(child);
        walk(child);
      }
    };
    level.forEach(walk);
    level = next;
  }
  return level;
}

/**
 * Честный фейковый DOM-элемент: в отличие от _browser-stub.mjs (querySelector
 * всегда null, appendChild — no-op), здесь addEventListener реально хранит
 * колбэки (dispatch их вызывает), appendChild реально складывает детей
 * (parentNode/contains работают), classList — поверх Set, querySelector(All)
 * реально ищет по детям (см. queryAllDescendants выше). Этого достаточно,
 * чтобы прогнать попап-оболочку и её содержимое без jsdom.
 */
function makeFakeElement(tag) {
  const listeners = {};
  const el = {
    _tag: tag,
    className: '',
    style: {},
    dataset: {},
    textContent: '',
    value: '',
    checked: false,
    type: '',
    children: [],
    parentNode: null,
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) {
        const on = force === undefined ? !this._set.has(c) : force;
        if (on) this._set.add(c); else this._set.delete(c);
      },
      contains(c) { return this._set.has(c); },
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    dispatch(type, evt) {
      const e = evt || { stopPropagation() {}, target: el };
      (listeners[type] || []).slice().forEach((fn) => fn(e));
    },
    appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    setAttribute() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    contains(node) {
      let n = node;
      while (n) { if (n === el) return true; n = n.parentNode; }
      return false;
    },
    focus() {},
    querySelector(sel) { return queryAllDescendants(el, sel)[0] || null; },
    querySelectorAll(sel) { return queryAllDescendants(el, sel); },
  };
  return el;
}

/** Подменяет document.createElement/document.body на честные фейки на время fn. */
function withFakeDom(fn) {
  const origCreate = document.createElement;
  const origBody = document.body;
  const created = [];
  document.createElement = (tag) => { const el = makeFakeElement(tag); created.push(el); return el; };
  document.body = makeFakeElement('body');
  try {
    fn({ created });
  } finally {
    document.createElement = origCreate;
    document.body = origBody;
  }
}

// ── ColumnVisibility: onApi (Task 7) ────────────────────────────────────────

function makeViewStateStub() {
  const hidden = new Set();
  return {
    isVisible: (key) => !hidden.has(key),
    setVisible: (key, on) => { if (on) hidden.delete(key); else hidden.add(key); },
    setAllVisible: () => {},
    resetToDefault: () => {},
  };
}

test('ColumnVisibility.mount({onApi}) отдаёт api.sync, перерисовывающий чекбоксы из viewState', () => {
  withFakeDom(({ created }) => {
    const columns = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }];
    const viewState = makeViewStateStub();
    let api = null;

    ColumnVisibility.mount({
      anchorEl: makeFakeElement('button'),
      columns,
      viewState,
      onChange: () => {},
      onApi: (a) => { api = a; },
    });

    assert.equal(typeof api.sync, 'function', 'onApi должен получить объект с sync()');

    const checkboxes = created.filter((el) => el.type === 'checkbox');
    assert.equal(checkboxes.length, 2);
    assert.equal(checkboxes[0].checked, true, 'колонка a изначально видима');

    // Программная смена видимости в обход UI (как делает _applyTbView) — панель узнаёт об этом только через sync().
    viewState.setVisible('a', false);
    assert.equal(checkboxes[0].checked, true, 'до sync() чекбокс ещё не перерисован');

    api.sync();
    assert.equal(checkboxes[0].checked, false, 'после sync() чекбокс колонки a снят');
    assert.equal(checkboxes[1].checked, true, 'чекбокс колонки b не тронут');
  });
});

test('ColumnVisibility.mount без onApi работает как раньше (регресс для ЦК КО)', () => {
  withFakeDom(() => {
    const columns = [{ key: 'a', label: 'A' }];
    const viewState = makeViewStateStub();
    let panel;
    assert.doesNotThrow(() => {
      panel = ColumnVisibility.mount({
        anchorEl: makeFakeElement('button'),
        columns,
        viewState,
        onChange: () => {},
      });
    });
    assert.equal(panel.className, 'dt-colvis-panel');
    assert.equal(panel.hidden, true);
  });
});

test('filterPicker=checkbox: выбор двух значений строит {op:in}, пустой выбор снимает фильтр', () => {
  const dt = makeTable();
  const col = {
    key: 'tb', label: 'ТБ', filterPicker: 'checkbox',
    filterOptions: [
      { value: '1', label: 'ТБ 1', short: 'ТБ1' },
      { value: '5', label: 'ТБ 5', short: 'ТБ5' },
      { value: '7', label: 'ТБ 7', short: 'ТБ7' },
    ],
  };

  withFakeDom(({ created }) => {
    const box = dt._buildFilterControl(col);
    assert.equal(box.control.className, 'dt-th-filter dt-th-popbtn');
    assert.equal(box.control.textContent, '—'); // пусто — «—»

    box.control.dispatch('click');
    assert.ok(dt._popover, 'клик по триггеру должен открыть попап');
    assert.equal(dt._popover.el.className, 'dt-check-popover');
    assert.equal(dt._popover.el.parentNode, document.body, 'попап должен попасть в document.body');

    const checkboxes = created.filter((el) => el.type === 'checkbox');
    assert.equal(checkboxes.length, 3);

    checkboxes[0].checked = true; checkboxes[0].dispatch('change'); // value '1'
    checkboxes[2].checked = true; checkboxes[2].dispatch('change'); // value '7'
    assert.deepEqual(dt._filters.tb, { op: 'in', values: ['1', '7'] });
    assert.equal(box.control.textContent, 'ТБ1, ТБ7');

    checkboxes[0].checked = false; checkboxes[0].dispatch('change');
    checkboxes[2].checked = false; checkboxes[2].dispatch('change');
    assert.equal(dt._filters.tb, undefined, 'пустой выбор снимает фильтр (не {op:in,values:[]})');
    assert.equal(box.control.textContent, '—');

    // Кнопка «Сбросить» внизу попапа: снимает все чекбоксы и закрывает попап.
    checkboxes[1].checked = true; checkboxes[1].dispatch('change'); // value '5'
    assert.deepEqual(dt._filters.tb, { op: 'in', values: ['5'] });
    const resetBtn = created.find((el) => el._tag === 'button' && el.textContent === 'Сбросить');
    assert.ok(resetBtn, 'кнопка «Сбросить» должна быть создана');
    resetBtn.dispatch('click');
    assert.equal(dt._filters.tb, undefined);
    assert.equal(checkboxes[1].checked, false, 'кнопка «Сбросить» снимает чекбоксы');
    assert.equal(dt._popover, null, 'кнопка «Сбросить» закрывает попап');
  });
  clearTimeout(dt._debounce); // #14: снять отложенный _renderBody от _setFilterSpec — тест не зовёт render()
});

test('filterPicker=numrange: от/до строят {op:range,cast:numeric}; пустые поля снимают фильтр', () => {
  const dt = makeTable();
  const col = { key: 'amt', label: 'Сумма', filterPicker: 'numrange' };
  const fmtRu = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const DASH = '–';

  withFakeDom(({ created }) => {
    const box = dt._buildFilterControl(col);
    assert.equal(box.control.textContent, 'Сумма'); // пусто → имя колонки (как у дат)

    box.control.dispatch('click');
    assert.ok(dt._popover);
    assert.equal(dt._popover.el.className, 'dt-num-popover');

    const inputs = created.filter((el) => el.type === 'number');
    assert.equal(inputs.length, 2); // «от» и «до»
    const [fromEl, toEl] = inputs;
    assert.equal(fromEl.step, '0.01');

    fromEl.value = '1000'; fromEl.dispatch('input');
    assert.deepEqual(dt._filters.amt, { op: 'range', cast: 'numeric', from: '1000' });
    assert.equal(box.control.textContent, `от ${fmtRu.format(1000)}`);

    toEl.value = '2500.5'; toEl.dispatch('input');
    assert.deepEqual(dt._filters.amt, { op: 'range', cast: 'numeric', from: '1000', to: '2500.5' });
    assert.equal(box.control.textContent, `${fmtRu.format(1000)} ${DASH} ${fmtRu.format(2500.5)}`);

    fromEl.value = ''; fromEl.dispatch('input');
    toEl.value = ''; toEl.dispatch('input');
    assert.equal(dt._filters.amt, undefined, 'пустые оба поля снимают фильтр');
    assert.equal(box.control.textContent, 'Сумма');

    dt._closePopover();
  });
  clearTimeout(dt._debounce); // #14: снять отложенный _renderBody от _setFilterSpec — тест не зовёт render()
});

test('число без filterPicker получает дефолтный numrange (popbtn), а не текст-инпут', () => {
  const dt = makeTable();
  withFakeDom(() => {
    const box = dt._buildFilterControl({ key: 'amt', label: 'Сумма', type: 'number' });
    assert.equal(box.control.className, 'dt-th-filter dt-th-popbtn');
  });
  clearTimeout(dt._debounce);
});

test('словарь с filterResolve сохраняет одиночный текст-инпут (не чипы)', () => {
  const dt = makeTable();
  const resolve = (q) => [String(q)];
  withFakeDom(() => {
    const box = dt._buildFilterControl({ key: 'tb', label: 'ТБ', type: 'dictionary', filterResolve: resolve });
    assert.equal(box.control.className, 'dt-th-filter');
    box.control.value = 'альфа';
    box.control.dispatch('input');
    assert.deepEqual(dt._filters.tb, { op: 'in', values: ['альфа'] });
  });
  clearTimeout(dt._debounce);
});

// ── Текстовые фильтры-чипы (Задача 3) ───────────────────────────────────────
//
// Прочие текстовые колонки (не словарь с filterResolve) получают инпут с
// накоплением фраз-чипов: 0 чипов — обычный contains по живому вводу (как
// раньше), ≥1 чип — contains_any по чипам + незавершённому вводу.

test('текстовая колонка без filterPicker получает чипы-обёртку; 0 чипов → живой contains', () => {
  const dt = makeTable();
  withFakeDom(() => {
    const box = dt._buildFilterControl({ key: 'name', label: 'Имя', type: 'text' });
    assert.equal(box.control.className, 'dt-th-chipswrap');
    const input = box.control.children[0];
    assert.equal(input.className, 'dt-th-filter');
    input.value = 'абв';
    input.dispatch('input');
    assert.deepEqual(dt._filters.name, { op: 'contains', value: 'абв' });
  });
  clearTimeout(dt._debounce); // #14: снять отложенный _renderBody от _setFilterSpec — тест не зовёт render()
});

test('чипы: Enter добавляет фразу-чип, очищает инпут, спек становится contains_any', () => {
  const dt = makeTable();
  withFakeDom(() => {
    const box = dt._buildFilterControl({ key: 'name', label: 'Имя', type: 'text' });
    const input = box.control.children[0];
    input.value = 'риск';
    input.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    assert.deepEqual(dt._filterText.name, { text: '', chips: ['риск'] });
    assert.equal(input.value, '');
    assert.deepEqual(dt._filters.name, { op: 'contains_any', values: ['риск'] });
    assert.equal(box.isFilled(), true);
  });
  clearTimeout(dt._debounce);
});

test('чипы: ≥1 чип + незавершённый ввод → contains_any включает и чипы, и живой текст', () => {
  const dt = makeTable();
  withFakeDom(() => {
    const box = dt._buildFilterControl({ key: 'name', label: 'Имя', type: 'text' });
    const input = box.control.children[0];
    input.value = 'альфа';
    input.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    input.value = 'бет'; // не подтверждено Enter
    input.dispatch('input');
    assert.deepEqual(dt._filters.name, { op: 'contains_any', values: ['альфа', 'бет'] });
  });
  clearTimeout(dt._debounce);
});

test('чипы: дубль фразы (регистронезависимо) не добавляется повторно', () => {
  const dt = makeTable();
  withFakeDom(() => {
    const box = dt._buildFilterControl({ key: 'name', label: 'Имя', type: 'text' });
    const input = box.control.children[0];
    input.value = 'Риск';
    input.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    input.value = 'риск';
    input.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    assert.deepEqual(dt._filterText.name.chips, ['Риск']);
  });
  clearTimeout(dt._debounce);
});

test('чипы: × удаляет чип', () => {
  const dt = makeTable();
  withFakeDom(() => {
    const box = dt._buildFilterControl({ key: 'name', label: 'Имя', type: 'text' });
    const input = box.control.children[0];
    input.value = 'риск';
    input.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    const chipsBox = box.control.children[1];
    assert.equal(chipsBox.children.length, 1);
    const removeBtn = chipsBox.children[0].children[1]; // [текст, ×]
    assert.equal(removeBtn.className, 'dt-th-chip-x');
    removeBtn.dispatch('click');
    assert.deepEqual(dt._filterText.name.chips, []);
    assert.equal(dt._filters.name, undefined, '0 чипов и пустой инпут — фильтр снят');
  });
  clearTimeout(dt._debounce);
});

test('чипы: Backspace на пустом инпуте снимает последний чип; на непустом — не трогает чипы', () => {
  const dt = makeTable();
  withFakeDom(() => {
    const box = dt._buildFilterControl({ key: 'name', label: 'Имя', type: 'text' });
    const input = box.control.children[0];
    input.value = 'альфа';
    input.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    input.value = 'бета';
    input.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    assert.deepEqual(dt._filterText.name.chips, ['альфа', 'бета']);

    input.value = 'x';
    input.dispatch('keydown', { key: 'Backspace', preventDefault() {} });
    assert.deepEqual(dt._filterText.name.chips, ['альфа', 'бета'], 'непустой инпут — Backspace обычный, чипы не трогает');

    input.value = '';
    input.dispatch('keydown', { key: 'Backspace', preventDefault() {} });
    assert.deepEqual(dt._filterText.name.chips, ['альфа']);
  });
  clearTimeout(dt._debounce);
});

test('чипы: clearControl снимает чипы и живой текст, isFilled → false', () => {
  const dt = makeTable();
  withFakeDom(() => {
    const box = dt._buildFilterControl({ key: 'name', label: 'Имя', type: 'text' });
    const input = box.control.children[0];
    input.value = 'альфа';
    input.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    input.value = 'бет';
    input.dispatch('input');
    assert.equal(box.isFilled(), true);

    box.clearControl();
    assert.deepEqual(dt._filterText.name, { text: '', chips: [] });
    assert.equal(input.value, '');
    assert.equal(box.isFilled(), false);
  });
  clearTimeout(dt._debounce);
});

test('чипы: isFilled учитывает и чипы, и живой текст по отдельности', () => {
  const dt = makeTable();
  withFakeDom(() => {
    const box = dt._buildFilterControl({ key: 'name', label: 'Имя', type: 'text' });
    const input = box.control.children[0];
    assert.equal(box.isFilled(), false);

    input.value = 'аб';
    input.dispatch('input');
    assert.equal(box.isFilled(), true, 'живой текст без чипов тоже считается заполненным полем');

    input.value = '';
    input.dispatch('input');
    assert.equal(box.isFilled(), false);

    input.value = 'риск';
    input.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    assert.equal(box.isFilled(), true);
  });
  clearTimeout(dt._debounce);
});

test('чипы: состояние переживает пересборку контрола (render() создаёт контрол заново)', () => {
  const dt = makeTable();
  withFakeDom(() => {
    const col = { key: 'name', label: 'Имя', type: 'text' };
    const box1 = dt._buildFilterControl(col);
    const input1 = box1.control.children[0];
    input1.value = 'риск';
    input1.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    assert.deepEqual(dt._filterText.name.chips, ['риск']);

    // Пересборка контрола (как при render()) — новый набор DOM-узлов, то же состояние.
    const box2 = dt._buildFilterControl(col);
    const chipsBox2 = box2.control.children[1];
    assert.equal(chipsBox2.children.length, 1, 'чип должен восстановиться из persisted-состояния');
    assert.equal(chipsBox2.children[0].children[0].textContent, 'риск');
    assert.equal(box2.isFilled(), true);
  });
  clearTimeout(dt._debounce);
});

test('дата-фильтр после рефакторинга оболочки работает как раньше (popover открывается/закрывается)', () => {
  const dt = makeTable();
  withFakeDom(({ created }) => {
    const box = dt._buildFilterControl({ key: 'dt2', label: 'Период', type: 'date' });
    const trigger = created.find((el) => el._tag === 'button');
    assert.ok(trigger, 'триггер даты должен быть создан');

    trigger.dispatch('click');
    assert.ok(dt._popover, 'клик должен открыть попап');
    assert.equal(dt._popover.el.className, 'dt-date-popover');
    assert.equal(dt._popover.el.parentNode, document.body);

    const dateInputs = created.filter((el) => el.type === 'date');
    assert.equal(dateInputs.length, 2); // «С» и «По»
    dateInputs[0].value = '2025-01-01';
    dateInputs[0].dispatch('input');
    assert.deepEqual(dt._filters.dt2, { op: 'range', cast: 'date', from: '2025-01-01', to: null });
    assert.equal(box.isFilled(), true);

    dt._closePopover();
    assert.equal(dt._popover, null, 'попап должен закрыться');
  });
  clearTimeout(dt._debounce); // #14: снять отложенный _renderBody от _setFilterSpec — тест не зовёт render()
});

// ── render(): восстановление позиции скролла контейнера (Задача 8) ─────────

test('render() восстанавливает scrollLeft/scrollTop ПОСЛЕ наполнения тела', async () => {
  // Патчим document.createElement вручную, а не через withFakeDom: тест
  // асинхронный (await render()), а withFakeDom восстанавливает оригинал
  // СИНХРОННО в своём finally, не дожидаясь async-колбэка — второй render()
  // (после первого await) создавал бы элементы уже НЕ fake-версией.
  const origCreate = document.createElement;
  const created = [];
  document.createElement = (tag) => { const el = makeFakeElement(tag); created.push(el); return el; };
  try {
    const dt = makeTable();

    await dt.render();
    // .dt-wrapper ищем по created, а не querySelector: honest-фейк не чистит
    // children при innerHTML='' (в отличие от настоящего DOM), поэтому после
    // второго render() querySelector('.dt-wrapper') нашёл бы ПЕРВЫЙ (старый)
    // wrapper — тест был бы зелёным и без фикса.
    const wrapper1 = created.filter((el) => el.className === 'dt-wrapper').pop();
    assert.ok(wrapper1, 'первый render() должен создать .dt-wrapper');
    wrapper1.scrollLeft = 120;
    wrapper1.scrollTop = 40;

    // Перехват _renderBody фиксирует scrollTop НОВОГО wrapper'а в момент её
    // вызова. Баг из ревью был именно в порядке: restore ДО наполнения тела —
    // в реальном браузере tbody там ещё пуст, scrollHeight ≈ высоте шапки,
    // запись scrollTop клэмпится к 0 и не переигрывается после наполнения.
    // Если бы порядок остался старым, здесь уже стояло бы 40; корректный
    // порядок — undefined (ещё не восстановлен на момент отрисовки тела).
    const origRenderBody = dt._renderBody.bind(dt);
    let scrollTopDuringRenderBody;
    dt._renderBody = async function patched() {
      scrollTopDuringRenderBody = this._wrapper.scrollTop;
      return origRenderBody();
    };

    await dt.render();
    assert.equal(scrollTopDuringRenderBody, undefined,
      'restore должен происходить ПОСЛЕ _renderBody, а не до');

    const wrapper2 = created.filter((el) => el.className === 'dt-wrapper').pop();
    assert.ok(wrapper2 && wrapper2 !== wrapper1, 'второй render() должен создать новый .dt-wrapper');
    assert.equal(wrapper2.scrollLeft, 120, 'scrollLeft переносится на новый wrapper');
    assert.equal(wrapper2.scrollTop, 40, 'scrollTop переносится на новый wrapper');
  } finally {
    document.createElement = origCreate;
  }
});
