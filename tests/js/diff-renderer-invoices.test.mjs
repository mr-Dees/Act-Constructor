/**
 * Рендер диффа фактур (#8 full, invoices, решение Q2). Фактуры крепятся к узлу
 * (node.id), поэтому:
 *   - _invoiceFieldText сворачивает реквизиты в читаемый текст
 *     (metrics/process → коды через запятую);
 *   - _nodeHasContentChanges учитывает изменение фактуры (иначе узел с
 *     diff-unchanged скрылся бы CSS'ом вместе с изменённой фактурой);
 *   - _renderDiffInvoice рендерит блок без исключений (added/removed/modified).
 *
 * del/ins строятся напрямую через textContent (без SafeHTML) — как поля
 * нарушения; профиль acts-текстблока не затрагивается.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiffRenderer } from '../../static/js/portal/acts-manager/diff-renderer.js';

// --- _invoiceFieldText ------------------------------------------------------

test('_invoiceFieldText: скаляр — как есть', () => {
    assert.equal(DiffRenderer._invoiceFieldText({ table_name: 't1' }, 'table_name'), 't1');
});

test('_invoiceFieldText: null/undefined → пустая строка', () => {
    assert.equal(DiffRenderer._invoiceFieldText({ profile_div: null }, 'profile_div'), '');
    assert.equal(DiffRenderer._invoiceFieldText({}, 'schema_name'), '');
    assert.equal(DiffRenderer._invoiceFieldText(null, 'table_name'), '');
});

test('_invoiceFieldText: metrics → коды через запятую', () => {
    const inv = { metrics: [{ metric_code: 'ФР00001' }, { code: 'ФР00002' }] };
    assert.equal(DiffRenderer._invoiceFieldText(inv, 'metrics'), 'ФР00001, ФР00002');
});

test('_invoiceFieldText: process → коды через запятую', () => {
    const inv = { process: [{ process_code: 'П6152' }] };
    assert.equal(DiffRenderer._invoiceFieldText(inv, 'process'), 'П6152');
});

// --- _nodeHasContentChanges (учёт фактур) -----------------------------------

test('_nodeHasContentChanges: изменённая фактура узла → true', () => {
    const node = { id: 'n5' };
    const diffResult = {
        tables: {}, textblocks: {}, violations: {},
        invoices: { n5: { status: 'modified' } },
    };
    assert.equal(DiffRenderer._nodeHasContentChanges(node, diffResult), true);
});

test('_nodeHasContentChanges: неизменённая фактура узла → false', () => {
    const node = { id: 'n5' };
    const diffResult = {
        tables: {}, textblocks: {}, violations: {},
        invoices: { n5: { status: 'unchanged' } },
    };
    assert.equal(DiffRenderer._nodeHasContentChanges(node, diffResult), false);
});

test('_nodeHasContentChanges: у узла нет фактуры → false', () => {
    const node = { id: 'n9' };
    const diffResult = {
        tables: {}, textblocks: {}, violations: {},
        invoices: { n5: { status: 'added' } },
    };
    assert.equal(DiffRenderer._nodeHasContentChanges(node, diffResult), false);
});

// --- _renderDiffInvoice (smoke) ---------------------------------------------

const inv = (over = {}) => ({
    node_id: 'n5', node_number: '5.1', db_type: 'hive', schema_name: 's',
    table_name: 't1', metrics: [{ metric_code: 'ФР00001' }], process: null,
    profile_div: null, verification_status: 'pending', ...over,
});

test('_renderDiffInvoice added: без исключений', () => {
    DiffRenderer._renderDiffInvoice({ appendChild() {} }, { status: 'added', newData: inv() });
});

test('_renderDiffInvoice removed: без исключений', () => {
    DiffRenderer._renderDiffInvoice({ appendChild() {} }, { status: 'removed', oldData: inv() });
});

test('_renderDiffInvoice modified: без исключений', () => {
    DiffRenderer._renderDiffInvoice({ appendChild() {} }, {
        status: 'modified',
        oldData: inv({ table_name: 't1' }),
        newData: inv({ table_name: 't2' }),
        fieldDiffs: { table_name: { old: 't1', new: 't2' } },
    });
});

// --- render(): интеграция с деревом (smoke) ---------------------------------

test('render: узел с изменённой фактурой рендерится без исключений', () => {
    const diffResult = {
        tree: {
            tree: { id: 'root', label: 'Акт', type: 'item', children: [
                { id: 'n5', label: 'Пункт 5.1', type: 'item', number: '5.1', children: [] },
            ] },
            removedNodes: [],
        },
        tables: {}, textblocks: {}, violations: {},
        invoices: { n5: { status: 'modified', oldData: inv({ table_name: 'a' }), newData: inv({ table_name: 'b' }), fieldDiffs: { table_name: { old: 'a', new: 'b' } } } },
    };
    DiffRenderer.render({ innerHTML: '', classList: { toggle() {} }, appendChild() {} }, diffResult, true);
});

// --- recording-DOM: захват реального дерева del/ins --------------------------

function makeRec(tag) {
    const classes = new Set();
    const el = {
        tagName: tag, _text: '', children: [], style: {}, dataset: {},
        classList: {
            add: (c) => classes.add(c), remove: (c) => classes.delete(c),
            toggle() {}, contains: (c) => classes.has(c),
        },
        appendChild(c) { el.children.push(c); return c; },
        setAttribute() {},
    };
    Object.defineProperty(el, 'textContent', {
        get() { return el._text; }, set(v) { el._text = String(v); },
    });
    return el;
}

function withRecDom(fn) {
    const origCreate = document.createElement;
    const origText = document.createTextNode;
    document.createElement = (tag) => makeRec(tag);
    document.createTextNode = (t) => ({ nodeType: 3, textContent: String(t) });
    try { return fn(); } finally {
        document.createElement = origCreate;
        document.createTextNode = origText;
    }
}

function collect(el, tag, acc = []) {
    if (!el || !el.children) return acc;
    for (const c of el.children) {
        if (c.tagName === tag) acc.push(c);
        collect(c, tag, acc);
    }
    return acc;
}

// --- appendOldNewPair (#14 единый сборщик «было → стало») --------------------

test('appendOldNewPair: placeholder ∅ для пустых старого и нового', () => {
    withRecDom(() => {
        const parent = document.createElement('span');
        DiffRenderer.appendOldNewPair(parent, '', '', { placeholder: '∅' });
        assert.equal(collect(parent, 'del')[0].textContent, '∅');
        assert.equal(collect(parent, 'ins')[0].textContent, '∅');
    });
});

test('appendOldNewPair: conditionalOld — пустое старое без <del> и стрелки', () => {
    withRecDom(() => {
        const parent = document.createElement('div');
        DiffRenderer.appendOldNewPair(parent, '', 'новое', { placeholder: '∅', conditionalOld: true });
        assert.equal(collect(parent, 'del').length, 0);
        assert.equal(collect(parent, 'ins')[0].textContent, 'новое');
        const arrows = parent.children.filter(c => c.nodeType === 3 && c.textContent === ' → ');
        assert.equal(arrows.length, 0);
    });
});

test('appendOldNewPair: без opts — значения как есть, без заглушки', () => {
    withRecDom(() => {
        const parent = document.createElement('div');
        DiffRenderer.appendOldNewPair(parent, '10', '20');
        assert.equal(collect(parent, 'del')[0].textContent, '10');
        assert.equal(collect(parent, 'ins')[0].textContent, '20');
    });
});

// --- _renderDiffInvoice: гашение фантомной смены (#8) ------------------------

test('_renderDiffInvoice: фантомная metrics (коды равны) → без del/ins', () => {
    withRecDom(() => {
        const root = document.createElement('div');
        DiffRenderer._renderDiffInvoice(root, {
            status: 'modified',
            oldData: inv({ metrics: [{ metric_code: 'ФР00001', metric_name: 'старое' }] }),
            newData: inv({ metrics: [{ metric_code: 'ФР00001', metric_name: 'новое' }] }),
            fieldDiffs: { metrics: { old: 'ФР00001', new: 'ФР00001' } },
        });
        assert.equal(collect(root, 'del').length, 0);
        assert.equal(collect(root, 'ins').length, 0);
    });
});

test('_renderDiffInvoice: реальная смена table_name → del/ins присутствуют', () => {
    withRecDom(() => {
        const root = document.createElement('div');
        DiffRenderer._renderDiffInvoice(root, {
            status: 'modified',
            oldData: inv({ table_name: 't1' }),
            newData: inv({ table_name: 't2' }),
            fieldDiffs: { table_name: { old: 't1', new: 't2' } },
        });
        assert.ok(collect(root, 'del').some(d => d.textContent === 't1'));
        assert.ok(collect(root, 'ins').some(i => i.textContent === 't2'));
    });
});
