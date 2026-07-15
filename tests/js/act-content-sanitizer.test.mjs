/**
 * Тесты orphan-санитайзера контента акта (M.13-фронт).
 *
 * sanitizeActContent — последний рубеж для исторически испорченных данных
 * в БД: (а) отбрасывает записи словарей, чей nodeId не существует в дереве;
 * (б) удаляет листовой узел-зомби, ссылка которого не имеет записи в словаре
 * (зеркало бэкового _strip_dangling_refs).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeActContent } from '../../static/js/constructor/state/act-content-sanitizer.js';

/** Согласованный контент: узлы дерева ↔ записи словарей. */
function makeCleanContent() {
  return {
    tree: {
      id: 'root',
      label: 'Акт',
      children: [
        { id: 'n1', type: 'table', tableId: 't1', children: [] },
        { id: 'n2', type: 'textblock', textBlockId: 'tb1', children: [] },
        {
          id: 'n3',
          type: 'item',
          children: [{ id: 'n4', type: 'violation', violationId: 'v1', children: [] }],
        },
      ],
    },
    tables: { t1: { id: 't1', nodeId: 'n1', grid: [] } },
    textBlocks: { tb1: { id: 'tb1', nodeId: 'n2', content: '' } },
    violations: { v1: { id: 'v1', nodeId: 'n4' } },
  };
}

/** id всех узлов поддерева. */
function nodeIdsOf(tree) {
  const ids = new Set();
  const stack = [tree];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (n.id) ids.add(n.id);
    (n.children || []).forEach((c) => stack.push(c));
  }
  return ids;
}

test('чистые данные → без изменений (changed=false, контент не тронут)', () => {
  const content = makeCleanContent();
  const reference = JSON.parse(JSON.stringify(content));

  const report = sanitizeActContent(content);

  assert.equal(report.changed, false);
  assert.deepEqual(content, reference);
  assert.deepEqual(report.droppedEntries, { tables: [], textBlocks: [], violations: [] });
  assert.deepEqual(report.removedNodes, []);
});

test('сирота словаря таблиц (nodeId не в дереве) отбрасывается', () => {
  const content = makeCleanContent();
  content.tables.t_orphan = { id: 't_orphan', nodeId: 'нет_такого_узла', grid: [] };

  const report = sanitizeActContent(content);

  assert.equal(report.changed, true);
  assert.equal(content.tables.t_orphan, undefined);
  assert.deepEqual(report.droppedEntries.tables, ['t_orphan']);
  // Легитимная запись не задета
  assert.ok(content.tables.t1);
});

test('сироты текстблоков и нарушений отбрасываются', () => {
  const content = makeCleanContent();
  content.textBlocks.tb_orphan = { id: 'tb_orphan', nodeId: 'призрак' };
  content.violations.v_orphan = { id: 'v_orphan', nodeId: 'призрак' };

  const report = sanitizeActContent(content);

  assert.equal(report.changed, true);
  assert.equal(content.textBlocks.tb_orphan, undefined);
  assert.equal(content.violations.v_orphan, undefined);
  assert.deepEqual(report.droppedEntries.textBlocks, ['tb_orphan']);
  assert.deepEqual(report.droppedEntries.violations, ['v_orphan']);
});

test('запись без nodeId считается сиротой', () => {
  const content = makeCleanContent();
  content.tables.t_no_node = { id: 't_no_node', grid: [] };

  const report = sanitizeActContent(content);

  assert.equal(content.tables.t_no_node, undefined);
  assert.deepEqual(report.droppedEntries.tables, ['t_no_node']);
});

test('находка #21: nodeId указывает на существующий узел, но узел ссылается на другую запись — дропается (все 3 словаря)', () => {
  const content = makeCleanContent();
  // t_stale выдаёт себя за содержимое узла n1, но n1.tableId по-прежнему 't1' —
  // узел реально НЕ ссылается назад на t_stale (раньше хватало существования n1).
  content.tables.t_stale = { id: 't_stale', nodeId: 'n1', grid: [] };
  content.textBlocks.tb_stale = { id: 'tb_stale', nodeId: 'n2' };
  content.violations.v_stale = { id: 'v_stale', nodeId: 'n4' };

  const report = sanitizeActContent(content);

  assert.equal(content.tables.t_stale, undefined);
  assert.equal(content.textBlocks.tb_stale, undefined);
  assert.equal(content.violations.v_stale, undefined);
  assert.deepEqual(report.droppedEntries.tables, ['t_stale']);
  assert.deepEqual(report.droppedEntries.textBlocks, ['tb_stale']);
  assert.deepEqual(report.droppedEntries.violations, ['v_stale']);
  // Легитимные записи, на которые узлы реально ссылаются, не задеты.
  assert.ok(content.tables.t1);
  assert.ok(content.textBlocks.tb1);
  assert.ok(content.violations.v1);
  // Узлы-владельцы легитимных ссылок остаются на месте (не задеты правилом (б)).
  const ids = nodeIdsOf(content.tree);
  assert.ok(ids.has('n1') && ids.has('n2') && ids.has('n4'));
});

test('находка #21: nodeId ссылается на узел ДРУГОГО типа с тем же id записи — дропается', () => {
  const content = makeCleanContent();
  // t_wrong_type маскируется под запись узла n2 (textblock), но у n2 нет
  // поля tableId вовсе — обратной ссылки на t_wrong_type нет ни у одного узла.
  content.tables.t_wrong_type = { id: 't_wrong_type', nodeId: 'n2', grid: [] };

  const report = sanitizeActContent(content);

  assert.equal(content.tables.t_wrong_type, undefined);
  assert.deepEqual(report.droppedEntries.tables, ['t_wrong_type']);
  assert.ok(content.textBlocks.tb1, 'легитимный textBlock не задет');
});

test('узел-зомби (нет записи в словаре) удаляется целиком', () => {
  const content = makeCleanContent();
  delete content.tables.t1; // запись пропала, узел n1 ссылается в пустоту

  const report = sanitizeActContent(content);

  assert.equal(report.changed, true);
  assert.ok(!nodeIdsOf(content.tree).has('n1'), 'узел-зомби n1 не удалён');
  assert.deepEqual(report.removedNodes, [{ id: 'n1', type: 'table' }]);
  // Соседние валидные узлы на месте.
  assert.ok(nodeIdsOf(content.tree).has('n2'));
});

test('зомби-текстблок и зомби-нарушение (вложенный узел) удаляются', () => {
  const content = makeCleanContent();
  delete content.textBlocks.tb1;
  delete content.violations.v1;

  const report = sanitizeActContent(content);

  const ids = nodeIdsOf(content.tree);
  assert.ok(!ids.has('n2'), 'зомби-текстблок n2 не удалён');
  assert.ok(!ids.has('n4'), 'вложенный зомби-нарушение n4 не удалён');
  // Родительский item n3 (не лист) сохранён, его children пуст.
  assert.ok(ids.has('n3'));
  assert.deepEqual([...report.removedNodes].map((n) => n.id).sort(), ['n2', 'n4']);
});

test('цепочка: сирота словаря + узел, ссылающийся на неё → запись отброшена, узел удалён', () => {
  const content = makeCleanContent();
  // Запись указывает на несуществующий узел, а легитимный узел n1 — на неё
  content.tables.t1.nodeId = 'призрак';

  const report = sanitizeActContent(content);

  assert.equal(content.tables.t1, undefined);          // (а) сирота отброшена
  assert.ok(!nodeIdsOf(content.tree).has('n1'), 'узел n1 не удалён'); // (б) узел вырезан
  assert.deepEqual(report.droppedEntries.tables, ['t1']);
  assert.deepEqual(report.removedNodes, [{ id: 'n1', type: 'table' }]);
});

test('пустое/отсутствующее дерево → no-op', () => {
  assert.equal(sanitizeActContent(null).changed, false);
  assert.equal(sanitizeActContent({}).changed, false);
  assert.equal(sanitizeActContent({ tree: null, tables: { x: { nodeId: 'y' } } }).changed, false);
});

test('отсутствующие словари не ломают обход (б)', () => {
  const content = {
    tree: { id: 'root', children: [{ id: 'n1', type: 'table', tableId: 't1', children: [] }] },
  };

  const report = sanitizeActContent(content);

  assert.equal(report.changed, true);
  assert.ok(!nodeIdsOf(content.tree).has('n1'));
  assert.deepEqual(report.removedNodes, [{ id: 'n1', type: 'table' }]);
});

test('удаление зомби-узла вычищает осиротевшие записи его потомков', () => {
  // n1 — зомби (tableId без записи), но у него валидный потомок-нарушение n2.
  // После вырезания n1 поддерево с n2 исчезает → запись violations.v2
  // становится сиротой и должна быть вычищена этим же проходом.
  const content = {
    tree: {
      id: 'root', label: 'Акт',
      children: [
        {
          id: 'n1', type: 'table', tableId: 't_missing',
          children: [
            { id: 'n2', type: 'violation', violationId: 'v2', children: [] },
          ],
        },
      ],
    },
    tables: {},
    textBlocks: {},
    violations: { v2: { id: 'v2', nodeId: 'n2' } },
  };

  const report = sanitizeActContent(content);

  const ids = nodeIdsOf(content.tree);
  assert.ok(!ids.has('n1'), 'зомби-узел n1 не удалён');
  assert.ok(!ids.has('n2'), 'потомок зомби n2 не удалён');
  // Осиротевшая запись потомка вычищена (а не оставлена бэкенду).
  assert.equal(content.violations.v2, undefined);
  assert.ok(report.removedNodes.some((n) => n.id === 'n1'));
  assert.deepEqual(report.droppedEntries.violations, ['v2']);
});
