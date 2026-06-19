import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ItemsTitleEditing } from '../../static/js/constructor/items/items-title-editing.js';

function fakeTitleEl() {
    let editing = false;
    return {
        classList: { contains: () => editing, add: () => { editing = true; }, remove: () => { editing = false; } },
        _entered: () => editing,
    };
}

test('startEditingItemTitle не входит в режим редактирования для titleLocked', () => {
    const el = fakeTitleEl();
    ItemsTitleEditing.startEditingItemTitle(el, { label: 'X', titleLocked: true });
    assert.equal(el._entered(), false);
});
