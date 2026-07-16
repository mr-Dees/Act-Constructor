/**
 * Тесты контракта полей диффа фактуры (invoice-diff-fields.js, #9).
 *
 * Раньше список реквизитов фактуры дублировался: `_diffInvoices`
 * (diff-engine.js) хранил массив ключей, `_INVOICE_FIELD_LABELS`
 * (diff-renderer.js) — параллельную карту меток тех же 8 ключей в том
 * же порядке. По образцу violation-fields.js вынесено в общий модуль,
 * которым пользуются оба файла — рассинхрон порядка/меток больше
 * невозможен.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    INVOICE_DIFF_FIELDS,
    INVOICE_DIFF_FIELD_KEYS,
    INVOICE_FIELD_LABELS,
} from '../../static/js/portal/acts-manager/invoice-diff-fields.js';
import { DiffEngine } from '../../static/js/portal/acts-manager/diff-engine.js';
import { DiffRenderer } from '../../static/js/portal/acts-manager/diff-renderer.js';

const EXPECTED_FIELDS = [
    { key: 'db_type', label: 'Источник (БД)' },
    { key: 'schema_name', label: 'Схема' },
    { key: 'table_name', label: 'Таблица' },
    { key: 'node_number', label: 'Пункт' },
    { key: 'profile_div', label: 'Подразделение профиля' },
    { key: 'verification_status', label: 'Статус верификации' },
    { key: 'metrics', label: 'Метрики' },
    { key: 'process', label: 'Процессы' },
];

test('INVOICE_DIFF_FIELDS заморожен: и сам массив, и объект labels', () => {
    assert.equal(Object.isFrozen(INVOICE_DIFF_FIELDS), true, 'INVOICE_DIFF_FIELDS должен быть frozen');
    assert.equal(Object.isFrozen(INVOICE_FIELD_LABELS), true, 'INVOICE_FIELD_LABELS должен быть frozen');
});

test('набор полей — 8 штук в закреплённом порядке с точными метками', () => {
    assert.equal(INVOICE_DIFF_FIELDS.length, 8);
    assert.deepEqual(INVOICE_DIFF_FIELDS, EXPECTED_FIELDS);
});

test('INVOICE_DIFF_FIELD_KEYS — ключи в том же порядке', () => {
    assert.deepEqual(INVOICE_DIFF_FIELD_KEYS, EXPECTED_FIELDS.map(f => f.key));
});

test('INVOICE_FIELD_LABELS — метки собраны из INVOICE_DIFF_FIELDS в том же порядке', () => {
    assert.deepEqual(Object.keys(INVOICE_FIELD_LABELS), EXPECTED_FIELDS.map(f => f.key));
    assert.equal(INVOICE_FIELD_LABELS.db_type, 'Источник (БД)');
    assert.equal(INVOICE_FIELD_LABELS.process, 'Процессы');
});

// --- движок и рендерер реально используют общий модуль (не свои копии) -----

test('DiffEngine._diffInvoices перебирает поля именно из INVOICE_DIFF_FIELD_KEYS', () => {
    const oldInv = { node_id: 'n5' };
    const newInv = { node_id: 'n5' };
    for (const key of INVOICE_DIFF_FIELD_KEYS) {
        oldInv[key] = 'old';
        newInv[key] = 'new';
    }
    const d = DiffEngine._diffInvoices({ n5: oldInv }, { n5: newInv }).n5;
    assert.deepEqual(Object.keys(d.fieldDiffs).sort(), [...INVOICE_DIFF_FIELD_KEYS].sort());
});

/** Минимальный элемент с реальным деревом children (для обхода после рендера). */
function makeTreeElement(tag) {
    return {
        tagName: tag,
        className: '',
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [],
        appendChild(child) { this.children.push(child); },
    };
}

test('DiffRenderer рендерит все 8 меток фактуры в порядке INVOICE_DIFF_FIELDS', () => {
    const inv = {};
    for (const key of INVOICE_DIFF_FIELD_KEYS) inv[key] = 'x';

    const origCreateElement = document.createElement;
    const origCreateTextNode = document.createTextNode;
    document.createElement = (tag) => makeTreeElement(tag);
    document.createTextNode = (text) => ({ nodeType: 3, textContent: String(text) });

    let labelTexts;
    try {
        const container = makeTreeElement('container');
        DiffRenderer._renderDiffInvoice(container, { status: 'unchanged', newData: inv, fieldDiffs: {} });

        const invoiceDiv = container.children[0];
        // children[0] — заголовок «Фактура»; остальные — поля по одному на ключ.
        const fieldDivs = invoiceDiv.children.slice(1);
        labelTexts = fieldDivs.map(fieldDiv => fieldDiv.children[0].textContent);
    } finally {
        document.createElement = origCreateElement;
        document.createTextNode = origCreateTextNode;
    }

    const expectedLabels = INVOICE_DIFF_FIELDS.map(f => `${f.label}: `);
    assert.deepEqual(labelTexts, expectedLabels);
});
