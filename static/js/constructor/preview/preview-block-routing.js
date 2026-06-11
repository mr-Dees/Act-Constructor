/**
 * Чистая маршрутизация точечного обновления блока превью (перф-волна, M.7).
 *
 * Решает, что делать с контентной правкой одного блока:
 *  - 'patch' — точечная замена DOM-элемента блока;
 *  - 'skip'  — DOM трогать не нужно (скрытый пустой текстблок остался пустым);
 *  - 'full'  — fallback на полную пересборку превью (промах индекса,
 *    появление/исчезновение блока, неизвестный тип).
 *
 * Без DOM и без AppState — тестируется в node:test напрямую
 * (tests/js/preview-block-routing.test.mjs).
 */

/** Типы блоков превью, поддерживающие точечный патч. */
export const PATCHABLE_BLOCK_KINDS = Object.freeze(['table', 'textblock', 'violation']);

/**
 * Решение по точечному обновлению блока превью.
 *
 * @param {string} kind - Тип блока ('table' | 'textblock' | 'violation')
 * @param {Object} state - Наблюдаемое состояние блока
 * @param {boolean} state.hasElement - Элемент блока есть в индексе и подключён к DOM
 * @param {boolean} state.hasData - Данные блока есть в словаре состояния
 * @param {boolean} [state.hasContent] - Текстблок непуст (рендерится только непустой)
 * @returns {'patch'|'skip'|'full'}
 */
export function decideBlockPatch(kind, { hasElement, hasData, hasContent = true }) {
    if (kind === 'table' || kind === 'violation') {
        return (hasElement && hasData) ? 'patch' : 'full';
    }
    if (kind === 'textblock') {
        if (!hasData) return 'full';
        if (hasContent) {
            // Контент есть: патчим существующий элемент; если элемента нет —
            // блок только что стал непустым → нужна полная пересборка (вставка).
            return hasElement ? 'patch' : 'full';
        }
        // Контента нет: скрытый блок остался скрытым — DOM не трогаем;
        // если элемент есть — блок стал пустым → убрать может только полная пересборка.
        return hasElement ? 'full' : 'skip';
    }
    return 'full';
}
