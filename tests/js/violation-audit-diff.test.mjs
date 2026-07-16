/**
 * Тесты аудита правок нарушений через diff при сохранении (#17).
 *
 * Раньше журнал изменений фиксировал правки лишь двух полей нарушения
 * (violated/established) через per-keystroke debounce; остальные шесть полей
 * (описания/доп.материалы/причины/принятые меры/последствия/ответственные)
 * проходили бесследно. Теперь снимок нарушений берётся при загрузке акта, а
 * перед КАЖДЫМ flush журнала синтезируется по одной записи modify_violation на
 * каждое изменившееся нарушение — независимо от того, какое поле правилось.
 *
 * Производительность: отпечаток нарушения НЕ содержит base64-байтов картинок
 * (сравнение по id + метаданным: тип/подпись/имя файла/ширина). Правка только
 * байтов url при неизменных id/метаданных изменением НЕ считается.
 *
 * Синтез вшит в ChangelogTracker.flush() (pre-flush hook) → отрабатывает на
 * всех трёх flush-сайтах (авто-сейв, ручной, истечение сессии) автоматически.
 */
import './_browser-stub.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ChangelogTracker } from '../../static/js/constructor/changelog-tracker.js';
import { ViolationAudit } from '../../static/js/constructor/violation/violation-audit.js';

function makeViolation(over = {}) {
    return {
        id: 'v1',
        violated: '',
        established: '',
        descriptionList: { enabled: false, items: [] },
        additionalContent: { enabled: false, items: [] },
        reasons: { enabled: false, content: '' },
        consequences: { enabled: false, content: '' },
        responsible: { enabled: false, content: '' },
        measures: { enabled: false, content: '' },
        ...over,
    };
}

function imageItem(over = {}) {
    return {
        id: 'img1',
        type: 'image',
        url: 'data:image/png;base64,AAAAAAAA',
        caption: '',
        filename: 'photo.png',
        width: 0,
        ...over,
    };
}

/** Число записей modify_violation по нарушению в результате flush. */
function countMods(entries, id = 'v1') {
    return entries.filter(e => e.op === 'modify_violation' && (id == null || e.id === id)).length;
}

beforeEach(() => {
    ChangelogTracker.destroy();
    ChangelogTracker.init('act-1');
    ViolationAudit.reset();
    window.AppState = undefined;
});

afterEach(() => {
    // Снимаем pending _persistTimer (иначе 1s-таймер задерживает выход процесса).
    ChangelogTracker.destroy();
    window.AppState = undefined;
});

// ── Отпечаток (fingerprint) без base64 ─────────────────────────────────────────

test('fingerprint игнорирует байты url картинки, но учитывает метаданные', () => {
    const a = makeViolation({ additionalContent: { enabled: true, items: [imageItem({ url: 'AAAA' })] } });
    const b = makeViolation({ additionalContent: { enabled: true, items: [imageItem({ url: 'ZZZZ' })] } });
    assert.equal(
        ViolationAudit.fingerprint(a),
        ViolationAudit.fingerprint(b),
        'разные байты url при тех же id/метаданных → одинаковый отпечаток',
    );

    const c = makeViolation({ additionalContent: { enabled: true, items: [imageItem({ caption: 'подпись' })] } });
    assert.notEqual(
        ViolationAudit.fingerprint(a),
        ViolationAudit.fingerprint(c),
        'смена подписи → отпечаток меняется',
    );
});

// ── Синтез diff при flush через pre-flush hook ─────────────────────────────────

test('правка reasons.content → одна запись modify_violation на flush', () => {
    const v = makeViolation();
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    v.reasons.content = 'новая причина';
    const entries = ChangelogTracker.flush();

    assert.equal(countMods(entries), 1);
});

test('правка кейса (additionalContent case) → одна запись', () => {
    const v = makeViolation({
        additionalContent: { enabled: true, items: [{ id: 'c1', type: 'case', content: 'старое' }] },
    });
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    v.additionalContent.items[0].content = 'новое описание кейса';
    const entries = ChangelogTracker.flush();

    assert.equal(countMods(entries), 1);
});

test('правка пункта списка описаний → одна запись', () => {
    const v = makeViolation({ descriptionList: { enabled: true, items: ['первый'] } });
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    v.descriptionList.items[0] = 'исправленный';
    const entries = ChangelogTracker.flush();

    assert.equal(countMods(entries), 1);
});

test('правка подписи картинки → одна запись', () => {
    const v = makeViolation({ additionalContent: { enabled: true, items: [imageItem()] } });
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    v.additionalContent.items[0].caption = 'новая подпись';
    const entries = ChangelogTracker.flush();

    assert.equal(countMods(entries), 1);
});

test('правка ширины картинки → одна запись', () => {
    const v = makeViolation({ additionalContent: { enabled: true, items: [imageItem({ width: 0 })] } });
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    v.additionalContent.items[0].width = 50;
    const entries = ChangelogTracker.flush();

    assert.equal(countMods(entries), 1);
});

test('правка двух полей одного нарушения → всё равно одна запись', () => {
    const v = makeViolation();
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    v.violated = 'что нарушено';
    v.reasons.content = 'и причина';
    const entries = ChangelogTracker.flush();

    assert.equal(countMods(entries), 1, 'diff даёт ровно одну запись на нарушение, не по полю');
});

test('нетронутое нарушение → нет записи', () => {
    const v = makeViolation({ violated: 'исходное' });
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    const entries = ChangelogTracker.flush();

    assert.equal(countMods(entries), 0);
});

test('снимок исключает base64: правка ТОЛЬКО байтов url (тот же id/метаданные) → нет записи', () => {
    const v = makeViolation({ additionalContent: { enabled: true, items: [imageItem({ url: 'data:image/png;base64,AAAA' })] } });
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    // Меняем только бинарные байты картинки, id/подпись/имя/ширина прежние.
    v.additionalContent.items[0].url = 'data:image/png;base64,ZZZZ';
    const entries = ChangelogTracker.flush();

    assert.equal(
        countMods(entries), 0,
        'смена только байтов того же id/метаданных изменением не считается (перф-стратегия без клонирования base64)',
    );
});

test('замена картинки (сменились id и filename) → запись', () => {
    const v = makeViolation({ additionalContent: { enabled: true, items: [imageItem({ id: 'imgOld', filename: 'old.png' })] } });
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    v.additionalContent.items[0] = imageItem({ id: 'imgNew', filename: 'new.png' });
    const entries = ChangelogTracker.flush();

    assert.equal(countMods(entries), 1);
});

test('новое нарушение (нет в снимке) → не попадает в modify (его фиксирует add_violation)', () => {
    const v1 = makeViolation();
    const violations = { v1 };
    ViolationAudit.snapshot(violations);

    violations.v2 = makeViolation({ id: 'v2', violated: 'новое нарушение' });
    window.AppState = { violations };

    const entries = ChangelogTracker.flush();

    assert.equal(countMods(entries, null), 0, 'modify только для нарушений, существовавших в снимке');
});

test('несколько изменившихся нарушений → по одной записи на каждое', () => {
    const v1 = makeViolation({ id: 'v1' });
    const v2 = makeViolation({ id: 'v2' });
    const v3 = makeViolation({ id: 'v3' });
    const violations = { v1, v2, v3 };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    v1.violated = 'a';
    v3.reasons.content = 'c';
    const entries = ChangelogTracker.flush();

    assert.equal(countMods(entries, 'v1'), 1);
    assert.equal(countMods(entries, 'v2'), 0, 'нетронутое v2 — без записи');
    assert.equal(countMods(entries, 'v3'), 1);
});

test('ре-снимок после flush+confirmSave: повторный flush без правок → нет записи', () => {
    const v = makeViolation();
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    v.reasons.content = 'x';
    const first = ChangelogTracker.flush();
    assert.equal(countMods(first), 1, 'первый flush фиксирует правку');

    // #5: эталон коммитится только после подтверждённого сохранения — имитируем
    // успешный PUT (без confirmSave второй flush заново обнаружил бы ту же правку).
    ViolationAudit.confirmSave();

    const second = ChangelogTracker.flush();
    assert.equal(countMods(second), 0, 'второй flush после confirmSave — снимок переустановлен на текущее');
});

// ── #5: снимок коммитится только после подтверждённого сохранения ─────────────

test('#5 synthesize БЕЗ confirmSave не сдвигает эталон: неудачное сохранение не теряет правку', () => {
    const v = makeViolation();
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    v.reasons.content = 'правка при сбое сохранения';
    const first = ChangelogTracker.flush();
    assert.equal(countMods(first), 1, 'первый flush (== неудачный save) фиксирует правку в журнале');

    // confirmSave НЕ вызывается — имитация неудачного PUT (resp.ok === false).
    const second = ChangelogTracker.flush();
    assert.equal(countMods(second), 1, 'повторный synthesize без confirmSave снова видит ту же правку — она не потеряна');
});

test('#5 confirmSave коммитит отложенный снимок: повторный synthesize без новых правок ничего не пишет', () => {
    const v = makeViolation();
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    window.AppState = { violations };

    v.reasons.content = 'подтверждённая правка';
    ChangelogTracker.flush();
    ViolationAudit.confirmSave();

    const entries = ChangelogTracker.flush();
    assert.equal(countMods(entries), 0, 'после confirmSave эталон = текущее состояние — новых записей нет');
});

test('flush без AppState / без нарушений не падает и не пишет modify', () => {
    window.AppState = undefined;
    assert.doesNotThrow(() => ChangelogTracker.flush());

    window.AppState = { violations: null };
    const entries = ChangelogTracker.flush();
    assert.equal(countMods(entries, null), 0);
});

test('synthesize напрямую: одна запись на изменившееся нарушение', () => {
    const calls = [];
    const orig = ChangelogTracker.record;
    ChangelogTracker.record = (...a) => calls.push(a);
    try {
        const v = makeViolation();
        const violations = { v1: v };
        ViolationAudit.snapshot(violations);
        v.consequences.content = 'последствие';
        ViolationAudit.synthesize(violations);
    } finally {
        ChangelogTracker.record = orig;
    }
    const mods = calls.filter(([op, id]) => op === 'modify_violation' && id === 'v1');
    assert.equal(mods.length, 1);
    assert.equal(mods[0][2], 'Нарушение', 'имя записи — «Нарушение» (как у add_violation)');
});

// ── #5 напрямую через synthesize/confirmSave (без ChangelogTracker.flush) ─────

test('#5a synthesize пишет modify и НЕ сдвигает _snapshot до confirmSave', () => {
    const v = makeViolation();
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);
    const baselineBefore = ViolationAudit._snapshot.get('v1');

    v.violated = 'изменено';
    const calls = [];
    const orig = ChangelogTracker.record;
    ChangelogTracker.record = (...a) => calls.push(a);
    try {
        ViolationAudit.synthesize(violations);
    } finally {
        ChangelogTracker.record = orig;
    }

    assert.equal(calls.filter(([op, id]) => op === 'modify_violation' && id === 'v1').length, 1,
        'synthesize зафиксировал правку');
    assert.equal(ViolationAudit._snapshot.get('v1'), baselineBefore,
        'эталон НЕ сдвинут — confirmSave ещё не вызывался');
});

test('#5b имитация неудачного сохранения: synthesize без confirmSave, второй synthesize той же правки снова пишет', () => {
    const v = makeViolation();
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);

    v.violated = 'правка, потерянная бы при старом баге';
    const calls = [];
    const orig = ChangelogTracker.record;
    ChangelogTracker.record = (...a) => calls.push(a);
    try {
        ViolationAudit.synthesize(violations); // == pre-flush hook перед неудачным PUT
        // confirmSave НЕ вызывается — PUT вернул ошибку.
        ViolationAudit.synthesize(violations); // == следующий цикл сохранения
    } finally {
        ChangelogTracker.record = orig;
    }

    const mods = calls.filter(([op, id]) => op === 'modify_violation' && id === 'v1');
    assert.equal(mods.length, 2, 'правка не потеряна — каждый synthesize без confirmSave заново её видит');
});

test('#5c synthesize + confirmSave коммитит эталон: следующий synthesize без новых правок ничего не пишет', () => {
    const v = makeViolation();
    const violations = { v1: v };
    ViolationAudit.snapshot(violations);

    v.violated = 'подтверждённая правка';
    const calls = [];
    const orig = ChangelogTracker.record;
    ChangelogTracker.record = (...a) => calls.push(a);
    try {
        ViolationAudit.synthesize(violations);
        ViolationAudit.confirmSave(); // == успешный PUT
        ViolationAudit.synthesize(violations); // нарушение не менялось после confirmSave
    } finally {
        ChangelogTracker.record = orig;
    }

    const mods = calls.filter(([op, id]) => op === 'modify_violation' && id === 'v1');
    assert.equal(mods.length, 1, 'вторая правка не найдена — эталон уже = сохранённое состояние');
});

test('#5 confirmSave без предшествующего synthesize — безопасный no-op', () => {
    ViolationAudit.reset();
    assert.doesNotThrow(() => ViolationAudit.confirmSave());
});

test('#5 synthesize без нарушений не создаёт бессмысленный pending-снимок (ранний return)', () => {
    ViolationAudit.reset();
    ViolationAudit.snapshot({ v1: makeViolation() });
    const baselineBefore = ViolationAudit._snapshot.get('v1');

    ViolationAudit.synthesize(null);
    assert.equal(ViolationAudit._pendingSnapshot, null, 'ранний return — pending не создан');

    ViolationAudit.confirmSave();
    assert.equal(ViolationAudit._snapshot.get('v1'), baselineBefore, 'эталон не пострадал от no-op confirmSave');
});
