/**
 * Общий рендер картинки нарушения с fallback на плейсхолдер (#27).
 *
 * Реального события onerror браузера здесь нет (data:-URL в стабе не грузится
 * по сети) — проверяем контракт хелпера: порядок onerror ДО src и корректную
 * замену container на плейсхолдер при вызове onerror вручную. Визуальная
 * проверка настоящей битой картинки (network-fail) — live/Playwright.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildImagePlaceholder,
    renderImageWithFallback,
} from '../../static/js/constructor/violation/violation-image-render.js';

/**
 * Простой фейковый контейнер с трекингом детей (appendChild/replaceChildren) —
 * стаб из _browser-stub.mjs их не поддерживает, а тестировать fallback без
 * них нельзя.
 *
 * @returns {Object} Контейнер-стаб с массивом children
 */
function makeContainer() {
    const children = [];
    return {
        children,
        appendChild(el) { children.push(el); return el; },
        replaceChildren(...nodes) { children.length = 0; children.push(...nodes); },
    };
}

test('buildImagePlaceholder — div с текстом и переданным классом', () => {
    const el = buildImagePlaceholder('Изображение: x.png', 'my-placeholder-class');
    assert.equal(el.className, 'my-placeholder-class');
    assert.equal(el.textContent, 'Изображение: x.png');
});

test('renderImageWithFallback — onerror навешан ДО src (защита от гонки на закэшированной ошибке)', () => {
    const container = makeContainer();
    const origCreate = document.createElement;
    let onerrorSetBeforeSrc = null;
    document.createElement = (tag) => {
        const el = origCreate(tag);
        if (tag === 'img') {
            Object.defineProperty(el, 'src', {
                set() {
                    onerrorSetBeforeSrc = typeof el.onerror === 'function';
                },
                get() { return undefined; },
            });
        }
        return el;
    };
    try {
        renderImageWithFallback(container, {
            src: 'data:image/png;base64,AAAA',
            placeholderText: 'Изображение: x.png',
            placeholderClassName: 'ph',
        });
    } finally {
        document.createElement = origCreate;
    }
    assert.equal(onerrorSetBeforeSrc, true, 'onerror должен быть навешан до присвоения src');
});

test('renderImageWithFallback — img добавлен в container с переданным классом/alt', () => {
    const container = makeContainer();
    const img = renderImageWithFallback(container, {
        src: 'data:image/png;base64,AAAA',
        alt: 'подпись',
        imgClassName: 'my-img-class',
        placeholderText: 'Изображение: x.png',
        placeholderClassName: 'ph',
    });
    assert.equal(container.children[0], img);
    assert.equal(img.className, 'my-img-class');
    assert.equal(img.alt, 'подпись');
});

test('renderImageWithFallback — configureImg вызывается до src (может выставлять стили/атрибуты)', () => {
    const container = makeContainer();
    let sawStyleBeforeSrcSet = false;
    const origCreate = document.createElement;
    document.createElement = (tag) => {
        const el = origCreate(tag);
        if (tag === 'img') {
            Object.defineProperty(el, 'src', {
                set() { sawStyleBeforeSrcSet = el.style.maxHeight === '100mm'; },
                get() { return undefined; },
            });
        }
        return el;
    };
    try {
        renderImageWithFallback(container, {
            src: 'data:image/png;base64,AAAA',
            placeholderText: 'x',
            placeholderClassName: 'ph',
            configureImg: (img) => { img.style.maxHeight = '100mm'; },
        });
    } finally {
        document.createElement = origCreate;
    }
    assert.equal(sawStyleBeforeSrcSet, true, 'configureImg должен применяться до src');
});

test('renderImageWithFallback — onerror заменяет container текстовым плейсхолдером (#27)', () => {
    const container = makeContainer();
    const img = renderImageWithFallback(container, {
        src: 'data:image/broken',
        placeholderText: 'Изображение: broken.png',
        placeholderClassName: 'ph-class',
    });
    // Симулируем ошибку загрузки вручную (реальный network-fail — live).
    img.onerror();
    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].className, 'ph-class');
    assert.equal(container.children[0].textContent, 'Изображение: broken.png');
});
