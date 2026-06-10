/**
 * Имена CSS-классов, связывающие рендер контент-панели с обработчиками.
 *
 * Единственный источник истины для классов, которые создаёт рендер
 * (TextBlockManager / ViolationManager) и по которым другие модули ищут
 * эти элементы (querySelector / classList.contains). Берите имена отсюда —
 * тогда рассинхрон «рендер пишет один класс, обработчик ищет другой»
 * невозможен (исторический пример: мёртвая синхронизация DOM→state искала
 * `.text-block-section` вместо реального `.textblock-section`).
 */
export const RENDER_CLASSES = {
    /** Секция текстового блока (создаёт TextBlockManager.createTextBlockElement). */
    TEXTBLOCK_SECTION: 'textblock-section',
    /** contenteditable-редактор текстового блока (создаёт TextBlockManager.createEditor). */
    TEXTBLOCK_EDITOR: 'textblock-editor',
    /** Секция нарушения (создаёт ViolationManager.createViolationElement). */
    VIOLATION_SECTION: 'violation-section',
    /** Многострочное поле нарушения — live-запись в state на input. */
    VIOLATION_TEXTAREA: 'violation-textarea',
    /** Поле пункта списка описаний нарушения — live-запись в state на input. */
    VIOLATION_LIST_INPUT: 'violation-list-input',
};
