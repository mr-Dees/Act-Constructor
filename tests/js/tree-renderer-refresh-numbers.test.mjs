/**
 * Регрессия сужённой сверки нумерации в TreeRenderer (Finding 14).
 *
 * renderSubtree раньше после пересборки поддерева звал refreshNumbers(),
 * который обходил ВЕСЬ _domIndex (O(всех узлов)). Все перенумерованные узлы
 * лежат внутри пересобранного поддерева, поэтому обход сужен до него —
 * _refreshNumbersIn(rootLi). Тест проверяет, что сужённая сверка:
 *   - перенумеровывает сиблингов и их потомков внутри поддерева
 *     (5.3 → 5.2, 5.3.1 → 5.2.1 после удаления среднего §5.x);
 *   - НЕ трогает узлы вне поддерева.
 *
 * Реальный DOM здесь не нужен (createNodeElement тянет AppConfig/обработчики);
 * собираем минимальную DOM-модель под ровно те селекторы, что читает
 * _refreshNumbersIn/_updateLiLabelText (':scope > .tree-*', 'li.tree-item').
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TreeRenderer } from '../../static/js/constructor/tree/tree-renderer.js';
import { AppState } from '../../static/js/constructor/state/state-core.js';

// ── Минимальная DOM-модель ─────────────────────────────────────────────────

/**
 * Узел DOM с поддержкой className, dataset, textContent, дочерних элементов
 * и querySelector(All) по селекторам ':scope > .class' и 'li.tree-item'.
 */
class FakeEl {
    constructor(tag = 'div') {
        this.tag = tag;
        this.className = '';
        this.dataset = {};
        this.children = [];
        this.parentNode = null;
        this._text = '';
    }

    get classList() {
        const self = this;
        return {
            add(c) { if (!self._classes().includes(c)) self.className = (self.className + ' ' + c).trim(); },
            remove(c) { self.className = self._classes().filter(x => x !== c).join(' '); },
            contains(c) { return self._classes().includes(c); },
        };
    }

    _classes() {
        return this.className.split(/\s+/).filter(Boolean);
    }

    set textContent(v) {
        // Установка текста схлопывает дочерние текстовые узлы (как в DOM).
        this._text = v;
        this.children = [];
    }

    get textContent() {
        if (this.children.length === 0) return this._text;
        return this.children.map(c => c.textContent).join('');
    }

    get firstChild() {
        return this.children[0] || null;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    insertBefore(child, ref) {
        child.parentNode = this;
        const idx = ref ? this.children.indexOf(ref) : -1;
        if (idx === -1) this.children.push(child);
        else this.children.splice(idx, 0, child);
        return child;
    }

    /** Поддержка ':scope > .class' (прямые дети) и обхода для li.tree-item. */
    querySelector(sel) {
        return this._query(sel, true);
    }

    querySelectorAll(sel) {
        return this._query(sel, false);
    }

    _query(sel, single) {
        const m = sel.match(/^:scope\s*>\s*\.([\w-]+)$/);
        if (m) {
            const cls = m[1];
            const hits = this.children.filter(c => c._classes().includes(cls));
            return single ? (hits[0] || null) : hits;
        }
        if (sel === 'li.tree-item') {
            const out = [];
            const walk = (el) => {
                for (const c of el.children) {
                    if (c.tag === 'li' && c._classes().includes('tree-item')) out.push(c);
                    walk(c);
                }
            };
            walk(this);
            return single ? (out[0] || null) : out;
        }
        throw new Error('Неподдерживаемый селектор в тесте: ' + sel);
    }
}

/** Локальная фабрика DOM-элементов теста (не зависит от глобального document). */
const doc = { createElement: (tag) => new FakeEl(tag) };

// ── Построение li для item-узла (как _createBaseLiElement + _createLabel) ───

/**
 * Создаёт li.tree-item для item-узла: span.tree-label > span.tree-node-number
 * (если есть номер) + span.tree-node-text. Структура воспроизводит вывод
 * TreeRenderer._createLabel для item-типов.
 */
function makeItemLi(doc, node) {
    const li = doc.createElement('li');
    li.className = 'tree-item';
    li.dataset.nodeId = node.id;

    const label = doc.createElement('span');
    label.className = 'tree-label';
    if (node.number) {
        const num = doc.createElement('span');
        num.className = 'tree-node-number';
        num.textContent = node.number + '. ';
        label.appendChild(num);
    }
    const txt = doc.createElement('span');
    txt.className = 'tree-node-text';
    txt.textContent = node.label;
    label.appendChild(txt);

    li.appendChild(label);
    return li;
}

/** Возвращает отрисованный текст номера для узла (или null, если номера нет). */
function numberText(li) {
    const label = li.querySelector(':scope > .tree-label');
    const num = label.querySelector(':scope > .tree-node-number');
    return num ? num.textContent : null;
}

// ── Тесты ───────────────────────────────────────────────────────────────────

test('_refreshNumbersIn: перенумеровывает сиблингов и потомков внутри поддерева', () => {
    // Состояние ПОСЛЕ удаления среднего §5.x: бывший 5.3 стал 5.2,
    // его ребёнок 5.3.1 — 5.2.1. _nodeIndex держит новые номера.
    const parent = { id: 'sec5', type: 'item', number: '5', label: 'Раздел' };
    const child = { id: 'c2', type: 'item', number: '5.2', label: 'Второй пункт' };
    const grand = { id: 'g1', type: 'item', number: '5.2.1', label: 'Подпункт' };

    AppState._nodeIndex = new Map([
        [parent.id, parent],
        [child.id, child],
        [grand.id, grand],
    ]);

    // DOM пока несёт СТАРЫЕ номера (5.3 / 5.3.1) — до сверки.
    const parentLi = makeItemLi(doc, { id: 'sec5', number: '5', label: 'Раздел' });
    const childLi = makeItemLi(doc, { id: 'c2', number: '5.3', label: 'Второй пункт' });
    const grandLi = makeItemLi(doc, { id: 'g1', number: '5.3.1', label: 'Подпункт' });
    childLi.appendChild(grandLi);
    parentLi.appendChild(childLi);

    const renderer = Object.create(TreeRenderer.prototype);
    renderer._refreshNumbersIn(parentLi);

    assert.equal(numberText(childLi), '5.2. ', '5.3 должен стать 5.2');
    assert.equal(numberText(grandLi), '5.2.1. ', '5.3.1 должен стать 5.2.1');
    assert.equal(numberText(parentLi), '5. ', 'номер корня поддерева не меняется');
});

test('_refreshNumbersIn: не трогает узлы вне переданного поддерева', () => {
    const inside = { id: 'in', type: 'item', number: '5.2', label: 'Внутри' };
    const outside = { id: 'out', type: 'item', number: '5.9', label: 'Снаружи' };
    AppState._nodeIndex = new Map([
        [inside.id, inside],
        [outside.id, outside],
    ]);

    const insideLi = makeItemLi(doc, { id: 'in', number: '5.3', label: 'Внутри' });
    // Узел снаружи несёт «устаревший» номер, отличный от _nodeIndex —
    // сужённая сверка обязана его проигнорировать.
    const outsideLi = makeItemLi(doc, { id: 'out', number: 'СТАРЫЙ', label: 'Снаружи' });

    const renderer = Object.create(TreeRenderer.prototype);
    renderer._refreshNumbersIn(insideLi);

    assert.equal(numberText(insideLi), '5.2. ', 'узел внутри поддерева перенумерован');
    assert.equal(numberText(outsideLi), 'СТАРЫЙ. ', 'узел вне поддерева не тронут');
});

test('_refreshNumbersIn: безопасен при rootLi=null', () => {
    const renderer = Object.create(TreeRenderer.prototype);
    assert.doesNotThrow(() => renderer._refreshNumbersIn(null));
});
