/**
 * Персист свёрнутых узлов дерева (перф-волна, M.24).
 *
 * Чистые функции над Storage-подобным объектом — без DOM и без AppState
 * (тестируются в node:test напрямую). Ключ — per-act, по образцу ключей
 * черновика: `audit_workstation_collapsed:{actId}`.
 *
 * Набор хранится как JSON-массив id узлов; пустой набор удаляет ключ.
 */

const KEY_PREFIX = 'audit_workstation_collapsed:';

/**
 * Ключ localStorage для набора свёрнутых узлов акта.
 * @param {number|string} actId - ID акта
 * @returns {string}
 */
export function collapsedStorageKey(actId) {
    return `${KEY_PREFIX}${actId}`;
}

/**
 * Загружает набор свёрнутых узлов. Битый JSON / не-массив / отсутствие
 * actId — пустой набор (молча, поведение best-effort UI-настройки).
 * @param {Storage} storage - localStorage-совместимое хранилище
 * @param {number|string|null|undefined} actId - ID акта
 * @returns {Set<string>}
 */
export function loadCollapsedSet(storage, actId) {
    if (actId === null || actId === undefined || !storage) return new Set();
    try {
        const raw = storage.getItem(collapsedStorageKey(actId));
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter(id => typeof id === 'string'));
    } catch {
        return new Set();
    }
}

/**
 * Сохраняет набор свёрнутых узлов. Пустой набор удаляет ключ,
 * отсутствие actId — no-op.
 * @param {Storage} storage - localStorage-совместимое хранилище
 * @param {number|string|null|undefined} actId - ID акта
 * @param {Set<string>} set - Набор id свёрнутых узлов
 */
export function saveCollapsedSet(storage, actId, set) {
    if (actId === null || actId === undefined || !storage) return;
    try {
        const key = collapsedStorageKey(actId);
        if (!set || set.size === 0) {
            storage.removeItem(key);
        } else {
            storage.setItem(key, JSON.stringify([...set]));
        }
    } catch {
        // Квота/приватный режим — настройка сворачивания не критична.
    }
}

/**
 * Чистит набор от id, которых больше нет в дереве (удалённые узлы).
 * Мутирует набор; возвращает true, если что-то удалено.
 * @param {Set<string>} set - Набор id свёрнутых узлов
 * @param {(id: string) => boolean} hasNode - Предикат «узел существует»
 * @returns {boolean} true если набор изменился
 */
export function pruneCollapsedSet(set, hasNode) {
    let changed = false;
    for (const id of [...set]) {
        if (!hasNode(id)) {
            set.delete(id);
            changed = true;
        }
    }
    return changed;
}
