/**
 * Чистая функция нумерации дополнительного контента нарушения.
 *
 * Единый источник правила нумерации кейсов, ранее продублированного в форме,
 * превью и трёх экспортёрах (корень расхождения #9). Модуль без DOM —
 * тестируется под node:test; Python-экспортёры сверяются с ним golden-тестом.
 *
 * Решение пользователя (Q1): рендерим ВСЁ, включая пустое. Нумеруются ВСЕ
 * кейсы (в т.ч. пустые); счётчик кейсов сбрасывается на любом НЕ-кейсе
 * (image/freeText).
 */
import { CONTENT_TYPE_CASE } from './violation-content-item.js';

/**
 * Вычисляет номера элементов дополнительного контента.
 *
 * @param {Array<Object>} items - Элементы дополнительного контента (order
 *        соответствует позиции в массиве)
 * @returns {Array<{ id: *, kind: string, number: (number|null), visible: boolean }>}
 *          Массив той же длины и порядка, что items. Для кейсов number —
 *          сквозной номер (с 1); для остальных типов — null. visible всегда
 *          true (рендерится всё, включая пустое).
 */
export function computeAdditionalContentNumbers(items) {
    if (!Array.isArray(items)) {
        return [];
    }

    let currentCaseNumber = 0;

    return items.map((item) => {
        let number = null;

        if (item.type === CONTENT_TYPE_CASE) {
            currentCaseNumber++;
            number = currentCaseNumber;
        } else {
            currentCaseNumber = 0;
        }

        return { id: item.id, kind: item.type, number, visible: true };
    });
}

if (typeof window !== 'undefined') {
    window.computeAdditionalContentNumbers = computeAdditionalContentNumbers;
}
