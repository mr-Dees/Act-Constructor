/**
 * Тесты focus-модели вставки в дополнительный контент и contenteditable-guard
 * (находка аудита #19).
 *
 * Раньше целевая зона paste бралась из hover-состояния (currentActiveContainer):
 * Ctrl+V в текстблоке, когда мышь висела над зоной нарушения, уходил в
 * дополнительный контент. Теперь:
 *  - вставку в поля ввода и contenteditable-редактор не перехватываем
 *    (pasteTargetIsEditable);
 *  - целевую зону определяем по фокусу (document.activeElement.closest(
 *    '.additional-content-wrapper')), вставляем в КОНЕЦ зоны.
 *
 * Реальные модули импортируются под node:test через _browser-stub.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Notifications } from '../../static/js/shared/notifications.js';
import { AppConfig } from '../../static/js/shared/app-config.js';
import '../../static/js/constructor/violation/violation-init.js';
import { ViolationManager } from '../../static/js/constructor/violation/violation-core.js';
import {
    parseClipboardText,
    pasteTargetIsEditable,
} from '../../static/js/constructor/violation/violation-paste.js';

Notifications.success = () => {};

// --- pasteTargetIsEditable: чистая проверка target ---

test('pasteTargetIsEditable: textarea/input/contenteditable → true, прочее → false', () => {
    assert.equal(pasteTargetIsEditable(null), false);
    assert.equal(pasteTargetIsEditable({ tagName: 'TEXTAREA' }), true);
    assert.equal(pasteTargetIsEditable({ tagName: 'INPUT' }), true);

    const inEditor = { tagName: 'SPAN', closest: (s) => (s === '[contenteditable="true"]' ? {} : null) };
    assert.equal(pasteTargetIsEditable(inEditor), true);

    const plainDiv = { tagName: 'DIV', closest: () => null };
    assert.equal(pasteTargetIsEditable(plainDiv), false);

    // target без метода closest (например, из старых стабов) не падает.
    assert.equal(pasteTargetIsEditable({ tagName: 'DIV' }), false);
});

// --- Интеграция через захваченный paste-обработчик ---

function makeViolation(count) {
    const items = [];
    for (let i = 0; i < count; i++) items.push({ id: `x${i}`, type: 'freeText', content: '', order: i });
    return { id: 'v1', additionalContent: { enabled: true, items } };
}

function capturePasteHandler(vm) {
    let handler = null;
    const orig = document.addEventListener;
    document.addEventListener = (type, cb) => { if (type === 'paste') handler = cb; };
    vm.setupPasteHandler();
    document.addEventListener = orig;
    return handler;
}

function makeZone(violationId = 'v1') {
    const itemsContainer = { dataset: { violationId } };
    return { querySelector: (s) => (s === '.additional-content-items' ? itemsContainer : null) };
}

function textPasteEvent(text, target) {
    let prevented = false;
    return {
        target: target ?? { tagName: 'DIV', closest: () => null },
        clipboardData: { items: [{ type: 'text/plain', getAsFile: () => null }], getData: () => text },
        preventDefault() { prevented = true; },
        _prevented: () => prevented,
    };
}

test('#19: зона берётся по фокусу, текст вставляется в КОНЕЦ зоны', async () => {
    AppConfig.readOnlyMode.isReadOnly = false;
    const vm = new ViolationManager();
    const violation = makeViolation(2); // уже 2 элемента
    vm.activeViolations.set('v1', violation);

    const zone = makeZone('v1');
    document.activeElement = { closest: (s) => (s === '.additional-content-wrapper' ? zone : null) };

    let captured = null;
    vm.addContentItemAtPosition = (v, type, container, insertIndex, extra) => {
        captured = { type, container, insertIndex, content: extra.content };
        return true;
    };

    const handler = capturePasteHandler(vm);
    await handler(textPasteEvent('Кейс 3. описание'));

    assert.ok(captured, 'вставка выполнена по фокусу');
    assert.equal(captured.type, 'case');
    assert.equal(captured.content, 'описание', 'парсер #5 применён');
    assert.equal(captured.insertIndex, 2, 'вставка в конец зоны (после 2 существующих)');
    assert.equal(captured.container, zone, 'контейнер = зона по фокусу');
});

test('#19-Б: Ctrl+V в contenteditable не перехватывается даже при фокусе на зоне', async () => {
    AppConfig.readOnlyMode.isReadOnly = false;
    const vm = new ViolationManager();
    const violation = makeViolation(1);
    vm.activeViolations.set('v1', violation);

    const zone = makeZone('v1');
    document.activeElement = { closest: (s) => (s === '.additional-content-wrapper' ? zone : null) };

    let called = false;
    vm.addContentItemAtPosition = () => { called = true; return true; };

    const target = { tagName: 'DIV', closest: (s) => (s === '[contenteditable="true"]' ? {} : null) };
    const e = textPasteEvent('hello', target);

    const handler = capturePasteHandler(vm);
    await handler(e);

    assert.equal(called, false, 'вставка в дополнительный контент не запущена');
    assert.equal(e._prevented(), false, 'стандартная вставка в редактор не перехвачена');
});

test('#19: без сфокусированной зоны вставка не перехватывается', async () => {
    AppConfig.readOnlyMode.isReadOnly = false;
    const vm = new ViolationManager();
    const violation = makeViolation(1);
    vm.activeViolations.set('v1', violation);

    // Фокус вне зоны — closest возвращает null.
    document.activeElement = { closest: () => null };

    let called = false;
    vm.addContentItemAtPosition = () => { called = true; return true; };

    const e = textPasteEvent('hello');
    const handler = capturePasteHandler(vm);
    await handler(e);

    assert.equal(called, false);
    assert.equal(e._prevented(), false, 'стандартная вставка не тронута');
});

// parseClipboardText задействован в интеграционном тесте выше — здесь просто
// фиксируем экспорт как публичный контракт модуля.
test('parseClipboardText экспортируется из модуля вставки', () => {
    assert.equal(typeof parseClipboardText, 'function');
});
