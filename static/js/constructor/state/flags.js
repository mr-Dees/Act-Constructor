/**
 * Флаги подвидов таблиц — единый источник истины.
 *
 * Шесть булевых флагов классифицируют специальные таблицы (закрепление,
 * защита, каскад). Источник истины — узел дерева; флаги дублируются на
 * объект таблицы для совместимости со старыми актами.
 *
 * Модуль БЕЗ DOM-зависимостей: импортируется и из state-core.js (сериализация),
 * и из тестов напрямую.
 */

/** @type {readonly string[]} Имена 6 флагов подвидов таблиц. */
export const TABLE_FLAG_NAMES = Object.freeze([
    'isMetricsTable',
    'isMainMetricsTable',
    'isRegularRiskTable',
    'isOperationalRiskTable',
    'isTaxRiskTable',
    'isOtherRiskTable',
]);

/**
 * Собирает truthy-флаги подвидов таблицы из узла.
 *
 * @param {Object|null|undefined} node - Узел дерева (или объект таблицы).
 * @returns {Object<string, true>} Объект только из выставленных флагов.
 */
export function pickTableFlags(node) {
    const flags = {};
    if (!node) return flags;
    for (const name of TABLE_FLAG_NAMES) {
        if (node[name]) flags[name] = true;
    }
    return flags;
}

/**
 * Реконсайлер 6 флагов подвидов таблиц при загрузке акта.
 *
 * Синхронизирует флаги node↔table: узел — источник истины; если флаг есть
 * только на объекте таблицы (legacy-акты до миграции на node) — поднимает его
 * на узел; объект таблицы всегда приводится в соответствие с узлом. Рекурсивно
 * обходит детей. Идемпотентен.
 *
 * @param {Object|null|undefined} node - Узел дерева.
 * @param {Object<string, Object>} tables - Словарь таблиц AppState.tables.
 */
export function reconcileTableFlags(node, tables) {
    if (!node) return;
    if (node.type === 'table' && node.tableId) {
        const table = tables ? tables[node.tableId] : null;
        if (table) {
            // Узел — источник истины. Берём активный флаг узла; если на узле его нет, но
            // есть на таблице (legacy-акт) — поднимаем. Флаги ВЗАИМОИСКЛЮЧАЮЩИЕ: выставляем
            // ровно один (или ни одного), прочие гасим. Пишем ТОЛЬКО при реальном изменении —
            // иначе чистая загрузка пометит акт несохранённым (AppState — Proxy).
            const source =
                TABLE_FLAG_NAMES.find((n) => node[n]) ||
                TABLE_FLAG_NAMES.find((n) => table[n]) ||
                null;
            for (const name of TABLE_FLAG_NAMES) {
                const on = name === source;
                if (!!node[name] !== on) node[name] = on;
                if (!!table[name] !== on) table[name] = on;
            }
        }
    }
    if (node.children) {
        for (const child of node.children) {
            reconcileTableFlags(child, tables);
        }
    }
}
