/**
 * Санитайзер несогласованных данных контента акта (M.13-фронт).
 *
 * Последний рубеж для уже испорченных данных в БД: бэкенд новые висячие
 * ссылки отбивает кросс-валидатором на PUT и фильтрует сирот при сохранении,
 * но записи, испорченные до появления этих гардов, могли остаться.
 *
 * Правила:
 *  (а) записи словарей tables/textBlocks/violations, чей nodeId не существует
 *      в дереве — отбрасываются;
 *  (б) ссылки узлов (tableId/textBlockId/violationId) без записи в словаре —
 *      обнуляются (узел остаётся в дереве, его контент-контейнер будет пустым).
 *
 * Применяется в loadActContent ПОСЛЕ получения контента (включая
 * восстановленный черновик) и ДО присвоения в AppState.
 */

/** Соответствие словарей контента полям-ссылкам на узлах дерева. */
const DICT_REFS = [
    ['tables', 'tableId'],
    ['textBlocks', 'textBlockId'],
    ['violations', 'violationId'],
];

/**
 * Чистит несогласованные данные контента акта на месте.
 *
 * @param {Object} content Контент акта ({tree, tables, textBlocks, violations, ...})
 * @returns {{changed: boolean, droppedEntries: Object<string, string[]>, clearedRefs: string[]}}
 *   Отчёт: changed — было ли что-то исправлено; droppedEntries — id отброшенных
 *   записей по словарям; clearedRefs — id узлов с обнулёнными ссылками.
 */
export function sanitizeActContent(content) {
    const report = {
        changed: false,
        droppedEntries: { tables: [], textBlocks: [], violations: [] },
        clearedRefs: [],
    };

    if (!content || !content.tree || typeof content.tree !== 'object') {
        return report;
    }

    // Один обход дерева: собираем множество id узлов и плоский список узлов.
    const nodeIds = new Set();
    const nodes = [];
    const stack = [content.tree];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        nodes.push(node);
        if (node.id) nodeIds.add(node.id);
        if (Array.isArray(node.children)) stack.push(...node.children);
    }

    // (а) сироты словарей: nodeId записи не существует в дереве.
    for (const [dictName] of DICT_REFS) {
        const dict = content[dictName];
        if (!dict || typeof dict !== 'object') continue;
        for (const [entryId, entry] of Object.entries(dict)) {
            if (!entry || !nodeIds.has(entry.nodeId)) {
                delete dict[entryId];
                report.droppedEntries[dictName].push(entryId);
                report.changed = true;
            }
        }
    }

    // (б) висячие ссылки узлов: запись словаря отсутствует (в т.ч. после (а)).
    for (const node of nodes) {
        for (const [dictName, refField] of DICT_REFS) {
            const ref = node[refField];
            if (ref && !(content[dictName] && content[dictName][ref])) {
                delete node[refField];
                report.clearedRefs.push(node.id || '(без id)');
                report.changed = true;
            }
        }
    }

    return report;
}
