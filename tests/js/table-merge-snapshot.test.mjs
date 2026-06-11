/**
 * tables-2: снапшот содержимого при merge → восстановление при unmerge.
 *
 * mergeSnapshot — runtime-состояние UI на ведущей ячейке: переживает
 * перерендер (живёт в модели таблицы), восстанавливает содержимое поглощённых
 * ячеек при разъединении, но НЕ должен утекать в сериализацию
 * (_serializeTables перечисляет поля ячейки явно; бэк держит extra="forbid").
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeRange,
  unmergeAt,
} from '../../static/js/constructor/table/table-merge-core.js';
import { applyMergesToGrid, gridToMerges } from '../../static/js/constructor/table/grid-merges.js';
import { AppState } from '../../static/js/constructor/state/state-core.js';

/** Сетка 2×3 данных с содержимым "r:c". */
function grid23() {
  const grid = [];
  for (let r = 0; r < 2; r++) {
    const row = [];
    for (let c = 0; c < 3; c++) {
      row.push({
        content: `${r}:${c}`,
        isHeader: false,
        colSpan: 1,
        rowSpan: 1,
        originRow: r,
        originCol: c,
      });
    }
    grid.push(row);
  }
  return grid;
}

test('merge→unmerge: содержимое поглощённых ячеек восстанавливается', () => {
  const merged = mergeRange(grid23(), 0, 0, 1, 1);
  assert.equal(merged[0][0].content, '0:0 0:1 1:0 1:1');

  const restored = unmergeAt(merged, 0, 0);
  assert.equal(restored[0][0].content, '0:0');
  assert.equal(restored[0][1].content, '0:1');
  assert.equal(restored[1][0].content, '1:0');
  assert.equal(restored[1][1].content, '1:1');
  assert.ok(!('mergeSnapshot' in restored[0][0]));
});

test('правка склеенного content отменяет восстановление: правка хранится в ведущей', () => {
  const merged = mergeRange(grid23(), 0, 0, 1, 1);
  merged[0][0].content = 'Новый текст';

  const restored = unmergeAt(merged, 0, 0);
  assert.equal(restored[0][0].content, 'Новый текст');
  assert.equal(restored[0][1].content, '');
  assert.equal(restored[1][0].content, '');
  assert.equal(restored[1][1].content, '');
  assert.ok(!('mergeSnapshot' in restored[0][0]));
});

test('unmerge без снапшота (объединение из сохранённых данных) — прежнее поведение', () => {
  const merged = mergeRange(grid23(), 0, 0, 0, 1);
  delete merged[0][0].mergeSnapshot; // имитация reload: снапшот не сериализуется

  const restored = unmergeAt(merged, 0, 0);
  assert.equal(restored[0][0].content, '0:0 0:1');
  assert.equal(restored[0][1].content, '');
});

test('снапшот переживает перестроение сетки applyMergesToGrid (вставка строк/колонок)', () => {
  const merged = mergeRange(grid23(), 0, 0, 1, 1);
  const rebuilt = applyMergesToGrid(merged, gridToMerges(merged));

  assert.deepEqual(rebuilt[0][0].mergeSnapshot, {
    joined: '0:0 0:1 1:0 1:1',
    contents: [['0:0', '0:1'], ['1:0', '1:1']],
  });

  const restored = unmergeAt(rebuilt, 0, 0);
  assert.equal(restored[1][1].content, '1:1');
});

test('mergeSnapshot НЕ попадает в сериализацию таблиц (_serializeTables)', () => {
  AppState.tables = {
    t1: {
      id: 't1',
      nodeId: 'n1',
      grid: mergeRange(grid23(), 0, 0, 1, 1),
      colWidths: [100, 100, 100],
      protected: false,
      deletable: true,
    },
  };

  const serialized = AppState._serializeTables();
  for (const row of serialized.t1.grid) {
    for (const cell of row) {
      assert.ok(!('mergeSnapshot' in cell), `mergeSnapshot утёк в сериализацию: ${JSON.stringify(cell)}`);
    }
  }
  // Содержимое ведущей при этом сериализуется как обычно.
  assert.equal(serialized.t1.grid[0][0].content, '0:0 0:1 1:0 1:1');
});
