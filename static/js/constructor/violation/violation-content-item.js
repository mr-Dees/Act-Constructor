/**
 * Типы и фабрика элементов дополнительного контента нарушения.
 *
 * Единственный источник строк-типов item.type на фронте. Значения
 * сериализуются в содержимое акта и зеркалят Literal["case", "image",
 * "freeText"] в ViolationContentItemSchema
 * (app/domains/acts/schemas/act_content.py) — менять только синхронно с бэком.
 *
 * Модуль без DOM и импортов приложения — тестируется под node:test.
 */

/** Кейс — текстовый блок с нумерацией «Кейс N». */
export const CONTENT_TYPE_CASE = 'case';

/** Картинка (inline data-URL) с подписью и шириной. */
export const CONTENT_TYPE_IMAGE = 'image';

/** Произвольный текст — блок «Текст N». */
export const CONTENT_TYPE_FREE_TEXT = 'freeText';

/**
 * Создаёт элемент дополнительного контента только с релевантными типу полями:
 * кейс/текст — content; картинка — url/caption/filename/width. Лишние поля
 * не присваиваются (бэк-схема дозаполняет дефолтами при валидации). Порядок
 * элемента задаётся позицией в массиве additionalContent.items — отдельного
 * поля order нет (#24, убрано как write-only дубль).
 *
 * @param {string} type - Тип элемента (CONTENT_TYPE_*)
 * @param {Object} [extraData] - Дополнительные данные элемента
 * @param {string} [extraData.content] - Текст (для case и freeText)
 * @param {string} [extraData.url] - data-URL картинки (для image)
 * @param {string} [extraData.filename] - Имя файла (для image)
 * @param {number} [extraData.width] - Ширина картинки, % полезной ширины листа
 *        (0 — авто, Б-1.4)
 * @returns {Object} Новый элемент контента
 */
export function createContentItem(type, extraData = {}) {
    const item = {
        id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type,
    };

    if (type === CONTENT_TYPE_IMAGE) {
        item.url = extraData.url || '';
        item.caption = '';
        item.filename = extraData.filename || '';
        item.width = extraData.width || 0;
    } else {
        item.content = extraData.content || '';
    }

    return item;
}
