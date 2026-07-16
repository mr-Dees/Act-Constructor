/**
 * Read-only guard для удаления элемента доп.контента нарушения (код-ревью #11).
 *
 * Раньше context-menu-violation.js сплайсил violation.additionalContent.items
 * НАПРЯМУЮ без вызова ValidationCore.requireWrite — безопасно было только
 * потому, что пункт меню «Удалить» не рендерится в read-only-режиме (внешняя
 * защита). Теперь removeContentItem — единая точка удаления с внутренним
 * guard'ом, как остальные мутации нарушения (violation-mutations.js).
 *
 * Реальные модули конструктора импортируются под node:test через
 * _browser-stub (см. конвенцию в violation-additional-content-limit.test.mjs).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppConfig } from '../../static/js/shared/app-config.js';
import { PreviewManager } from '../../static/js/constructor/preview/preview.js';
import '../../static/js/constructor/violation/violation-init.js';
import { ViolationManager } from '../../static/js/constructor/violation/violation-core.js';
import { CONTENT_TYPE_CASE } from '../../static/js/constructor/violation/violation-content-item.js';

// Шпион: собираем вызовы превью вместо реального side-эффекта.
let previewCalls = [];
PreviewManager.updateBlock = (type, id) => previewCalls.push({ type, id });

function reset(readOnly = false) {
    previewCalls = [];
    AppConfig.readOnlyMode.isReadOnly = readOnly;
}

function makeViolation(items) {
    return { id: 'v1', additionalContent: { enabled: true, items } };
}

function item(id) {
    return { id, type: CONTENT_TYPE_CASE, content: '' };
}

/** Стаб контейнера с рабочим querySelector('.additional-content-items'). */
function makeContainer() {
    const itemsContainer = { innerHTML: '', appendChild() {} };
    return {
        querySelector: (sel) => (sel === '.additional-content-items' ? itemsContainer : null),
    };
}

test('write-режим: removeContentItem удаляет элемент по id, ре-рендерит и обновляет превью', () => {
    reset(false);
    const violation = makeViolation([item('a'), item('b'), item('c')]);
    const vm = new ViolationManager();
    const container = makeContainer();
    let renderCalls = 0;
    vm.renderContentItems = () => { renderCalls += 1; };

    const result = vm.removeContentItem(violation, 'b', container);

    assert.equal(result, true);
    assert.deepEqual(violation.additionalContent.items.map((i) => i.id), ['a', 'c']);
    assert.equal(renderCalls, 1, 'ре-рендер вызван ровно один раз');
    assert.deepEqual(previewCalls, [{ type: 'violation', id: 'v1' }]);
});

test('несуществующий itemId: items не меняются, превью не зовётся', () => {
    reset(false);
    const violation = makeViolation([item('a')]);
    const vm = new ViolationManager();
    const container = makeContainer();
    let renderCalls = 0;
    vm.renderContentItems = () => { renderCalls += 1; };

    const result = vm.removeContentItem(violation, 'missing', container);

    assert.equal(result, false);
    assert.equal(violation.additionalContent.items.length, 1);
    assert.equal(renderCalls, 0);
    assert.deepEqual(previewCalls, []);
});

test('read-only: removeContentItem не удаляет элемент и возвращает false', () => {
    reset(true);
    const violation = makeViolation([item('a'), item('b')]);
    const vm = new ViolationManager();
    const container = makeContainer();
    let renderCalls = 0;
    vm.renderContentItems = () => { renderCalls += 1; };

    const result = vm.removeContentItem(violation, 'a', container);

    assert.equal(result, false);
    assert.deepEqual(
        violation.additionalContent.items.map((i) => i.id),
        ['a', 'b'],
        'сплайс заблокирован read-only guard\'ом',
    );
    assert.equal(renderCalls, 0);
    assert.deepEqual(previewCalls, []);
});
