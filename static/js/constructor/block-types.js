/**
 * Реестр типов блоков конструктора (решение Б-2.6).
 *
 * Единый объект-описание типов узлов дерева акта: whitelist типов и
 * декларативные свойства каждого типа — поле-ссылка на запись словаря
 * (idProp), имя словаря AppState/ActDataSchema (dictName), метка по
 * умолчанию, лимит блоков на узел и префикс ключей _domIndex рендерера.
 *
 * Строковые значения типов — AppConfig.nodeTypes (реестр использует их
 * как ключи, отдельного дубля строк нет).
 *
 * ВАЖНО: набор типов синхронизируется ВРУЧНУЮ с бэкенд-реестром
 * app/domains/acts/block_types.py (как names.py ↔ chat-client-actions.js):
 * бэк не импортирует JS. Соответствие схемы и всех трёх форматтеров на
 * бэке закреплено тест-стражем tests/domains/acts/test_block_types_guard.py,
 * точные строки типов на фронте пинит tests/js/block-types.test.mjs.
 *
 * Как добавить новый тип блока — чек-лист в developer-guide §10.10.
 */
import { AppConfig } from '../shared/app-config.js';

const { ITEM, TABLE, TEXTBLOCK, VIOLATION } = AppConfig.nodeTypes;

/**
 * Реестр описаний типов узлов. Заморожен вместе с каждым описанием —
 * случайная мутация в рантайме бросит TypeError (strict mode ESM).
 *
 * Поля описания:
 * - type {string} — строковый тип узла (дублирует ключ для удобства);
 * - idProp {string|null} — поле узла со ссылкой на запись словаря
 *   (null для структурного item);
 * - dictName {string|null} — имя словаря AppState (tables/textBlocks/violations);
 * - defaultLabel {string} — метка узла по умолчанию;
 * - limitPerNode {number|null} — максимум блоков данного типа на узел;
 * - domIndexPrefix {string} — префикс ключей _domIndex в ItemsRenderer.
 */
export const BLOCK_TYPES = Object.freeze({
    [ITEM]: Object.freeze({
        type: ITEM,
        idProp: null,
        dictName: null,
        defaultLabel: AppConfig.tree.labels.newItem,
        limitPerNode: null,
        domIndexPrefix: 'item',
    }),
    [TABLE]: Object.freeze({
        type: TABLE,
        idProp: 'tableId',
        dictName: 'tables',
        defaultLabel: AppConfig.tree.labels.table,
        limitPerNode: AppConfig.content.limits.tablesPerNode,
        domIndexPrefix: 'table',
    }),
    [TEXTBLOCK]: Object.freeze({
        type: TEXTBLOCK,
        idProp: 'textBlockId',
        dictName: 'textBlocks',
        defaultLabel: AppConfig.tree.labels.textBlock,
        // B-13: фолбэк-дефолт; рантайм-источник — getStructureLimits().textBlocksPerNode
        // из /acts/limits (читается в validation-tree._validateContentLimits).
        limitPerNode: AppConfig.content.limits.textBlocksPerNode,
        domIndexPrefix: 'textblock',
    }),
    [VIOLATION]: Object.freeze({
        type: VIOLATION,
        idProp: 'violationId',
        dictName: 'violations',
        defaultLabel: AppConfig.tree.labels.violation,
        limitPerNode: AppConfig.content.limits.violationsPerNode,
        domIndexPrefix: 'violation',
    }),
});

/** Листовые типы-блоки контента (имеют словарь и поле-ссылку). */
export const LEAF_BLOCK_TYPES = Object.freeze(
    Object.values(BLOCK_TYPES)
        .filter(spec => spec.idProp !== null)
        .map(spec => spec.type)
);

/**
 * Возвращает описание типа из реестра.
 * @param {string} type - Строковый тип узла
 * @returns {Object|null} Описание типа или null для неизвестного типа
 */
export function getBlockType(type) {
    return Object.prototype.hasOwnProperty.call(BLOCK_TYPES, type)
        ? BLOCK_TYPES[type]
        : null;
}

/**
 * Проверяет, что тип присутствует в реестре.
 * @param {string} type - Строковый тип узла
 * @returns {boolean}
 */
export function isBlockType(type) {
    return getBlockType(type) !== null;
}

/**
 * Проверяет, что тип — листовой блок контента (table/textblock/violation).
 * @param {string} type - Строковый тип узла
 * @returns {boolean}
 */
export function isLeafBlockType(type) {
    const spec = getBlockType(type);
    return spec !== null && spec.idProp !== null;
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
if (typeof window !== 'undefined') {
    window.BLOCK_TYPES = BLOCK_TYPES;
    window.getBlockType = getBlockType;
    window.isBlockType = isBlockType;
    window.isLeafBlockType = isLeafBlockType;
}
