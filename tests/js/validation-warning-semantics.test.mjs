/**
 * Семантика предупреждений валидации (val-1 / val-2 / val-6).
 *
 * Инварианты:
 *  - ValidationCore.warning() НЕ блокирует операцию: valid === true,
 *    isWarning === true (раньше valid:false смешивал предупреждение с ошибкой);
 *  - ValidationCore.combine(): ошибки доминируют; только-предупреждения дают
 *    неблокирующий результат;
 *  - ValidationAct.validateTb() находит раздел 5 по id (а не по number —
 *    до генерации нумерации поиск по number молча пропускал проверку);
 *  - NavigationManager._validateTables() показывает предупреждения уровнем
 *    'warning' (не 'info') и не блокирует переход.
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import { ValidationCore } from '../../static/js/constructor/validation/validation-core.js';
import { ValidationAct } from '../../static/js/constructor/validation/validation-act.js';
import { NavigationManager } from '../../static/js/constructor/navigation-manager.js';
import { Notifications } from '../../static/js/shared/notifications.js';

beforeEach(() => {
    AppState.treeData = { id: 'root', label: 'Акт', children: [] };
    AppState.tables = {};
    AppState._rebuildNodeIndex();
});

// ──────────────────────────────────────────────────────────────────────────
// val-1: warning() не блокирует
// ──────────────────────────────────────────────────────────────────────────

test('warning(): valid === true, isWarning === true (предупреждение не блокирует)', () => {
    const result = ValidationCore.warning('что-то не заполнено');
    assert.equal(result.valid, true);
    assert.equal(result.isWarning, true);
    assert.equal(result.message, 'что-то не заполнено');
});

test('combine(): ошибка доминирует над предупреждением → valid false', () => {
    const result = ValidationCore.combine(
        ValidationCore.failure('ошибка'),
        ValidationCore.warning('предупреждение')
    );
    assert.equal(result.valid, false);
    assert.equal(result.isWarning, false);
    assert.equal(result.message, 'ошибка');
});

test('combine(): только предупреждения → valid true + isWarning', () => {
    const result = ValidationCore.combine(
        ValidationCore.success(),
        ValidationCore.warning('w1'),
        ValidationCore.warning('w2')
    );
    assert.equal(result.valid, true);
    assert.equal(result.isWarning, true);
    assert.equal(result.message, 'w1\nw2');
});

test('combine(): только успехи → success', () => {
    const result = ValidationCore.combine(ValidationCore.success(), ValidationCore.success());
    assert.equal(result.valid, true);
    assert.equal(result.isWarning, false);
});

// ──────────────────────────────────────────────────────────────────────────
// val-6: validateTb находит раздел 5 по id
// ──────────────────────────────────────────────────────────────────────────

test('validateTb: раздел 5 находится по id даже без сгенерированной нумерации', () => {
    // У узла раздела номер ещё не проставлен (generateNumbering не звался) —
    // поиск по number молча пропускал бы проверку.
    AppState.treeData = {
        id: 'root',
        label: 'Акт',
        children: [
            {
                id: '5',
                label: 'Раздел 5',
                children: [
                    { id: 'n51', type: 'item', number: '5.1', label: 'Пункт', children: [] },
                ],
            },
        ],
    };
    AppState._rebuildNodeIndex();

    const result = ValidationAct.validateTb();
    assert.equal(result.isWarning, true, 'leaf 5.1 без ТБ обязан давать предупреждение');
    assert.equal(result.valid, true, 'предупреждение не должно блокировать');
    assert.match(result.message, /5\.1/);
});

test('validateTb: все leaf с ТБ → success', () => {
    AppState.treeData = {
        id: 'root',
        label: 'Акт',
        children: [
            {
                id: '5',
                label: 'Раздел 5',
                number: '5',
                children: [
                    { id: 'n51', type: 'item', number: '5.1', label: 'Пункт', tb: ['ББ'], children: [] },
                ],
            },
        ],
    };
    AppState._rebuildNodeIndex();

    const result = ValidationAct.validateTb();
    assert.equal(result.valid, true);
    assert.equal(result.isWarning, false);
});

// ──────────────────────────────────────────────────────────────────────────
// val-1 + val-2: предупреждения в _validateTables — уровень 'warning', без блокировки
// ──────────────────────────────────────────────────────────────────────────

test('_validateTables: tb-предупреждение показывается уровнем warning и не блокирует', () => {
    AppState.treeData = {
        id: 'root',
        label: 'Акт',
        children: [
            {
                id: '5',
                label: 'Раздел 5',
                number: '5',
                children: [
                    { id: 'n51', type: 'item', number: '5.1', label: 'Пункт', children: [] },
                ],
            },
        ],
    };
    AppState.tables = {};
    AppState._rebuildNodeIndex();

    const shown = [];
    const originalShow = Notifications.show;
    Notifications.show = (message, type) => { shown.push({ message, type }); return 'id'; };
    try {
        const ok = NavigationManager._validateTables();
        assert.equal(ok, true, 'предупреждение не должно блокировать переход');
        assert.equal(shown.length, 1);
        assert.equal(shown[0].type, 'warning', 'предупреждение обязано показываться уровнем warning');
        assert.match(shown[0].message, /Не назначен ТБ/);
    } finally {
        Notifications.show = originalShow;
    }
});

test('_validateTables: таблица без данных → предупреждение уровнем warning', () => {
    AppState.tables = {
        t1: {
            id: 't1',
            nodeId: 'n1',
            grid: [
                [{ content: 'A', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 }],
            ],
            colWidths: [100],
        },
    };

    const shown = [];
    const originalShow = Notifications.show;
    Notifications.show = (message, type) => { shown.push({ message, type }); return 'id'; };
    try {
        const ok = NavigationManager._validateTables();
        assert.equal(ok, true);
        assert.equal(shown.length, 1);
        assert.equal(shown[0].type, 'warning');
        assert.match(shown[0].message, /без данных/);
    } finally {
        Notifications.show = originalShow;
    }
});
