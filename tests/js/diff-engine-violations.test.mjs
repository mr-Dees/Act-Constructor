/**
 * Тесты расширенного диффа нарушений (#8, вариант А): список описаний
 * (descriptionList), доп.контент (additionalContent) и флаги enabled
 * опциональных текстовых полей.
 *
 * Раньше `_diffViolations` перебирал только 6 скалярных полей, а
 * descriptionList/additionalContent проходили бесследно («без изменений»).
 * Теперь движок строит структурные под-диффы:
 *   - descriptionList — пер-элементный diff по позиции (added/removed/modified,
 *     modified → word-diff);
 *   - additionalContent — матчинг по item.id (added/removed/modified/reordered),
 *     case/freeText → word-diff по content, image → строковое сравнение
 *     url/caption/filename/width (base64-url НЕ гоняется через word-diff);
 *   - enabled опц.поля канонизируется как '' → выключение поля при том же
 *     content видно как изменение.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiffEngine } from '../../static/js/portal/acts-manager/diff-engine.js';

function makeViol(over = {}) {
    return {
        id: 'v1',
        violated: '',
        established: '',
        descriptionList: { enabled: false, items: [] },
        additionalContent: { enabled: false, items: [] },
        reasons: { enabled: false, content: '' },
        consequences: { enabled: false, content: '' },
        responsible: { enabled: false, content: '' },
        recommendations: { enabled: false, content: '' },
        ...over,
    };
}

function diffOne(oldV, newV) {
    return DiffEngine._diffViolations({ v1: oldV }, { v1: newV }).v1;
}

// --- descriptionList --------------------------------------------------------

test('descriptionList: изменение пункта → modified + word-diff по позиции', () => {
    const oldV = makeViol({ descriptionList: { enabled: true, items: ['первый пункт', 'второй пункт'] } });
    const newV = makeViol({ descriptionList: { enabled: true, items: ['первый пункт изменён', 'второй пункт'] } });
    const d = diffOne(oldV, newV);

    assert.equal(d.status, 'modified');
    const dl = d.fieldDiffs.descriptionList;
    assert.equal(dl.kind, 'list');
    assert.equal(dl.changed, true);
    assert.equal(dl.items[0].status, 'modified');
    assert.ok(Array.isArray(dl.items[0].wordDiff));
    assert.equal(dl.items[1].status, 'unchanged');
});

test('descriptionList: добавление пункта → added', () => {
    const oldV = makeViol({ descriptionList: { enabled: true, items: ['a'] } });
    const newV = makeViol({ descriptionList: { enabled: true, items: ['a', 'b'] } });
    const dl = diffOne(oldV, newV).fieldDiffs.descriptionList;
    assert.equal(dl.items[0].status, 'unchanged');
    assert.equal(dl.items[1].status, 'added');
    assert.equal(dl.items[1].new, 'b');
});

test('descriptionList: удаление пункта → removed', () => {
    const oldV = makeViol({ descriptionList: { enabled: true, items: ['a', 'b'] } });
    const newV = makeViol({ descriptionList: { enabled: true, items: ['a'] } });
    const dl = diffOne(oldV, newV).fieldDiffs.descriptionList;
    assert.equal(dl.items[0].status, 'unchanged');
    assert.equal(dl.items[1].status, 'removed');
    assert.equal(dl.items[1].old, 'b');
});

test('descriptionList: выключение списка при тех же items → items removed', () => {
    const oldV = makeViol({ descriptionList: { enabled: true, items: ['a', 'b'] } });
    const newV = makeViol({ descriptionList: { enabled: false, items: ['a', 'b'] } });
    const d = diffOne(oldV, newV);
    assert.equal(d.status, 'modified');
    const dl = d.fieldDiffs.descriptionList;
    assert.equal(dl.changed, true);
    assert.ok(dl.items.every(it => it.status === 'removed'));
});

test('descriptionList: выключенный список в обеих версиях → без изменений', () => {
    const oldV = makeViol({ descriptionList: { enabled: false, items: ['a'] } });
    const newV = makeViol({ descriptionList: { enabled: false, items: ['a', 'b', 'c'] } });
    const d = diffOne(oldV, newV);
    assert.equal(d.status, 'unchanged');
    assert.equal(d.fieldDiffs.descriptionList, undefined);
});

// --- additionalContent: case / freeText -------------------------------------

test('additionalContent: изменение кейса → modified + word-diff', () => {
    const oldV = makeViol({ additionalContent: { enabled: true, items: [{ id: 'c1', type: 'case', content: 'старый кейс' }] } });
    const newV = makeViol({ additionalContent: { enabled: true, items: [{ id: 'c1', type: 'case', content: 'новый кейс' }] } });
    const d = diffOne(oldV, newV);
    assert.equal(d.status, 'modified');
    const ac = d.fieldDiffs.additionalContent;
    assert.equal(ac.kind, 'additional');
    assert.equal(ac.entries[0].status, 'modified');
    assert.ok(Array.isArray(ac.entries[0].wordDiff));
});

test('additionalContent: добавление кейса → added, удаление → removed', () => {
    const oldV = makeViol({ additionalContent: { enabled: true, items: [{ id: 'c1', type: 'case', content: 'A' }] } });
    const newV = makeViol({ additionalContent: { enabled: true, items: [{ id: 'c2', type: 'case', content: 'B' }] } });
    const ac = diffOne(oldV, newV).fieldDiffs.additionalContent;
    const added = ac.entries.find(e => e.status === 'added');
    const removed = ac.entries.find(e => e.status === 'removed');
    assert.equal(added.newItem.id, 'c2');
    assert.equal(removed.oldItem.id, 'c1');
});

test('additionalContent: перестановка кейсов → reordered', () => {
    const items = [
        { id: 'c1', type: 'case', content: 'A' },
        { id: 'c2', type: 'case', content: 'B' },
    ];
    const oldV = makeViol({ additionalContent: { enabled: true, items } });
    const newV = makeViol({ additionalContent: { enabled: true, items: [items[1], items[0]] } });
    const d = diffOne(oldV, newV);
    assert.equal(d.status, 'modified');
    const ac = d.fieldDiffs.additionalContent;
    assert.ok(ac.entries.some(e => e.status === 'reordered'));
});

// --- additionalContent: image -----------------------------------------------

test('additionalContent: добавление картинки → added', () => {
    const oldV = makeViol({ additionalContent: { enabled: true, items: [] } });
    const newV = makeViol({ additionalContent: { enabled: true, items: [{ id: 'i1', type: 'image', url: 'data:image/png;base64,AAAA', caption: 'подпись', filename: 'p.png', width: 50 }] } });
    const ac = diffOne(oldV, newV).fieldDiffs.additionalContent;
    assert.equal(ac.entries[0].status, 'added');
    assert.equal(ac.entries[0].newItem.id, 'i1');
});

test('additionalContent: смена url картинки → modified, поле url в fields, БЕЗ word-diff', () => {
    const oldV = makeViol({ additionalContent: { enabled: true, items: [{ id: 'i1', type: 'image', url: 'data:image/png;base64,AAAA', caption: 'c', filename: 'p.png', width: 0 }] } });
    const newV = makeViol({ additionalContent: { enabled: true, items: [{ id: 'i1', type: 'image', url: 'data:image/png;base64,BBBB', caption: 'c', filename: 'p.png', width: 0 }] } });
    const ac = diffOne(oldV, newV).fieldDiffs.additionalContent;
    const e = ac.entries[0];
    assert.equal(e.status, 'modified');
    assert.ok(e.fields.url);
    assert.equal(e.fields.url.old, 'data:image/png;base64,AAAA');
    assert.equal(e.fields.url.new, 'data:image/png;base64,BBBB');
    assert.equal(e.wordDiff, undefined, 'image-diff НЕ должен нести word-diff');
});

test('additionalContent: смена подписи/ширины картинки → соответствующие fields', () => {
    const oldV = makeViol({ additionalContent: { enabled: true, items: [{ id: 'i1', type: 'image', url: 'u', caption: 'старая', filename: 'p.png', width: 0 }] } });
    const newV = makeViol({ additionalContent: { enabled: true, items: [{ id: 'i1', type: 'image', url: 'u', caption: 'новая', filename: 'p.png', width: 60 }] } });
    const e = diffOne(oldV, newV).fieldDiffs.additionalContent.entries[0];
    assert.equal(e.status, 'modified');
    assert.equal(e.fields.caption.old, 'старая');
    assert.equal(e.fields.caption.new, 'новая');
    assert.equal(String(e.fields.width.new), '60');
    assert.equal(e.fields.url, undefined);
});

test('additionalContent: огромный base64-url НЕ гоняется через _wordDiff (строковое сравнение, без зависания)', () => {
    const bigA = 'data:image/png;base64,' + 'A'.repeat(3_000_000);
    const bigB = 'data:image/png;base64,' + 'B'.repeat(3_000_000);
    const oldV = makeViol({ additionalContent: { enabled: true, items: [{ id: 'i1', type: 'image', url: bigA, caption: '', filename: 'p.png', width: 0 }] } });
    const newV = makeViol({ additionalContent: { enabled: true, items: [{ id: 'i1', type: 'image', url: bigB, caption: '', filename: 'p.png', width: 0 }] } });

    const orig = DiffEngine._wordDiff;
    DiffEngine._wordDiff = () => { throw new Error('_wordDiff вызван на url картинки'); };
    try {
        const start = Date.now();
        const e = diffOne(oldV, newV).fieldDiffs.additionalContent.entries[0];
        assert.equal(e.status, 'modified');
        assert.ok(e.fields.url, 'url помечен как изменённый');
        assert.ok(Date.now() - start < 1000, 'сравнение url должно быть мгновенным');
    } finally {
        DiffEngine._wordDiff = orig;
    }
});

// --- enabled опц.полей ------------------------------------------------------

test('опц.поле: выключение при том же content → изменение (канонизация в пустое)', () => {
    const oldV = makeViol({ reasons: { enabled: true, content: 'причина' } });
    const newV = makeViol({ reasons: { enabled: false, content: 'причина' } });
    const d = diffOne(oldV, newV);
    assert.equal(d.status, 'modified');
    assert.equal(d.fieldDiffs.reasons.changed, true);
    assert.equal(d.fieldDiffs.reasons.old, 'причина');
    assert.equal(d.fieldDiffs.reasons.new, '');
});

test('опц.поле: включение поля → изменение', () => {
    const oldV = makeViol({ consequences: { enabled: false, content: 'текст' } });
    const newV = makeViol({ consequences: { enabled: true, content: 'текст' } });
    const d = diffOne(oldV, newV);
    assert.equal(d.fieldDiffs.consequences.old, '');
    assert.equal(d.fieldDiffs.consequences.new, 'текст');
});

test('опц.поле: выключено в обеих версиях при том же content → без изменений', () => {
    const oldV = makeViol({ responsible: { enabled: false, content: 'кто-то' } });
    const newV = makeViol({ responsible: { enabled: false, content: 'кто-то' } });
    assert.equal(diffOne(oldV, newV).status, 'unchanged');
});

// --- нет изменений ----------------------------------------------------------

test('идентичные нарушения → unchanged, пустой fieldDiffs', () => {
    const v = makeViol({
        violated: 'x',
        descriptionList: { enabled: true, items: ['a'] },
        additionalContent: { enabled: true, items: [{ id: 'c1', type: 'case', content: 'k' }] },
    });
    const d = diffOne(v, JSON.parse(JSON.stringify(v)));
    assert.equal(d.status, 'unchanged');
    assert.deepEqual(d.fieldDiffs, {});
});
