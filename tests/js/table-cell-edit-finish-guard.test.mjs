/**
 * render-3: finishEditing редактирования ячейки идемпотентен. Установка
 * cellEl.textContent при сохранении удаляет textarea и может повторно
 * эмитнуть blur → второй finishEditing с уже изменённым значением.
 * Guard по флагу гарантирует ровно одно завершение и один patch превью.
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCell } from './_browser-stub.mjs';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import { PreviewManager } from '../../static/js/constructor/preview/preview.js';
import { TableCellsOperations } from '../../static/js/constructor/table/table-cells-operations.js';

let patchCalls = [];
beforeEach(() => {
  patchCalls = [];
  PreviewManager.updateBlock = (kind, id) => patchCalls.push({ kind, id });
  PreviewManager.update = () => {};
});

/**
 * Фейковая ячейка-td: textarea внутри. После того как редактирование началось
 * (editingStarted), запись непустого textContent роняет textarea из DOM и
 * повторно эмитит blur — точная модель реентрантного blur при сохранении.
 */
function makeCellWithReentrantBlur(initial) {
  const blurHandlers = [];
  const textarea = {
    tagName: 'TEXTAREA',
    value: '',
    style: {},
    focus() {},
    addEventListener(type, fn) { if (type === 'blur') blurHandlers.push(fn); },
    removeEventListener() {},
  };
  let textContent = initial;
  const cell = {
    dataset: { tableId: 't1', row: '1', col: '0' },
    classList: { add() {}, remove() {}, contains: () => false },
    editingStarted: false,
    get textContent() { return textContent; },
    set textContent(v) {
      textContent = v;
      // Реентрантный blur только при сохраняющей записи (непустое значение
      // после начала редактирования) — startEditingCell сперва ставит '' для
      // вставки textarea, это не должно триггерить blur.
      if (cell.editingStarted && v) {
        blurHandlers.forEach(fn => fn());
      }
    },
    appendChild() {},
    querySelector: () => textarea,
  };
  return { cell, textarea, blurHandlers };
}

test('повторный blur при сохранении не вызывает второй finishEditing', () => {
  AppState.tables = {
    t1: {
      id: 't1',
      nodeId: 'n1',
      grid: [
        [{ content: 'H', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 }],
        [{ content: 'старое', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 0 }],
      ],
      colWidths: [100],
      protected: false,
      deletable: true,
    },
  };

  const ops = new TableCellsOperations({ selectedCells: [] });

  const { cell, textarea, blurHandlers } = makeCellWithReentrantBlur('старое');
  // Подменяем createElement, чтобы startEditingCell получил наш textarea.
  globalThis.document.createElement = () => textarea;

  ops.startEditingCell(cell);
  // Пользователь напечатал новое значение.
  textarea.value = 'новое';
  // Редактирование началось: теперь сохраняющая запись textContent эмитит blur.
  cell.editingStarted = true;
  assert.equal(blurHandlers.length, 1);
  blurHandlers[0]();

  // grid обновлён значением 'новое' ровно один раз; повторный blur (из set
  // textContent) не перезаписал его пустой строкой.
  assert.equal(AppState.tables.t1.grid[1][0].content, 'новое');
  assert.equal(patchCalls.length, 1, 'finishEditing выполнился дважды (двойной patch)');
});
