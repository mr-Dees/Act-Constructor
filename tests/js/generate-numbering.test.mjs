/**
 * generateNumbering (перф-волна, 5.1.3): фиксация нумерации байт-в-байт.
 *
 * Тест написан ДО линеаризации алгоритма (убрали filter().indexOf() на каждом
 * ребёнке) и закрепляет результат старого алгоритма: после рефактора нумерация
 * обязана совпасть полностью, включая поведение «узел неизвестного типа номер
 * не получает» и обновление метки metrics-таблицы под §5.
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import '../../static/js/constructor/state/state-tree.js';
import '../../static/js/constructor/state/state-content.js';

let seq = 0;
const id = () => `n${++seq}`;

const item = (label, children = []) => ({ id: id(), label, type: 'item', children });
const tableN = () => ({ id: id(), label: 'Таблица', type: 'table', tableId: id() });
const textblockN = () => ({ id: id(), label: 'ТБ', type: 'textblock', textBlockId: id() });
const violationN = () => ({ id: id(), label: 'Нарушение', type: 'violation', violationId: id() });

beforeEach(() => {
    AppState.treeData = null;
    AppState.tables = {};
    AppState._rebuildNodeIndex();
});

test('смешанные дети: независимые счётчики по типам, иерархические префиксы у items', () => {
    const t1 = tableN();
    const i1 = item('Первый пункт');
    const v1 = violationN();
    const i2 = item('Второй пункт', [
        textblockN(),
        item('Вложенный'),
        tableN(),
        item('Ещё вложенный', [item('Глубокий')]),
        violationN(),
        violationN(),
    ]);
    const tb1 = textblockN();
    const t2 = tableN();
    const weird = { id: id(), label: 'Неизвестный', type: 'chart' };

    AppState.treeData = {
        id: 'root',
        label: 'Акт',
        children: [t1, i1, v1, i2, tb1, t2, weird],
    };

    AppState.generateNumbering();

    // Таблицы/нарушения/текстблоки — сквозные счётчики в рамках родителя.
    assert.equal(t1.number, 'Таблица 1');
    assert.equal(t2.number, 'Таблица 2');
    assert.equal(v1.number, 'Нарушение 1');
    assert.equal(tb1.number, 'Текстовый блок 1');

    // Items — иерархическая нумерация только по item-детям.
    assert.equal(i1.number, '1');
    assert.equal(i2.number, '2');
    assert.equal(i2.children[0].number, 'Текстовый блок 1');
    assert.equal(i2.children[1].number, '2.1');
    assert.equal(i2.children[2].number, 'Таблица 1');
    assert.equal(i2.children[3].number, '2.2');
    assert.equal(i2.children[3].children[0].number, '2.2.1');
    assert.equal(i2.children[4].number, 'Нарушение 1');
    assert.equal(i2.children[5].number, 'Нарушение 2');

    // Узел неизвестного типа номер не получает (поведение старого алгоритма).
    assert.equal(weird.number, undefined);
});

test('под §5 обновляется метка metrics-таблицы при перенумерации', () => {
    // Сид — устаревшая АВТОгенерируемая метка (канонический префикс + старый
    // номер): перенумерация обновляет только такие; пользовательский customLabel
    // не затирается (tree-10, см. metrics-tables-invariants.test.mjs).
    const metricsNode = {
        ...tableN(),
        kind: 'metrics',
        customLabel: 'Объем выявленных отклонений (В метриках) по 5.9',
    };
    const p1 = item('Будет удалён');
    const p2 = item('Сместится на 5.1');
    p2.children = [metricsNode];

    // §5 должен быть пятым item-ребёнком root, иначе номера детей не начнутся с '5.'.
    AppState.treeData = {
        id: 'root',
        label: 'Акт',
        children: [
            item('Раздел 1'), item('Раздел 2'), item('Раздел 3'), item('Раздел 4'),
            { id: '5', label: 'Раздел 5', children: [p1, p2] },
        ],
    };

    AppState.generateNumbering();
    assert.equal(p1.number, '5.1');
    assert.equal(p2.number, '5.2');
    assert.equal(metricsNode.label, 'Объем выявленных отклонений (В метриках) по 5.2');

    // Удаляем первый пункт — второй становится 5.1, метка следует за номером.
    AppState.findNodeById('5').children = [p2];
    AppState._rebuildNodeIndex();
    AppState.generateNumbering();
    assert.equal(p2.number, '5.1');
    assert.equal(metricsNode.label, 'Объем выявленных отклонений (В метриках) по 5.1');
    assert.equal(metricsNode.customLabel, 'Объем выявленных отклонений (В метриках) по 5.1');
});

test('повторный вызов generateNumbering идемпотентен', () => {
    const i1 = item('А', [tableN(), item('Б')]);
    AppState.treeData = { id: 'root', label: 'Акт', children: [i1] };

    AppState.generateNumbering();
    const snapshot = JSON.stringify(AppState.treeData);
    AppState.generateNumbering();
    assert.equal(JSON.stringify(AppState.treeData), snapshot);
});
