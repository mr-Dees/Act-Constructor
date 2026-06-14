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
 *  (б) листовой узел (tableId/textBlockId/violationId) без записи в словаре —
 *      удаляется ЦЕЛИКОМ из дерева (зеркало бэкового _strip_dangling_refs):
 *      снять только ссылку мало — пустой узел-зомби всё равно отрисуется в
 *      экспорте («Таблица N» без данных) и не вычистится пересохранением.
 *
 * Применяется в loadActContent ПОСЛЕ получения контента (включая
 * восстановленный черновик) и ДО присвоения в AppState.
 */

import { BLOCK_TYPES, LEAF_BLOCK_TYPES } from '../block-types.js';

// [dictName, refField] для каждого листового типа — из реестра block-types.js
// (не хардкод): добавление типа-блока не требует правки этого санитайзера.
const DICT_REFS = LEAF_BLOCK_TYPES.map((t) => [BLOCK_TYPES[t].dictName, BLOCK_TYPES[t].idProp]);

/**
 * Чистит несогласованные данные контента акта на месте.
 *
 * @param {Object} content Контент акта ({tree, tables, textBlocks, violations, ...})
 * @returns {{changed: boolean, droppedEntries: Object<string, string[]>, removedNodes: string[]}}
 *   Отчёт: changed — было ли что-то исправлено; droppedEntries — id отброшенных
 *   записей по словарям; removedNodes — id удалённых узлов-зомби.
 */
export function sanitizeActContent(content) {
    const report = {
        changed: false,
        droppedEntries: { tables: [], textBlocks: [], violations: [] },
        removedNodes: [],
    };

    if (!content || !content.tree || typeof content.tree !== 'object') {
        return report;
    }

    // Один обход дерева: множество id узлов + список {node, parent} (для
    // вырезания зомби; корень несёт parent=null и под удаление не попадает).
    const nodeIds = new Set();
    const linked = [];
    const stack = [{ node: content.tree, parent: null }];
    while (stack.length) {
        const { node, parent } = stack.pop();
        if (!node || typeof node !== 'object') continue;
        linked.push({ node, parent });
        if (node.id) nodeIds.add(node.id);
        if (Array.isArray(node.children)) {
            for (const child of node.children) stack.push({ node: child, parent: node });
        }
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

    // (б) узлы-зомби: листовая ссылка указывает на отсутствующую запись
    //     словаря (в т.ч. после (а)) → удаляем узел целиком из родителя.
    for (const { node, parent } of linked) {
        if (!parent || !Array.isArray(parent.children)) continue;
        const dangling = DICT_REFS.some(([dictName, refField]) => {
            const ref = node[refField];
            return ref && !(content[dictName] && content[dictName][ref]);
        });
        if (dangling) {
            const idx = parent.children.indexOf(node);
            if (idx !== -1) {
                parent.children.splice(idx, 1);
                report.removedNodes.push(node.id || '(без id)');
                report.changed = true;
            }
        }
    }

    return report;
}
