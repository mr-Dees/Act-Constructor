/**
 * Универсальный движок клиентской фильтрации списков.
 *
 * Принимает массив объектов и описание фильтров; возвращает отфильтрованный массив.
 * Используется в audit-log диалоге и других местах, где нужна комбинированная
 * фильтрация по типам полей: set (вхождение в множество), text (подстрока,
 * регистронезависимо), date-range (диапазон дат).
 *
 * Пример:
 *   FilterEngine.apply(items, [
 *     { type: 'set', field: 'action', values: ['create', 'update'] },
 *     { type: 'text', field: 'username', query: 'ива' },
 *     { type: 'date-range', field: 'created_at', from: '2025-01-01', to: '2025-12-31' },
 *   ]);
 */
export class FilterEngine {
    /**
     * Применяет цепочку фильтров к массиву.
     * @param {Array<Object>} items - Исходный массив объектов
     * @param {Array<Object>} filters - Описания фильтров
     * @returns {Array<Object>} Отфильтрованный массив
     */
    static apply(items, filters) {
        if (!Array.isArray(items)) return [];
        if (!Array.isArray(filters) || filters.length === 0) return items.slice();

        let result = items;

        for (const f of filters) {
            if (!f || !f.type) continue;

            if (f.type === 'set' && Array.isArray(f.values) && f.values.length > 0) {
                const set = new Set(f.values);
                result = result.filter(it => set.has(it?.[f.field]));
                continue;
            }

            if (f.type === 'text' && typeof f.query === 'string' && f.query.length > 0) {
                const q = f.query.toLowerCase();
                result = result.filter(it => {
                    const v = it?.[f.field];
                    return typeof v === 'string' && v.toLowerCase().includes(q);
                });
                continue;
            }

            if (f.type === 'date-range' && (f.from || f.to)) {
                const fromDate = f.from ? new Date(f.from) : null;
                // Для to-даты включаем весь день: '2025-12-31' → '...T23:59:59'.
                const toDate = f.to ? new Date(`${f.to}T23:59:59`) : null;
                result = result.filter(it => {
                    const raw = it?.[f.field];
                    if (!raw) return false;
                    const d = new Date(raw);
                    if (Number.isNaN(d.getTime())) return false;
                    if (fromDate && d < fromDate) return false;
                    if (toDate && d > toDate) return false;
                    return true;
                });
                continue;
            }
        }

        return result;
    }
}

window.FilterEngine = FilterEngine;
