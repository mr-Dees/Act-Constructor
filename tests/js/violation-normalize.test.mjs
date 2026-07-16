/**
 * Тесты нормализации формы нарушения на загрузке акта (находка аудита #20).
 *
 * normalizeViolations до-заполняет ТОЛЬКО отсутствующие под-объекты/скаляры
 * эталонной формой (createDefaultViolationShape), не перезатирая валидные
 * данные. Модуль без DOM — импортируется напрямую под node:test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createDefaultViolationShape,
    normalizeViolations,
} from '../../static/js/constructor/violation/violation-normalize.js';

test('violations undefined → ранний return, changed=false/count=0', () => {
    assert.deepEqual(normalizeViolations(undefined), { changed: false, count: 0 });
});

test('пустой словарь нарушений → changed=false/count=0', () => {
    assert.deepEqual(normalizeViolations({}), { changed: false, count: 0 });
});

test('нарушение без measures → до-заполнено эталоном, форма не падает', () => {
    const violations = {
        v1: {
            id: 'v1',
            nodeId: 'n1',
            violated: 'текст',
            established: 'установлено',
            descriptionList: { enabled: false, items: [] },
            additionalContent: { enabled: false, items: [] },
            reasons: { enabled: false, content: '' },
            consequences: { enabled: false, content: '' },
            responsible: { enabled: false, content: '' },
            // measures отсутствует целиком (старый/повреждённый акт)
        },
    };

    const result = normalizeViolations(violations);

    assert.equal(result.changed, true);
    assert.equal(result.count, 1);
    assert.deepEqual(violations.v1.measures, { enabled: false, content: '' });
});

test('нарушение без ЛЮБОГО под-объекта (полностью старый формат) → все поля дозаполнены', () => {
    const violations = {
        v1: { id: 'v1', nodeId: 'n1' },
    };

    const result = normalizeViolations(violations);

    assert.equal(result.changed, true);
    assert.equal(result.count, 1);
    const { id, nodeId, ...rest } = violations.v1;
    assert.deepEqual(rest, createDefaultViolationShape());
});

test('под-объект присутствует, но без части ключей → дозаполняются только отсутствующие', () => {
    const violations = {
        v1: {
            id: 'v1',
            nodeId: 'n1',
            reasons: { enabled: true }, // content отсутствует
        },
    };

    normalizeViolations(violations);

    assert.deepEqual(violations.v1.reasons, { enabled: true, content: '' });
});

test('валидные данные НЕ перезатираются (значения сохранены как есть)', () => {
    const violations = {
        v1: {
            id: 'v1',
            nodeId: 'n1',
            violated: 'уже заполнено',
            established: 'тоже заполнено',
            descriptionList: { enabled: true, items: ['п1', 'п2'] },
            additionalContent: { enabled: true, items: [{ id: 'i1', type: 'case', content: 'x' }] },
            reasons: { enabled: true, content: 'причина' },
            consequences: { enabled: true, content: 'последствие' },
            responsible: { enabled: true, content: 'иванов' },
            measures: { enabled: true, content: 'меры' },
        },
    };
    const snapshot = JSON.parse(JSON.stringify(violations.v1));

    const result = normalizeViolations(violations);

    assert.equal(result.changed, false);
    assert.equal(result.count, 0);
    assert.deepEqual(violations.v1, snapshot);
});

test('несколько нарушений: count считает только реально изменённые', () => {
    const violations = {
        v1: {
            id: 'v1',
            nodeId: 'n1',
            violated: '',
            established: '',
            descriptionList: { enabled: false, items: [] },
            additionalContent: { enabled: false, items: [] },
            reasons: { enabled: false, content: '' },
            consequences: { enabled: false, content: '' },
            responsible: { enabled: false, content: '' },
            measures: { enabled: false, content: '' },
        },
        v2: { id: 'v2', nodeId: 'n2' }, // старый формат — потребует дозаполнения
    };

    const result = normalizeViolations(violations);

    assert.equal(result.changed, true);
    assert.equal(result.count, 1, 'только v2 потребовал дозаполнения');
});

test('createDefaultViolationShape: каждый вызов возвращает независимый объект (без общих ссылок)', () => {
    const a = createDefaultViolationShape();
    const b = createDefaultViolationShape();
    a.reasons.content = 'мутация a';
    assert.equal(b.reasons.content, '', 'b не затронут мутацией a');
});
