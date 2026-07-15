/**
 * Санитайзер несогласованных данных контента акта (M.13-фронт).
 *
 * Последний рубеж для уже испорченных данных в БД: бэкенд новые висячие
 * ссылки отбивает кросс-валидатором на PUT и фильтрует сирот при сохранении,
 * но записи, испорченные до появления этих гардов, могли остаться.
 *
 * Правила:
 *  (а) записи словарей tables/textBlocks/violations отбрасываются, если
 *      nodeId не существует в дереве, ИЛИ ни один узел дерева реально не
 *      ссылается на эту запись через своё поле-ссылку (обратная сверка,
 *      находка #21: раньше проверялось только существование узла с таким
 *      id — фантомная запись, чей "хозяин" на деле ссылается на другую
 *      запись словаря, могла уцелеть);
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
 * @returns {{changed: boolean, droppedEntries: Object<string, string[]>, removedNodes: Array<{id:string,type:string}>}}
 *   Отчёт: changed — было ли что-то исправлено; droppedEntries — id отброшенных
 *   записей по словарям; removedNodes — {id,type} удалённых узлов-зомби (B-38:
 *   структурно, т.к. отчёт уходит в серверный лог).
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

    // (а) и (б) взаимозависимы: вырезание зомби-узла уносит и его поддерево,
    // осиротив записи словарей у потомков; отброшенная запись делает ссылку
    // другого узла висячей. Поэтому повторяем оба правила до стабилизации —
    // множество живых id и список {node, parent} строятся заново по ТЕКУЩЕМУ
    // (уже обрезанному) дереву. Каждый результативный проход строго что-то
    // удаляет (id-узлов/записей конечно) → цикл завершается.
    for (;;) {
        const nodeIds = new Set();
        const linked = [];
        // Обратный индекс (находка #21, Вариант Б): для каждого словаря —
        // множество id, на которые РЕАЛЬНО ссылается хотя бы один узел через
        // своё поле-ссылку (node[refField]). Перестраивается каждый проход
        // по ТЕКУЩЕМУ дереву — как и nodeIds.
        const referenced = Object.fromEntries(DICT_REFS.map(([dictName]) => [dictName, new Set()]));
        const stack = [{ node: content.tree, parent: null }];
        while (stack.length) {
            const { node, parent } = stack.pop();
            if (!node || typeof node !== 'object') continue;
            linked.push({ node, parent });
            if (node.id) nodeIds.add(node.id);
            for (const [dictName, refField] of DICT_REFS) {
                const ref = node[refField];
                if (ref) referenced[dictName].add(ref);
            }
            if (Array.isArray(node.children)) {
                for (const child of node.children) stack.push({ node: child, parent: node });
            }
        }

        let changedThisPass = false;

        // (а) сироты словарей: nodeId записи не существует в (текущем) дереве
        //     (в т.ч. потомки удалённых на прошлом проходе зомби-узлов), ИЛИ
        //     ни один узел реально не ссылается на entryId (находка #21).
        for (const [dictName] of DICT_REFS) {
            const dict = content[dictName];
            if (!dict || typeof dict !== 'object') continue;
            for (const [entryId, entry] of Object.entries(dict)) {
                // B-38: явная проверка отсутствия nodeId (раньше срабатывала
                // косвенно через nodeIds.has(undefined)===false — неочевидно).
                const noOwnerNode = !entry || !entry.nodeId || !nodeIds.has(entry.nodeId);
                const notReferencedBack = !referenced[dictName].has(entryId);
                if (noOwnerNode || notReferencedBack) {
                    delete dict[entryId];
                    report.droppedEntries[dictName].push(entryId);
                    report.changed = true;
                    changedThisPass = true;
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
                    // B-38: {id,type} — тип узла помогает диагностике в логе.
                    report.removedNodes.push({
                        id: node.id || '(без id)',
                        type: node.type || '(без типа)',
                    });
                    report.changed = true;
                    changedThisPass = true;
                }
            }
        }

        if (!changedThisPass) break;
    }

    return report;
}
