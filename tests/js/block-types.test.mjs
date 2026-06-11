/**
 * Тесты реестра типов блоков конструктора (block-types.js, решение Б-2.6).
 *
 * Гарантии:
 *  - реестр и каждое описание типа заморожены (мутация невозможна);
 *  - набор типов закреплён точными строками — ручная синхронизация
 *    с бэкенд-реестром app/domains/acts/block_types.py;
 *  - у каждого типа полный набор полей описания;
 *  - getBlockType/isBlockType/isLeafBlockType не подвержены
 *    prototype pollution (ключи из Object.prototype — не типы);
 *  - state-content._createContentNode берёт idProp и defaultLabel из реестра;
 *  - у ItemsRenderer есть render-обработчик для каждого leaf-типа реестра.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_TYPES,
  LEAF_BLOCK_TYPES,
  getBlockType,
  isBlockType,
  isLeafBlockType,
} from '../../static/js/constructor/block-types.js';
import { AppState } from '../../static/js/constructor/state/state-core.js';
// Side-effect-модуль: Object.assign(AppState, { _createContentNode, ... }).
import '../../static/js/constructor/state/state-content.js';
import { ItemsRenderer } from '../../static/js/constructor/items/items-renderer.js';

const SPEC_FIELDS = [
  'type', 'idProp', 'dictName', 'defaultLabel', 'limitPerNode', 'domIndexPrefix',
];

test('реестр заморожен: и сам объект, и каждое описание типа', () => {
  assert.equal(Object.isFrozen(BLOCK_TYPES), true, 'BLOCK_TYPES должен быть frozen');
  assert.equal(Object.isFrozen(LEAF_BLOCK_TYPES), true, 'LEAF_BLOCK_TYPES должен быть frozen');
  for (const [type, spec] of Object.entries(BLOCK_TYPES)) {
    assert.equal(Object.isFrozen(spec), true, `описание типа '${type}' должно быть frozen`);
  }
});

test('набор типов закреплён точными строками (ручная синхронизация с block_types.py)', () => {
  assert.deepEqual(
    Object.keys(BLOCK_TYPES).sort(),
    ['item', 'table', 'textblock', 'violation'],
    'набор типов обязан совпадать с NODE_TYPES бэкенд-реестра'
  );
  assert.deepEqual(
    [...LEAF_BLOCK_TYPES].sort(),
    ['table', 'textblock', 'violation'],
    'листовые типы обязаны совпадать с LEAF_BLOCK_TYPES бэкенд-реестра'
  );
});

test('у каждого типа полный набор полей описания', () => {
  for (const [type, spec] of Object.entries(BLOCK_TYPES)) {
    assert.deepEqual(
      Object.keys(spec).sort(),
      [...SPEC_FIELDS].sort(),
      `описание типа '${type}' должно содержать ровно поля ${SPEC_FIELDS.join(', ')}`
    );
    assert.equal(spec.type, type, `spec.type должен дублировать ключ '${type}'`);
    assert.equal(typeof spec.defaultLabel, 'string');
    assert.ok(spec.defaultLabel.length > 0, `defaultLabel типа '${type}' не пуст`);
    assert.equal(typeof spec.domIndexPrefix, 'string');
  }
});

test('листовые типы имеют idProp/dictName/limitPerNode, структурный item — нет', () => {
  for (const type of LEAF_BLOCK_TYPES) {
    const spec = BLOCK_TYPES[type];
    assert.equal(typeof spec.idProp, 'string', `idProp типа '${type}'`);
    assert.equal(typeof spec.dictName, 'string', `dictName типа '${type}'`);
    assert.equal(typeof spec.limitPerNode, 'number', `limitPerNode типа '${type}'`);
    assert.ok(spec.limitPerNode > 0, `limitPerNode типа '${type}' положителен`);
  }
  assert.equal(BLOCK_TYPES.item.idProp, null);
  assert.equal(BLOCK_TYPES.item.dictName, null);
  assert.equal(BLOCK_TYPES.item.limitPerNode, null);
});

test('idProp и dictName закреплены точными значениями (контракт с ActDataSchema)', () => {
  assert.equal(BLOCK_TYPES.table.idProp, 'tableId');
  assert.equal(BLOCK_TYPES.table.dictName, 'tables');
  assert.equal(BLOCK_TYPES.textblock.idProp, 'textBlockId');
  assert.equal(BLOCK_TYPES.textblock.dictName, 'textBlocks');
  assert.equal(BLOCK_TYPES.violation.idProp, 'violationId');
  assert.equal(BLOCK_TYPES.violation.dictName, 'violations');
});

test('getBlockType/isBlockType: неизвестные типы и ключи прототипа отбиваются', () => {
  assert.equal(getBlockType('table'), BLOCK_TYPES.table);
  assert.equal(getBlockType('chart'), null);
  assert.equal(getBlockType('toString'), null, 'ключ Object.prototype — не тип');
  assert.equal(isBlockType('item'), true);
  assert.equal(isBlockType('constructor'), false);
  assert.equal(isLeafBlockType('table'), true);
  assert.equal(isLeafBlockType('item'), false);
  assert.equal(isLeafBlockType('chart'), false);
});

test('_createContentNode создаёт узел с idProp и defaultLabel из реестра', () => {
  for (const type of LEAF_BLOCK_TYPES) {
    const spec = BLOCK_TYPES[type];
    const contentId = `${type}_test_1`;
    const node = AppState._createContentNode('parent_1', contentId, type);

    assert.equal(node[spec.idProp], contentId,
      `узел типа '${type}' должен нести ссылку в поле '${spec.idProp}'`);
    assert.equal(node.label, spec.defaultLabel,
      `метка по умолчанию типа '${type}' — из реестра`);
    assert.equal(node.type, type);
    assert.equal(node.parentId, 'parent_1');
  }
});

test('ItemsRenderer имеет render-обработчик для каждого leaf-типа реестра', () => {
  for (const type of LEAF_BLOCK_TYPES) {
    assert.equal(typeof ItemsRenderer._leafRenderers[type], 'function',
      `нет render-обработчика для типа '${type}' — добавь в _leafRenderers`);
  }
});
