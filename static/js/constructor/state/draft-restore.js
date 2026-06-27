/**
 * Чистая логика решения о восстановлении черновика из localStorage (H3).
 *
 * Снимок-черновик хранится в localStorage под ключом с act_id (см.
 * StorageManager.saveState) и содержит метаданные (savedAt, baseUpdatedAt)
 * + данные AppState.exportData(). Восстановление предлагается ТОЛЬКО если
 * акт с момента снимка никто не менял: серверный updated_at равен
 * baseUpdatedAt снимка. Любое сохранение акта (содержимого или метаданных,
 * самим пользователем с другого места или кем-то ещё) бампит updated_at
 * на сервере и делает снимок устаревшим.
 */

/**
 * Сравнивает две временные метки на равенство момента времени.
 *
 * Сначала строгое строковое равенство (оба значения приходят из одного
 * pydantic-сериализатора и для одного момента совпадают посимвольно),
 * затем сравнение распарсенных эпох — на случай разной записи одного
 * и того же момента (например, с/без дробной части секунд).
 *
 * @param {string} a Первая метка (ISO-строка)
 * @param {string} b Вторая метка (ISO-строка)
 * @returns {boolean} true если метки указывают на один момент времени
 */
function sameInstant(a, b) {
    if (a === b) return true;
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

/**
 * B-12: семантическая целостность снимка — все записи словарей (tables/
 * textBlocks/violations) ссылаются на существующие узлы дерева, и наоборот
 * листовые узлы ссылаются на существующие записи. Зеркало sanitizeActContent,
 * но БЕЗ мутации — только вердикт «снимок согласован». Чистая функция.
 * @param {Object} data snapshot.data ({tree, tables, textBlocks, violations})
 * @returns {boolean} true если снимок согласован
 */
function isSnapshotConsistent(data) {
    const nodeIds = new Set();
    const refs = []; // листовые ссылки узлов: [{dict, ref}]
    const stack = [data.tree];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (node.id) nodeIds.add(node.id);
        for (const [dict, prop] of [['tables', 'tableId'], ['textBlocks', 'textBlockId'], ['violations', 'violationId']]) {
            if (node[prop]) refs.push({ dict, ref: node[prop] });
        }
        if (Array.isArray(node.children)) for (const c of node.children) stack.push(c);
    }
    // (а) сирота-запись словаря: nodeId не в дереве
    for (const dict of ['tables', 'textBlocks', 'violations']) {
        const d = data[dict];
        if (!d || typeof d !== 'object') continue;
        for (const entry of Object.values(d)) {
            if (!entry || !nodeIds.has(entry.nodeId)) return false;
        }
    }
    // (б) висячая ссылка узла: записи в словаре нет
    for (const { dict, ref } of refs) {
        if (!(data[dict] && data[dict][ref])) return false;
    }
    return true;
}

/**
 * Решает судьбу снимка-черновика при загрузке акта.
 *
 * @param {Object|null} snapshot Снимок из localStorage ({actId, savedAt,
 *   baseUpdatedAt, data}) или null, если снимка нет
 * @param {string|null} serverUpdatedAt Серверный updated_at акта из GET-контента
 * @returns {'restore'|'discard'|'none'}
 *   'restore' — предложить восстановление (акт не менялся с момента снимка);
 *   'discard' — молча удалить снимок (устарел или повреждён);
 *   'none'    — снимка нет, делать нечего.
 */
export function shouldOfferRestore(snapshot, serverUpdatedAt) {
    if (!snapshot) {
        return 'none';
    }
    // Повреждённый снимок (нет данных или дерева) восстановлению не подлежит.
    if (!snapshot.data || typeof snapshot.data !== 'object' || !snapshot.data.tree) {
        return 'discard';
    }
    // B-12: одного наличия дерева мало — снимок мог быть повреждён/правлен руками
    // и содержать висячие ссылки (сироты словарей / ссылки узлов в никуда).
    // Несогласованный снимок не предлагаем восстанавливать.
    if (!isSnapshotConsistent(snapshot.data)) {
        return 'discard';
    }
    // Без обеих меток сравнить «менялся ли акт» невозможно — консервативно
    // считаем снимок устаревшим.
    if (!snapshot.baseUpdatedAt || !serverUpdatedAt) {
        return 'discard';
    }
    return sameInstant(snapshot.baseUpdatedAt, serverUpdatedAt) ? 'restore' : 'discard';
}
