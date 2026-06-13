/**
 * Тесты сброса активной зоны нарушений по ESC через EscapeStack
 * (находка аудита violation-5).
 *
 * Раньше ViolationManager вешал собственный document-listener на Escape в
 * обход EscapeStack — при открытом оверлее (диалог/меню) сброс зоны не
 * конфликтовал только за счёт stopImmediatePropagation стека. Теперь зона
 * регистрируется в стеке при активации (мышь в контейнере) и снимается при
 * деактивации/destroy — LIFO-семантика общая для всех ESC-слоёв.
 *
 * Реальные модули конструктора импортируются под node:test через
 * _browser-stub (см. конвенцию в _browser-stub.mjs).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EscapeStack } from '../../static/js/shared/escape-stack.js';
import { Notifications } from '../../static/js/shared/notifications.js';
// Входная точка графа нарушений — как в entries/constructor.js: violation-init
// разруливает циклические импорты (core ↔ расширения прототипа).
import '../../static/js/constructor/violation/violation-init.js';
import { ViolationManager } from '../../static/js/constructor/violation/violation-core.js';

// Notifications.info рисует toast с таймерами авто-скрытия — в тестах глушим.
Notifications.info = () => {};

function drainStack() {
    while (EscapeStack.size() > 0) {
        EscapeStack._stack.pop();
    }
}

test('активация зоны кладёт ровно один хэндлер в EscapeStack (идемпотентно)', () => {
    drainStack();
    const vm = new ViolationManager();
    const container = { id: 'zone' };

    vm._setActiveZone(container);
    assert.equal(EscapeStack.size(), 1);
    assert.equal(vm.currentActiveContainer, container);

    // Повторный mouseenter того же/другого контейнера не плодит хэндлеры.
    vm._setActiveZone(container);
    vm._setActiveZone({ id: 'zone2' });
    assert.equal(EscapeStack.size(), 1);
});

test('ESC (вызов верхнего хэндлера стека) сбрасывает зону и снимает хэндлер', () => {
    drainStack();
    const vm = new ViolationManager();
    vm._setActiveZone({ id: 'zone' });
    vm.cursorInsertPosition = 2;

    const top = EscapeStack._stack[EscapeStack._stack.length - 1];
    top({ key: 'Escape' });

    assert.equal(vm.currentActiveContainer, null);
    assert.equal(vm.cursorInsertPosition, null);
    assert.equal(EscapeStack.size(), 0);
});

test('деактивация зоны (mouseleave/чекбокс) снимает хэндлер со стека', () => {
    drainStack();
    const vm = new ViolationManager();
    vm._setActiveZone({ id: 'zone' });
    assert.equal(EscapeStack.size(), 1);

    vm._resetActiveZone();
    assert.equal(EscapeStack.size(), 0);
    assert.equal(vm.currentActiveContainer, null);

    // Повторный сброс идемпотентен.
    vm._resetActiveZone();
    assert.equal(EscapeStack.size(), 0);
});

test('destroy() снимает хэндлер зоны со стека', () => {
    drainStack();
    const vm = new ViolationManager();
    vm._setActiveZone({ id: 'zone' });

    vm.destroy();

    assert.equal(EscapeStack.size(), 0);
    assert.equal(vm.currentActiveContainer, null);
});
