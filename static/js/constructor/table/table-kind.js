/**
 * Единый дискриминатор подвида специальной таблицы.
 *
 * Один источник истины для классификации pinned-таблиц (метрики / риски).
 * Раньше та же логика дублировалась OR-списками флагов в tree-utils,
 * state-tree, state-content и context-menu — теперь все они делегируют сюда.
 *
 * Модуль БЕЗ DOM- и БЕЗ AppConfig-зависимостей (импортируется и из тестов
 * напрямую). Тип узла-таблицы — литерал 'table' (== AppConfig.nodeTypes.TABLE);
 * совпадение зафиксировано регрессионно через call-site'ы.
 */
import { TABLE_FLAG_NAMES } from '../state/flags.js';

/** Тип узла-таблицы (зеркало AppConfig.nodeTypes.TABLE). */
const NODE_TYPE_TABLE = 'table';

/** Имена 4 риск-флагов (подмножество TABLE_FLAG_NAMES). */
const RISK_FLAG_NAMES = Object.freeze([
    'isRegularRiskTable',
    'isOperationalRiskTable',
    'isTaxRiskTable',
    'isOtherRiskTable',
]);

/**
 * Соответствие имени флага → имени подвида (kind).
 * Порядок ключей повторяет TABLE_FLAG_NAMES и задаёт приоритет при
 * нескольких выставленных флагах (см. getTableKind).
 */
const FLAG_TO_KIND = Object.freeze({
    isMetricsTable: 'metrics',
    isMainMetricsTable: 'mainMetrics',
    isRegularRiskTable: 'regularRisk',
    isOperationalRiskTable: 'operationalRisk',
    isTaxRiskTable: 'taxRisk',
    isOtherRiskTable: 'otherRisk',
});

/** Проверяет, что узел — таблица (по type). */
function isTableNode(node) {
    return !!node && node.type === NODE_TYPE_TABLE;
}

/**
 * Определяет подвид таблицы по выставленным флагам.
 *
 * Возвращает 'generic' для не-таблицы, для null/undefined и для таблицы без
 * флагов. Если по какой-то причине выставлено несколько флагов, приоритет
 * детерминирован порядком TABLE_FLAG_NAMES:
 * metrics > mainMetrics > regularRisk > operationalRisk > taxRisk > otherRisk.
 *
 * @param {Object|null|undefined} node - Узел дерева (или объект таблицы).
 * @returns {('metrics'|'mainMetrics'|'regularRisk'|'operationalRisk'|'taxRisk'|'otherRisk'|'generic')}
 */
export function getTableKind(node) {
    if (!isTableNode(node)) return 'generic';
    for (const name of TABLE_FLAG_NAMES) {
        if (node[name]) return FLAG_TO_KIND[name];
    }
    return 'generic';
}

/**
 * Закреплённая таблица (метрики или риск) — любой из 6 флагов.
 * Семантика идентична прежней tree-utils.isPinnedTable.
 *
 * @param {Object|null|undefined} node - Узел дерева.
 * @returns {boolean}
 */
export function isPinnedTable(node) {
    if (!isTableNode(node)) return false;
    for (const name of TABLE_FLAG_NAMES) {
        if (node[name]) return true;
    }
    return false;
}

/**
 * Риск-таблица — любой из 4 риск-флагов (regular / operational / tax / other).
 * Семантика идентична прежней state-tree._isRiskTable.
 *
 * @param {Object|null|undefined} node - Узел дерева.
 * @returns {boolean}
 */
export function isRiskTable(node) {
    if (!isTableNode(node)) return false;
    for (const name of RISK_FLAG_NAMES) {
        if (node[name]) return true;
    }
    return false;
}

/**
 * Таблица-метрика (сводная): isMetricsTable || isMainMetricsTable.
 *
 * @param {Object|null|undefined} node - Узел дерева.
 * @returns {boolean}
 */
export function isMetricsKind(node) {
    if (!isTableNode(node)) return false;
    return !!(node.isMetricsTable || node.isMainMetricsTable);
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
    window.getTableKind = getTableKind;
    window.isPinnedTable = isPinnedTable;
    window.isRiskTable = isRiskTable;
    window.isMetricsKind = isMetricsKind;
    window.normalizePinnedOrder = normalizePinnedOrder;
}
