/**
 * Клавиатурный reorder узлов дерева (Alt+стрелки), находка #34 (вариант Б).
 *
 * TreeManager._reorderViaKeyboard переиспользует ВЕСЬ путь перемещения
 * drag-and-drop: TreeDragDrop.moveProgrammatically (вынесен из handleDrop,
 * см. tree-keyboard-reorder-related коммит «Успешная ветка handleDrop вынесена
 * в публичный moveProgrammatically») → AppState.moveNode (валидация:
 * protected/depth/§5-risk/process-mining/first-level/лимиты после Task 7).
 * Клавиатурный слой добавляет только выбор соседа/цели (из AppState.children,
 * пропуская закреплённые pinned-таблицы) и пост-обработку успеха (рефокус,
 * раскрытие свёрнутого родителя при indent).
 *
 * Модуль НЕ использует _browser-stub.mjs: tree-core.js на module-level создаёт
 * TreeManager('tree'), которому нужен document.getElementById → элемент с
 * рабочим addEventListener (для перехвата keydown) — собираем собственные
 * стабы ДО импорта (по образцу tree-visible-items-cache.test.mjs), используя
 * динамический import для реальных модулей state-tree/state-content/tree-core.
 *
 * Рендер дерева (TreeRenderer.render/renderSubtree) застабен как no-op —
 * тестируется бизнес-логика reorder, а не визуальная пересборка DOM. Реальная
 * визуальная проверка (подавление браузерных Alt+←/→, фокус в живом DOM,
 * раскрытие узла) — рекомендуется live/Playwright (см. отчёт).
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/** Минимальный DOM-элемент с рабочими classList/атрибутами/addEventListener. */
function makeStubElement(id = '') {
    const listeners = {};
    const attrs = {};
    return {
        id,
        style: {},
        dataset: {},
        _listeners: listeners,
        classList: {
            _set: new Set(),
            add(c) { this._set.add(c); },
            remove(c) { this._set.delete(c); },
            toggle(c) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); },
            contains(c) { return this._set.has(c); },
        },
        addEventListener(type, cb) { (listeners[type] ||= []).push(cb); },
        removeEventListener() {},
        appendChild() {},
        setAttribute(name, value) { attrs[name] = String(value); },
        getAttribute(name) { return name in attrs ? attrs[name] : null; },
        hasAttribute(name) { return name in attrs; },
        removeAttribute(name) { delete attrs[name]; },
        querySelector: () => null,
        querySelectorAll: () => [],
        contains: () => false,
        focus() {},
    };
}

const treeContainer = makeStubElement('tree');

globalThis.window = globalThis;
globalThis.document = {
    createElement: () => makeStubElement(),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: (id) => (id === 'tree' ? treeContainer : makeStubElement(id)),
    body: makeStubElement('body'),
    activeElement: null,
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.MutationObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() {}
    disconnect() {}
};

const { AppState } = await import('../../static/js/constructor/state/state-core.js');
await import('../../static/js/constructor/state/state-tree.js');
await import('../../static/js/constructor/state/state-content.js');
const { AppConfig } = await import('../../static/js/shared/app-config.js');
const { Notifications } = await import('../../static/js/shared/notifications.js');
const { treeManager } = await import('../../static/js/constructor/tree/tree-core.js');

const notified = { error: [], success: [] };
const originalNotifications = {
    error: Notifications.error,
    success: Notifications.success,
};

/** Фейковый li: dataset.nodeId + отслеживаемые classList/атрибуты/focus(). */
function makeFakeLi(nodeId) {
    const attrs = {};
    return {
        dataset: { nodeId },
        _focusCalls: 0,
        focus() { this._focusCalls += 1; },
        getAttribute(name) { return name in attrs ? attrs[name] : null; },
        setAttribute(name, value) { attrs[name] = String(value); },
        hasAttribute(name) { return name in attrs; },
        classList: {
            _set: new Set(),
            add(c) { this._set.add(c); },
            remove(c) { this._set.delete(c); },
            contains(c) { return this._set.has(c); },
        },
        querySelector: () => null,
    };
}

/** Добавляет item-узел под parentId и возвращает его (tracked). */
function addItem(parentId, label = 'Пункт') {
    const res = AppState.addNode(parentId, label, true);
    assert.ok(res.valid, `addNode(${parentId}): ${res.message}`);
    return AppState.findNodeById(parentId).children.at(-1);
}

beforeEach(() => {
    for (const key of Object.keys(notified)) {
        notified[key].length = 0;
        Notifications[key] = (msg) => { notified[key].push(msg); };
    }
    AppState.treeData = null;
    AppState.tables = {};
    AppState.textBlocks = {};
    AppState.violations = {};
    AppState._rebuildNodeIndex();
    AppConfig.readOnlyMode.isReadOnly = false;

    // Изолируем от реального DOM-рендера дерева — тестируем только логику reorder.
    treeManager.renderer.render = () => {};
    treeManager.renderer.renderSubtree = () => {};
    treeManager.renderer._domIndex.clear();
    treeManager.editingElement = null;
});

afterEach(() => {
    Object.assign(Notifications, originalNotifications);
    AppConfig.readOnlyMode.isReadOnly = false;
});

// ── Клавиатурная перестановка (_reorderViaKeyboard) — сквозные сценарии ────

test('Alt+Up: узел меняется местами с предыдущим соседом (position=before)', async () => {
    AppState.initializeTree(true);
    const a = addItem('4', 'A');
    const b = addItem('4', 'B');
    AppState.generateNumbering();

    await treeManager._reorderViaKeyboard(makeFakeLi(b.id), 'ArrowUp');

    const order = AppState.findNodeById('4').children
        .filter(c => c.id === a.id || c.id === b.id)
        .map(c => c.id);
    assert.deepEqual(order, [b.id, a.id]);
    assert.equal(notified.success.length, 1);
});

test('Alt+Down: узел меняется местами со следующим соседом (position=after)', async () => {
    AppState.initializeTree(true);
    const a = addItem('4', 'A');
    const b = addItem('4', 'B');
    AppState.generateNumbering();

    await treeManager._reorderViaKeyboard(makeFakeLi(a.id), 'ArrowDown');

    const order = AppState.findNodeById('4').children
        .filter(c => c.id === a.id || c.id === b.id)
        .map(c => c.id);
    assert.deepEqual(order, [b.id, a.id]);
    assert.equal(notified.success.length, 1);
});

test('Alt+Right (indent): узел становится ребёнком предыдущего соседа', async () => {
    AppState.initializeTree(true);
    const a = addItem('4', 'A');
    const b = addItem('4', 'B');
    AppState.generateNumbering();

    await treeManager._reorderViaKeyboard(makeFakeLi(b.id), 'ArrowRight');

    const section4 = AppState.findNodeById('4');
    assert.ok(!section4.children.some(c => c.id === b.id), 'b больше не прямой ребёнок раздела 4');
    const aNode = AppState.findNodeById(a.id);
    assert.ok(aNode.children.some(c => c.id === b.id), 'b стал ребёнком a');
    assert.equal(notified.success.length, 1);
});

test('Alt+Left (outdent): узел становится сиблингом бывшего родителя (position=after)', async () => {
    AppState.initializeTree(true);
    const parentItem = addItem('4', 'Родитель');
    const child = addItem(parentItem.id, 'Ребёнок');
    AppState.generateNumbering();

    await treeManager._reorderViaKeyboard(makeFakeLi(child.id), 'ArrowLeft');

    const section4 = AppState.findNodeById('4');
    const idxParent = section4.children.findIndex(c => c.id === parentItem.id);
    const idxChild = section4.children.findIndex(c => c.id === child.id);
    assert.ok(idxParent !== -1 && idxChild !== -1, 'оба узла теперь прямые дети раздела 4');
    assert.equal(idxChild, idxParent + 1, 'ребёнок вставлен сразу после бывшего родителя');
    assert.equal(notified.success.length, 1);
});

test('Alt+Left на узле верхнего уровня (родитель — root): нет цели для outdent — тихий no-op', async () => {
    AppState.initializeTree(true);
    AppState.generateNumbering();

    let moveNodeCalled = false;
    const originalMoveNode = AppState.moveNode;
    AppState.moveNode = async (...args) => {
        moveNodeCalled = true;
        return originalMoveNode.apply(AppState, args);
    };
    try {
        await treeManager._reorderViaKeyboard(makeFakeLi('4'), 'ArrowLeft');
    } finally {
        AppState.moveNode = originalMoveNode;
    }

    assert.equal(moveNodeCalled, false, 'moveNode не должен вызываться — уровень 0 не имеет цели для outdent');
    assert.equal(notified.error.length, 0);
    assert.equal(notified.success.length, 0);
});

test('Alt+Left до первого уровня (реальная попытка) — moveNode отклоняет с сообщением, дерево не меняется', async () => {
    AppState.initializeTree(true);
    const item = addItem('4', 'Пункт'); // 4.1 — outdent сделал бы его сиблингом раздела 4 (level-1)
    AppState.generateNumbering();

    const before = AppState.findNodeById('4').children.map(c => c.id);

    await treeManager._reorderViaKeyboard(makeFakeLi(item.id), 'ArrowLeft');

    assert.equal(notified.error.length, 1, 'должен показаться тост об ошибке (moveNode отклонил)');
    assert.equal(notified.success.length, 0);
    assert.deepEqual(AppState.findNodeById('4').children.map(c => c.id), before, 'дерево не изменилось');
});

test('Alt+Up без предыдущего соседа — тихий no-op', async () => {
    AppState.initializeTree(true);
    const a = addItem('4', 'Единственный');
    AppState.generateNumbering();

    await treeManager._reorderViaKeyboard(makeFakeLi(a.id), 'ArrowUp');

    assert.equal(notified.error.length, 0);
    assert.equal(notified.success.length, 0);
});

test('Alt+Up пропускает закреплённую (pinned) таблицу метрик среди соседей', async () => {
    AppState.initializeTree(true);
    const section5 = AppState.findNodeById('5');
    const pinnedTable = { id: 'pinned-1', type: AppConfig.nodeTypes.TABLE, kind: 'metrics', label: 'Сводная', children: [] };
    const itemA = { id: 'itemA', type: AppConfig.nodeTypes.ITEM, label: 'A', children: [] };
    const itemB = { id: 'itemB', type: AppConfig.nodeTypes.ITEM, label: 'B', children: [] };
    section5.children.push(pinnedTable, itemA, itemB);
    AppState._rebuildNodeIndex();
    AppState.generateNumbering();

    // itemA — первый незакреплённый ребёнок: единственный сосед перед ним — pinned-таблица → no-op.
    await treeManager._reorderViaKeyboard(makeFakeLi('itemA'), 'ArrowUp');
    assert.equal(notified.success.length, 0, 'нет валидного соседа кроме pinned-таблицы — no-op');

    // itemB: предыдущий незакреплённый сосед — itemA (не pinned) → перестановка разрешена.
    await treeManager._reorderViaKeyboard(makeFakeLi('itemB'), 'ArrowUp');
    assert.equal(notified.success.length, 1, 'itemB должен переставиться с itemA');
    const order = section5.children.filter(c => c.type === AppConfig.nodeTypes.ITEM).map(c => c.id);
    assert.deepEqual(order, ['itemB', 'itemA']);
});

test('read-only режим: Alt+стрелки — тихий no-op, moveNode не вызывается', async () => {
    AppState.initializeTree(true);
    const a = addItem('4', 'A');
    const b = addItem('4', 'B');
    AppState.generateNumbering();
    AppConfig.readOnlyMode.isReadOnly = true;

    await treeManager._reorderViaKeyboard(makeFakeLi(b.id), 'ArrowUp');

    assert.equal(notified.success.length, 0);
    assert.equal(notified.error.length, 0);
    const order = AppState.findNodeById('4').children
        .filter(c => c.id === a.id || c.id === b.id)
        .map(c => c.id);
    assert.deepEqual(order, [a.id, b.id], 'порядок не должен измениться');
});

test('успешный Alt+Up — рефокус на перемещённый узел (roving tabindex)', async () => {
    AppState.initializeTree(true);
    const a = addItem('4', 'A');
    const b = addItem('4', 'B');
    AppState.generateNumbering();

    const liA = makeFakeLi(a.id);
    const liB = makeFakeLi(b.id);
    treeManager.renderer._domIndex.set(a.id, liA);
    treeManager.renderer._domIndex.set(b.id, liB);
    treeManager.container.querySelectorAll = () => [liA, liB];

    await treeManager._reorderViaKeyboard(liB, 'ArrowUp');

    assert.equal(liB._focusCalls, 1, 'перемещённый узел должен получить фокус');
    assert.equal(liB.getAttribute('tabindex'), '0');
    assert.equal(liA.getAttribute('tabindex'), '-1');
});

test('успешный Alt+Right (indent) — раскрывает свёрнутого нового родителя и рефокусит перемещённый узел', async () => {
    AppState.initializeTree(true);
    const a = addItem('4', 'A');
    const b = addItem('4', 'B');
    AppState.generateNumbering();

    const liA = makeFakeLi(a.id);
    const liB = makeFakeLi(b.id);
    liA.setAttribute('aria-expanded', 'false');
    liA.classList.add('collapsed'); // новый родитель свёрнут до indent

    treeManager.renderer._domIndex.set(a.id, liA);
    treeManager.renderer._domIndex.set(b.id, liB);
    treeManager.container.querySelectorAll = () => [liA, liB];

    await treeManager._reorderViaKeyboard(liB, 'ArrowRight');

    assert.equal(liA.classList.contains('collapsed'), false, 'родитель должен раскрыться после indent');
    assert.equal(liA.getAttribute('aria-expanded'), 'true');
    assert.equal(liB._focusCalls, 1, 'перемещённый узел должен получить фокус');
});

test('провал moveNode (перемещение узла в его потомка) — Notifications.error, без рефокуса', async () => {
    AppState.initializeTree(true);
    const parentItem = addItem('4', 'Родитель');
    const child = addItem(parentItem.id, 'Ребёнок');
    AppState.generateNumbering();

    // Alt+Right на "Родитель": предыдущий незакреплённый сосед в разделе 4 — нет
    // (Родитель — первый ребёнок раздела 4) → сымитируем провал через прямой
    // вызов moveNode с descendant-целью, минуя выбор соседа _reorderViaKeyboard.
    const result = await treeManager.dragDrop.moveProgrammatically(parentItem.id, child.id, 'child');

    assert.equal(result.valid, false);
    assert.equal(notified.error.length, 1);
    assert.equal(notified.success.length, 0);
});

// ── _nearestNonPinnedSibling — общий скан-хелпер (находка #13 код-ревью) ────

/** Обычный (не-закреплённый) узел-заглушка для теста скана. */
function stubItem(id) {
    return { id, type: AppConfig.nodeTypes.ITEM, label: id, children: [] };
}

/** Закреплённая (pinned) таблица-заглушка для теста скана. */
function stubPinnedTable(id) {
    return { id, type: AppConfig.nodeTypes.TABLE, kind: 'metrics', label: id, children: [] };
}

test('_nearestNonPinnedSibling: вперёд (step=+1) пропускает несколько pinned подряд', () => {
    const siblings = [stubItem('a'), stubPinnedTable('p1'), stubPinnedTable('p2'), stubItem('b')];
    const result = treeManager._nearestNonPinnedSibling(siblings, 0, 1);
    assert.equal(result.id, 'b');
});

test('_nearestNonPinnedSibling: назад (step=-1) пропускает несколько pinned подряд', () => {
    const siblings = [stubItem('a'), stubPinnedTable('p1'), stubPinnedTable('p2'), stubItem('b')];
    const result = treeManager._nearestNonPinnedSibling(siblings, 3, -1);
    assert.equal(result.id, 'a');
});

test('_nearestNonPinnedSibling: на границе массива вперёд (за pinned дальше ничего нет) — null', () => {
    const siblings = [stubItem('a'), stubPinnedTable('p1')];
    const result = treeManager._nearestNonPinnedSibling(siblings, 0, 1);
    assert.equal(result, null);
});

test('_nearestNonPinnedSibling: на границе массива назад (перед pinned дальше ничего нет) — null', () => {
    const siblings = [stubPinnedTable('p1'), stubItem('a')];
    const result = treeManager._nearestNonPinnedSibling(siblings, 1, -1);
    assert.equal(result, null);
});

test('_nearestNonPinnedSibling: единственный элемент — соседа нет ни в одну сторону', () => {
    const siblings = [stubItem('a')];
    assert.equal(treeManager._nearestNonPinnedSibling(siblings, 0, 1), null);
    assert.equal(treeManager._nearestNonPinnedSibling(siblings, 0, -1), null);
});

// ── Клавиатурная проводка (initKeyboardNavigation): модификатор Alt ─────────

test('keydown: Alt+ArrowUp/Down/Left/Right вызывает _reorderViaKeyboard и подавляет default/propagation', () => {
    const handler = treeContainer._listeners.keydown[0];
    assert.ok(handler, 'keydown listener должен быть зарегистрирован на контейнере дерева');

    const fakeLi = { dataset: { nodeId: 'x1' } };
    fakeLi.closest = () => fakeLi;
    const originalContains = treeContainer.contains;
    const originalActiveElement = document.activeElement;
    treeContainer.contains = () => true;
    document.activeElement = { closest: () => fakeLi };

    const originalReorder = treeManager._reorderViaKeyboard;
    const calls = [];
    treeManager._reorderViaKeyboard = (li, key) => { calls.push({ li, key }); };

    try {
        for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
            let prevented = false;
            let stopped = false;
            handler({
                key,
                altKey: true,
                ctrlKey: false,
                metaKey: false,
                preventDefault() { prevented = true; },
                stopPropagation() { stopped = true; },
            });
            assert.equal(prevented, true, `${key}: preventDefault должен вызываться`);
            assert.equal(stopped, true, `${key}: stopPropagation должен вызываться`);
        }
    } finally {
        treeContainer.contains = originalContains;
        document.activeElement = originalActiveElement;
        treeManager._reorderViaKeyboard = originalReorder;
    }

    assert.deepEqual(calls.map(c => c.key), ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    assert.ok(calls.every(c => c.li === fakeLi));
});

test('keydown: Ctrl+Alt+ArrowUp НЕ перехватывается клавиатурным reorder (браузерные модификаторы не наши)', () => {
    const handler = treeContainer._listeners.keydown[0];

    const fakeLi = { dataset: { nodeId: 'x1' } };
    fakeLi.closest = () => fakeLi;
    const originalContains = treeContainer.contains;
    const originalActiveElement = document.activeElement;
    treeContainer.contains = () => true;
    document.activeElement = { closest: () => fakeLi };

    const originalReorder = treeManager._reorderViaKeyboard;
    let called = false;
    treeManager._reorderViaKeyboard = () => { called = true; };

    try {
        handler({
            key: 'ArrowUp',
            altKey: true,
            ctrlKey: true,
            metaKey: false,
            preventDefault() {},
            stopPropagation() {},
        });
    } finally {
        treeContainer.contains = originalContains;
        document.activeElement = originalActiveElement;
        treeManager._reorderViaKeyboard = originalReorder;
    }

    assert.equal(called, false, 'Ctrl+Alt+ArrowUp не должен вызывать _reorderViaKeyboard');
});

test('keydown: обычная ArrowUp (без Alt) НЕ перехватывается клавиатурным reorder', () => {
    const handler = treeContainer._listeners.keydown[0];

    const fakeLi = { dataset: { nodeId: 'x1' } };
    fakeLi.closest = () => fakeLi;
    const originalContains = treeContainer.contains;
    const originalActiveElement = document.activeElement;
    treeContainer.contains = () => true;
    document.activeElement = { closest: () => fakeLi };

    const originalReorder = treeManager._reorderViaKeyboard;
    let called = false;
    treeManager._reorderViaKeyboard = () => { called = true; };

    try {
        handler({
            key: 'ArrowUp',
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            preventDefault() {},
            stopPropagation() {},
        });
    } finally {
        treeContainer.contains = originalContains;
        document.activeElement = originalActiveElement;
        treeManager._reorderViaKeyboard = originalReorder;
    }

    assert.equal(called, false, 'обычная навигация (без Alt) не должна вызывать _reorderViaKeyboard');
});
