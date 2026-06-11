/**
 * Тесты orphan-санитайзера контента акта (M.13-фронт).
 *
 * sanitizeActContent — последний рубеж для исторически испорченных данных
 * в БД: (а) отбрасывает записи словарей, чей nodeId не существует в дереве;
 * (б) обнуляет ссылки узлов без записи в словаре.
 */
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

test('чистые данные → без изменений (changed=false, контент не тронут)', () => {
  const content = makeCleanContent();
  const reference = JSON.parse(JSON.stringify(content));

  const report = sanitizeActContent(content);

  assert.equal(report.changed, false);
  assert.deepEqual(content, reference);
  assert.deepEqual(report.droppedEntries, { tables: [], textBlocks: [], violations: [] });
  assert.deepEqual(report.clearedRefs, []);
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

test('висячая ссылка узла (нет записи в словаре) обнуляется, узел остаётся', () => {
  const content = makeCleanContent();
  delete content.tables.t1; // запись пропала, узел n1 ссылается в пустоту

  const report = sanitizeActContent(content);

  const n1 = content.tree.children[0];
  assert.equal(report.changed, true);
  assert.equal(n1.tableId, undefined);
  assert.equal(n1.id, 'n1'); // узел не удалён
  assert.deepEqual(report.clearedRefs, ['n1']);
});

test('висячие ссылки на текстблок и нарушение (вложенный узел) обнуляются', () => {
  const content = makeCleanContent();
  delete content.textBlocks.tb1;
  delete content.violations.v1;

  const report = sanitizeActContent(content);

  assert.equal(content.tree.children[1].textBlockId, undefined);
  assert.equal(content.tree.children[2].children[0].violationId, undefined);
  assert.deepEqual([...report.clearedRefs].sort(), ['n2', 'n4']);
});

test('цепочка: сирота словаря + узел, ссылающийся на неё → чистятся оба', () => {
  const content = makeCleanContent();
  // Запись указывает на несуществующий узел, а легитимный узел n1 — на неё
  content.tables.t1.nodeId = 'призрак';

  const report = sanitizeActContent(content);

  assert.equal(content.tables.t1, undefined);          // (а) сирота отброшена
  assert.equal(content.tree.children[0].tableId, undefined); // (б) ссылка n1 обнулена
  assert.deepEqual(report.droppedEntries.tables, ['t1']);
  assert.deepEqual(report.clearedRefs, ['n1']);
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
  assert.equal(content.tree.children[0].tableId, undefined);
  assert.deepEqual(report.clearedRefs, ['n1']);
});
