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
            for (const name of TABLE_FLAG_NAMES) {
                // Любая сторона выставила флаг → обе стороны его получают.
                if (node[name] || table[name]) {
                    node[name] = true;
                    table[name] = true;
                }
            }
        }
    }
    if (node.children) {
        for (const child of node.children) {
            reconcileTableFlags(child, tables);
        }
    }
}
