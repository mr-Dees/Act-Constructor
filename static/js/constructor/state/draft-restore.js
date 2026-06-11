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
    // Без обеих меток сравнить «менялся ли акт» невозможно — консервативно
    // считаем снимок устаревшим.
    if (!snapshot.baseUpdatedAt || !serverUpdatedAt) {
        return 'discard';
    }
    return sameInstant(snapshot.baseUpdatedAt, serverUpdatedAt) ? 'restore' : 'discard';
}
