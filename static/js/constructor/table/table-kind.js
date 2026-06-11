/**
 * Подвид таблицы (enum kind) — единый источник истины.
 *
 * Поле `kind` классифицирует специальные таблицы (метрики / риски):
 * 'regular' — обычная таблица (дефолт/отсутствие подвида). Значение живёт
 * на узле дерева (источник истины) и дублируется на объект таблицы.
 * СИНХРОНИЗИРУЕТСЯ ВРУЧНУЮ с бэкендом: TABLE_KINDS в
 * app/domains/acts/schemas/act_content.py и CHECK-констрейнт
 * check_table_kind_values в миграциях PG/GP.
 *
 * Здесь же — предикаты pinned/risk-таблиц (isPinnedTable / isRiskTable),
 * реконсайлер kind при загрузке (reconcileTableKind) и нормализация порядка
 * детей (normalizePinnedOrder).
 *
 * Модуль БЕЗ DOM- и БЕЗ AppConfig-зависимостей (импортируется и из тестов
 * напрямую). Тип узла-таблицы — литерал 'table' (== AppConfig.nodeTypes.TABLE);
 * совпадение зафиксировано регрессионно через call-site'ы.
 */

/** Значения подвида таблицы. */
export const KIND_REGULAR = 'regular';
export const KIND_METRICS = 'metrics';
export const KIND_MAIN_METRICS = 'mainMetrics';
export const KIND_REGULAR_RISK = 'regularRisk';
export const KIND_OPERATIONAL_RISK = 'operationalRisk';
export const KIND_TAX_RISK = 'taxRisk';
export const KIND_OTHER_RISK = 'otherRisk';

/** @type {readonly string[]} Все 7 значений подвида таблицы. */
export const TABLE_KINDS = Object.freeze([
    KIND_REGULAR,
    KIND_METRICS,
    KIND_MAIN_METRICS,
    KIND_REGULAR_RISK,
    KIND_OPERATIONAL_RISK,
    KIND_TAX_RISK,
    KIND_OTHER_RISK,
]);

/** 4 риск-подвида (подмножество TABLE_KINDS). */
const RISK_KINDS = Object.freeze(new Set([
    KIND_REGULAR_RISK,
    KIND_OPERATIONAL_RISK,
    KIND_TAX_RISK,
    KIND_OTHER_RISK,
]));

/** Тип узла-таблицы (зеркало AppConfig.nodeTypes.TABLE). */
const NODE_TYPE_TABLE = 'table';

/** Проверяет, что узел — таблица (по type). */
function isTableNode(node) {
    return !!node && node.type === NODE_TYPE_TABLE;
}

/**
 * Возвращает подвид таблицы узла или объекта таблицы.
 * Отсутствие поля kind = 'regular' (обычная таблица).
 *
 * @param {Object|null|undefined} obj - Узел дерева или объект таблицы.
 * @returns {string}
 */
export function getTableKind(obj) {
    return (obj && obj.kind) || KIND_REGULAR;
}

/**
 * Закреплённая таблица (метрики или риск) — любой подвид, кроме 'regular'.
 *
 * @param {Object|null|undefined} node - Узел дерева.
 * @returns {boolean}
 */
export function isPinnedTable(node) {
    return isTableNode(node) && getTableKind(node) !== KIND_REGULAR;
}

/**
 * Риск-таблица — один из 4 риск-подвидов (regular / operational / tax / other).
 *
 * @param {Object|null|undefined} node - Узел дерева.
 * @returns {boolean}
 */
export function isRiskTable(node) {
    return isTableNode(node) && RISK_KINDS.has(getTableKind(node));
}

/**
 * Реконсайлер подвида таблицы (kind) при загрузке акта.
 *
 * Синхронизирует kind node↔table: узел — источник истины; если подвид задан
 * только на объекте таблицы — поднимает его на узел; объект таблицы всегда
 * приводится в соответствие с узлом. Пишет ТОЛЬКО при реальном изменении —
 * иначе чистая загрузка пометит акт несохранённым (AppState — Proxy).
 * Рекурсивно обходит детей. Идемпотентен.
 *
 * @param {Object|null|undefined} node - Узел дерева.
 * @param {Object<string, Object>} tables - Словарь таблиц AppState.tables.
 */
export function reconcileTableKind(node, tables) {
    if (!node) return;
    if (node.type === NODE_TYPE_TABLE && node.tableId) {
        const table = tables ? tables[node.tableId] : null;
        if (table) {
            const nodeKind = getTableKind(node);
            // Узел побеждает; 'regular' на узле = «подвид не задан» — тогда
            // поднимаем значение с таблицы (если оно там есть).
            const resolved = nodeKind !== KIND_REGULAR ? nodeKind : getTableKind(table);
            if (nodeKind !== resolved) node.kind = resolved;
            if (getTableKind(table) !== resolved) table.kind = resolved;
        }
    }
    if (node.children) {
        for (const child of node.children) {
            reconcileTableKind(child, tables);
        }
    }
}

/**
 * Нормализует порядок детей: закреплённые таблицы (pinned) — в начало.
 *
 * Стабильная партиция: pinned-узлы становятся первыми с сохранением их
 * взаимного порядка, затем все остальные с сохранением их порядка. Среди
 * non-pinned ничего не переставляется. Консервативно: если порядок уже
 * корректен — массив children не пересоздаётся (защита от лишних markAsUnsaved
 * на Proxy-AppState). Рекурсивно обходит всё поддерево.
 *
 * Применяется при загрузке акта (api.js::loadActContent) для старых актов,
 * где pinned-таблица могла оказаться не первой среди children.
 *
 * @param {Object|null|undefined} parent - Узел дерева.
 */
export function normalizePinnedOrder(parent) {
    if (!parent || !Array.isArray(parent.children)) return;

    const children = parent.children;
    // Проверяем, есть ли non-pinned перед pinned (т.е. нужна ли перестановка).
    let seenNonPinned = false;
    let needsReorder = false;
    for (const child of children) {
        if (isPinnedTable(child)) {
            if (seenNonPinned) { needsReorder = true; break; }
        } else {
            seenNonPinned = true;
        }
    }

    if (needsReorder) {
        const pinnedItems = [];
        const rest = [];
        for (const child of children) {
            (isPinnedTable(child) ? pinnedItems : rest).push(child);
        }
        // Мутируем тот же массив (in-place), чтобы не плодить новый children.
        children.splice(0, children.length, ...pinnedItems, ...rest);
    }

    // Рекурсия по всем детям.
    for (const child of children) {
        normalizePinnedOrder(child);
    }
}

// Дублируем в window ради inline-скриптов в шаблонах (см. CLAUDE.md).
if (typeof window !== 'undefined') {
    window.isPinnedTable = isPinnedTable;
    window.isRiskTable = isRiskTable;
    window.normalizePinnedOrder = normalizePinnedOrder;
}
