/**
 * Кеш видимых treeitem'ов для клавиатурной навигации (tree-7).
 *
 * _allVisibleTreeItems раньше пересчитывался полным querySelectorAll+filter на
 * каждое нажатие стрелки. Теперь результат кешируется, а кеш инвалидируется
 * MutationObserver'ом на любое изменение DOM дерева (ререндер, collapse/expand).
 *
 * Файл НЕ использует _browser-stub: tree-core на module-level создаёт
 * TreeManager('tree'), которому нужны document.getElementById → элемент
 * и MutationObserver — собираем собственные стабы до импорта.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Минимальный DOM-элемент под нужды TreeManager/TreeDragDrop. */
function makeStubElement(id = '') {
    return {
        id,
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener() {},
        removeEventListener() {},
        appendChild() {},
        setAttribute() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        contains: () => false,
    };
}

// Стабы глобалов — ДО динамического импорта модулей приложения.
globalThis.window = globalThis;
globalThis.document = {
    createElement: () => makeStubElement(),
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: (id) => makeStubElement(id),
    body: makeStubElement('body'),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = () => 0;

// MutationObserver-стаб: копит инстансы, колбэки дёргаются вручную.
const observers = [];
globalThis.MutationObserver = class {
    constructor(cb) {
        this.cb = cb;
        this.targets = [];
        observers.push(this);
    }
    observe(target, opts) {
        this.targets.push({ target, opts });
    }
    disconnect() {}
};

const { treeManager } = await import('../../static/js/constructor/tree/tree-core.js');

test('_allVisibleTreeItems: повторные вызовы используют кеш (один querySelectorAll)', () => {
    let queries = 0;
    treeManager.container.querySelectorAll = () => { queries++; return []; };
    treeManager._visibleItemsCache = null;

    const first = treeManager._allVisibleTreeItems();
    const second = treeManager._allVisibleTreeItems();

    assert.equal(queries, 1, 'второй вызов обязан обслуживаться из кеша');
    assert.equal(first, second, 'из кеша возвращается тот же массив');
});

test('кеш инвалидируется при изменении DOM дерева (MutationObserver)', () => {
    let queries = 0;
    treeManager.container.querySelectorAll = () => { queries++; return []; };
    treeManager._visibleItemsCache = null;

    treeManager._allVisibleTreeItems();
    assert.equal(queries, 1);

    // Наблюдатель, подписанный на контейнер дерева, обязан существовать.
    const treeObservers = observers.filter(o =>
        o.targets.some(t => t.target === treeManager.container)
    );
    assert.ok(treeObservers.length > 0, 'TreeManager должен наблюдать контейнер дерева');

    // Имитируем мутацию DOM (ререндер/сворачивание) — дёргаем колбэки.
    // Колбэк drag-drop-наблюдателя сам зовёт querySelectorAll — считаем
    // относительно среза ПОСЛЕ колбэков.
    treeObservers.forEach(o => o.cb([]));
    const afterCallbacks = queries;

    treeManager._allVisibleTreeItems();
    assert.equal(queries, afterCallbacks + 1, 'после мутации DOM кеш должен пересчитаться');
});
