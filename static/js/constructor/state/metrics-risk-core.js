/**
 * Чистое ядро решений metrics ↔ risk — БЕЗ DOM, БЕЗ AppConfig, БЕЗ window.
 *
 * Здесь живут только канонические предикаты «нужна ли сводная таблица метрик» (D2):
 *  - shouldHaveMetricsTable — per-section сводная на 5.X;
 *  - shouldHaveMainMetrics — главная сводная §5.
 *
 * Предикаты — чистые функции над treeData: поиск риск-таблиц инъектируется
 * параметром findRiskTables. Это делает их тестируемыми в node:test
 * (см. tests/js/metrics-predicate.test.mjs). Сам каскад (создание/снятие сводных,
 * нумерация, побочные эффекты) живёт в AppState (state-content.js / state-tree.js)
 * и metrics-risk-coordinator.js, которые зовут эти предикаты напрямую.
 */

const TYPE_ITEM = 'item';

/** node — узел первого уровня под §5 (5.X). */
function is5xNode(node) {
    return !!node && /^5\.\d+$/.test(node.number || '');
}

/** Дочерний узел — item (item или без type). */
function isItem(node) {
    return !!node && (!node.type || node.type === TYPE_ITEM);
}

/**
 * Канонический предикат необходимости per-section сводной таблицы на 5.X.
 *
 * Сводная на 5.X нужна ⟺ в поддереве какого-либо item-ребёнка (т.е. на уровне
 * 5.X.Y и глубже) есть риск-таблица. Риск непосредственно на детях самого 5.X
 * сводную НЕ создаёт — таково историческое поведение всех call-site'ов.
 *
 * Чистая функция над treeData (риск-таблицы ищутся переданным findRiskTables).
 *
 * @param {Object|null} node5x - Узел 5.X.
 * @param {(node:Object)=>Array} findRiskTables - Поиск риск-таблиц в поддереве.
 * @returns {boolean}
 */
export function shouldHaveMetricsTable(node5x, findRiskTables) {
    if (!is5xNode(node5x)) return false;
    return (node5x.children || []).some(
        child => isItem(child) && findRiskTables(child).length > 0
    );
}

/**
 * Канонический предикат необходимости главной сводной таблицы §5.
 *
 * Главная сводная нужна ⟺ в §5 есть хотя бы одна риск-таблица (на любом уровне).
 *
 * @param {Object|null} section5 - Узел §5.
 * @param {(node:Object)=>Array} findRiskTables - Поиск риск-таблиц в поддереве.
 * @returns {boolean}
 */
export function shouldHaveMainMetrics(section5, findRiskTables) {
    if (!section5) return false;
    return findRiskTables(section5).length > 0;
}
