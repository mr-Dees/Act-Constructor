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
