/**
 * Чистое ядро каскада metrics ↔ risk — БЕЗ DOM, БЕЗ AppConfig, БЕЗ window.
 *
 * Здесь живёт только логика ПРИНЯТИЯ РЕШЕНИЙ о наличии сводных таблиц метрик:
 *  - единый предикат «нужна ли сводная таблица» (D2);
 *  - три reconcile-перехода (added / removed / moved) над структурой
 *    {treeData, tables};
 *  - удаление риск-узла под единым snapshot'ом (D1).
 *
 * Построение самих объектов таблиц (сетка, id, label, нумерация) и побочные
 * эффекты (changelog, render, Notifications) ОСТАЮТСЯ в AppState и передаются
 * сюда инъекцией через объект `ops`. Это делает ядро тестируемым в node:test
 * (см. tests/js/cascade.test.mjs) и сохраняет поведение существующего кода:
 * AppState-методы — тонкие делегаты поверх этих функций.
 *
 * Контракт `ops` (все обязательны):
 *   findNodeById(id)               -> node|null   (поиск по treeData)
 *   findParentNode(id)             -> node|null
 *   findRiskTables(node)           -> Array<node> (риск-таблицы в поддереве)
 *   createMetricsTable(node5x)     -> void        (создаёт per-section сводную)
 *   createMainMetricsTable()       -> void        (создаёт главную сводную §5)
 *   removeMetricsTable(parent, tableNode) -> void (снимает сводную + её table)
 *   updateMetricsTableLabel(node5xId)     -> void  (опц.: обновить подпись)
 *   snapshot()                     -> {rollback()} (snapshot §5 + tables)
 *   deleteNode()                   -> void        (фактическое удаление узла)
 */

const TYPE_TABLE = 'table';
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

/** Per-section сводная-узел среди детей 5.X (isMetricsTable). */
function findMetricsTableNode(node5x) {
    return (node5x?.children || []).find(
        c => c.type === TYPE_TABLE && c.isMetricsTable === true
    ) || null;
}

/** Главная сводная-узел среди детей §5 (isMainMetricsTable). */
function findMainMetricsTableNode(section5) {
    return (section5?.children || []).find(
        c => c.type === TYPE_TABLE && c.isMainMetricsTable === true
    ) || null;
}

/**
 * Хук «риск-таблица добавлена»: создаёт per-section сводную на 5.X-предке
 * (если риск на глубоком уровне) и главную сводную §5.
 *
 * @param {string} nodeId - ID узла, в который добавлена риск-таблица.
 * @param {Object} ops - Инъекция операций (см. контракт в шапке модуля).
 */
export function reconcileAfterRiskAdded(nodeId, ops) {
    const node = ops.findNodeById(nodeId);
    if (!node) return;

    // Поднимаемся до узла первого уровня под §5.
    let ancestor = node;
    let parent = ops.findParentNode(ancestor.id);
    while (parent && parent.id !== '5') {
        ancestor = parent;
        parent = ops.findParentNode(ancestor.id);
    }

    // Per-section сводная — только если риск на уровне 5.X.Y+ (не на самом 5.X).
    if (parent?.id === '5' && is5xNode(ancestor) && nodeId !== ancestor.id) {
        if (shouldHaveMetricsTable(ancestor, ops.findRiskTables) && !findMetricsTableNode(ancestor)) {
            ops.createMetricsTable(ancestor);
        }
    }

    // Главная сводная §5.
    ops.createMainMetricsTable();
}

/**
 * Хук «риск-таблица удалена»: реконсилит сводные во всём §5 — снимает per-section
 * сводные у 5.X без глубоких рисков и главную сводную, если рисков в §5 не осталось.
 *
 * @param {Object} ops - Инъекция операций.
 */
export function reconcileAfterRiskRemoved(ops) {
    const node5 = ops.findNodeById('5');
    if (!node5?.children) return;

    const firstLevel = node5.children.filter(c => isItem(c) && is5xNode(c));
    for (const node5x of firstLevel) {
        if (!shouldHaveMetricsTable(node5x, ops.findRiskTables)) {
            const metricsNode = findMetricsTableNode(node5x);
            if (metricsNode) ops.removeMetricsTable(node5x, metricsNode);
        }
    }

    if (!shouldHaveMainMetrics(node5, ops.findRiskTables)) {
        const mainNode = findMainMetricsTableNode(node5);
        if (mainNode) ops.removeMetricsTable(node5, mainNode);
    }
}

/**
 * Хук «поддерево перемещено внутри §5»: пересчитывает сводные для старого и
 * нового 5.X-предка перемещённого поддерева.
 *
 * @param {Object} draggedNode - Перемещённый узел.
 * @param {Object|null} oldAncestor5x - 5.X-предок до перемещения.
 * @param {Object} ops - Инъекция операций.
 */
export function reconcileAfterMove(draggedNode, oldAncestor5x, ops) {
    if (ops.findRiskTables(draggedNode).length === 0) return;

    const newAncestor5x = findFirstLevelAncestorUnder5(draggedNode.id, ops);

    // Предок 5.X не изменился — пересчитывать нечего.
    if (oldAncestor5x && newAncestor5x && oldAncestor5x.id === newAncestor5x.id) return;

    // Снимаем сводные у 5.X, где глубоких рисков больше нет.
    reconcileAfterRiskRemoved(ops);

    // Создаём сводную для нового 5.X-предка (если глубокие риски есть).
    if (newAncestor5x && shouldHaveMetricsTable(newAncestor5x, ops.findRiskTables)) {
        if (!findMetricsTableNode(newAncestor5x)) {
            ops.createMetricsTable(newAncestor5x);
        } else if (ops.updateMetricsTableLabel) {
            ops.updateMetricsTableLabel(newAncestor5x.id);
        }
    }

    // Главная сводная §5.
    const node5 = ops.findNodeById('5');
    if (node5 && shouldHaveMainMetrics(node5, ops.findRiskTables)) {
        if (!findMainMetricsTableNode(node5)) ops.createMainMetricsTable();
    }
}

/**
 * Находит узел 5.X (первого уровня под §5), являющийся предком данного узла.
 *
 * @param {string} nodeId - ID узла.
 * @param {Object} ops - Инъекция операций (findNodeById/findParentNode).
 * @returns {Object|null}
 */
export function findFirstLevelAncestorUnder5(nodeId, ops) {
    let node = ops.findNodeById(nodeId);
    if (!node) return null;

    let parent = ops.findParentNode(nodeId);
    while (parent && parent.id !== '5') {
        node = parent;
        parent = ops.findParentNode(node.id);
    }

    if (parent?.id === '5' && is5xNode(node)) return node;
    return null;
}

/**
 * D1: удаление риск-узла под ЕДИНЫМ snapshot'ом.
 *
 * Snapshot снимается ДО удаления узла, поэтому при исключении в reconcile
 * откат восстанавливает ПОЛНОЕ состояние §5, включая удалённый риск-узел —
 * частичное состояние (сводная без своего риска) невозможно.
 *
 * @param {Object} ops - Инъекция операций (включая snapshot() и deleteNode()).
 * @returns {boolean} true при успехе, false если был откат.
 */
export function removeRiskTableNode(ops) {
    const snap = ops.snapshot();
    try {
        ops.deleteNode();
        reconcileAfterRiskRemoved(ops);
        return true;
    } catch (err) {
        snap.rollback();
        if (ops.onError) ops.onError(err);
        return false;
    }
}
