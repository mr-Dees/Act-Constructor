/**
 * Персист свёрнутых узлов дерева (перф-волна, M.24) — чистые функции
 * tree-collapsed-store.js: ключ per-act, load/save round-trip, защита от
 * битых данных, очистка от удалённых узлов.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    collapsedStorageKey,
    loadCollapsedSet,
    saveCollapsedSet,
    pruneCollapsedSet,
} from '../../static/js/constructor/tree/tree-collapsed-store.js';

/** Минимальный in-memory Storage. */
function makeStorage() {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k),
        _data: data,
    };
}

test('ключ строится per-act по образцу ключей черновика', () => {
    assert.equal(collapsedStorageKey(42), 'audit_workstation_collapsed:42');
});

test('save → load round-trip сохраняет набор', () => {
    const storage = makeStorage();
    saveCollapsedSet(storage, 7, new Set(['n1', 'n2']));
    const loaded = loadCollapsedSet(storage, 7);
    assert.deepEqual([...loaded].sort(), ['n1', 'n2']);
});

test('наборы разных актов не пересекаются', () => {
    const storage = makeStorage();
    saveCollapsedSet(storage, 1, new Set(['a']));
    saveCollapsedSet(storage, 2, new Set(['b']));
    assert.deepEqual([...loadCollapsedSet(storage, 1)], ['a']);
    assert.deepEqual([...loadCollapsedSet(storage, 2)], ['b']);
});

test('пустой набор удаляет ключ из хранилища', () => {
    const storage = makeStorage();
    saveCollapsedSet(storage, 7, new Set(['n1']));
    saveCollapsedSet(storage, 7, new Set());
    assert.equal(storage.getItem(collapsedStorageKey(7)), null);
});

test('битый JSON / не-массив / не-строки → пустой или отфильтрованный набор', () => {
    const storage = makeStorage();
    storage.setItem(collapsedStorageKey(7), '{нев');
    assert.equal(loadCollapsedSet(storage, 7).size, 0);

    storage.setItem(collapsedStorageKey(7), '{"a":1}');
    assert.equal(loadCollapsedSet(storage, 7).size, 0);

    storage.setItem(collapsedStorageKey(7), '["ok", 5, null]');
    assert.deepEqual([...loadCollapsedSet(storage, 7)], ['ok']);
});

test('без actId load отдаёт пустой набор, save — no-op', () => {
    const storage = makeStorage();
    assert.equal(loadCollapsedSet(storage, null).size, 0);
    saveCollapsedSet(storage, null, new Set(['x']));
    assert.equal(storage._data.size, 0);
});

test('pruneCollapsedSet выкидывает id удалённых узлов и сообщает об изменении', () => {
    const set = new Set(['live', 'dead1', 'dead2']);
    const changed = pruneCollapsedSet(set, id => id === 'live');
    assert.equal(changed, true);
    assert.deepEqual([...set], ['live']);

    assert.equal(pruneCollapsedSet(set, () => true), false);
    assert.deepEqual([...set], ['live']);
});
