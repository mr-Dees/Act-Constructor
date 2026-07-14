/**
 * Общий рендер картинки нарушения с fallback на текстовый плейсхолдер (#27).
 *
 * Ядро «img + onerror → плейсхолдер» переиспользуется редактором
 * (violation-rendering.js, createImageElement) и превью
 * (preview-violation-renderer.js, _addImage). Модуль нейтральный: оба
 * потребителя зависят от него, а не друг от друга (превью и раньше зависело
 * от соседних модулей в violation/ — validator/fields/numbering, направление
 * не меняется).
 */

/**
 * Создаёт текстовый плейсхолдер битой/отсутствующей картинки.
 *
 * @param {string} text - Текст плейсхолдера (обычно «Изображение: {filename}»)
 * @param {string} className - CSS-класс плейсхолдера (свой у редактора и превью)
 * @returns {HTMLElement} div с текстом плейсхолдера
 */
export function buildImagePlaceholder(text, className) {
    const placeholder = document.createElement('div');
    placeholder.className = className;
    placeholder.textContent = text;
    return placeholder;
}

/**
 * Рендерит <img> в container с graceful fallback на текстовый плейсхолдер
 * при ошибке загрузки. onerror навешивается ДО src — иначе на закэшированной
 * ошибке событие может выстрелить раньше, чем обработчик будет установлен.
 *
 * @param {HTMLElement} container - Куда добавить <img> (и чем заменить его при ошибке)
 * @param {Object} options
 * @param {string} options.src - URL/data-URL картинки
 * @param {string} [options.alt] - alt-текст
 * @param {string} [options.imgClassName] - CSS-класс <img>
 * @param {string} options.placeholderText - Текст плейсхолдера при ошибке
 * @param {string} options.placeholderClassName - CSS-класс плейсхолдера
 * @param {function(HTMLImageElement): void} [options.configureImg] - доп.
 *        настройка img (стили/атрибуты), вызывается до выставления src
 * @returns {HTMLImageElement} Созданный <img>
 */
export function renderImageWithFallback(container, {
    src,
    alt = '',
    imgClassName = '',
    placeholderText,
    placeholderClassName,
    configureImg = null,
} = {}) {
    const img = document.createElement('img');
    img.className = imgClassName;
    img.alt = alt;
    if (configureImg) configureImg(img);
    img.onerror = () => {
        container.replaceChildren(buildImagePlaceholder(placeholderText, placeholderClassName));
    };
    img.src = src;
    container.appendChild(img);
    return img;
}
