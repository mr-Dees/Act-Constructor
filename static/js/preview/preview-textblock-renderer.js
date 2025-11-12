/**
 * Рендерер текстовых блоков для предпросмотра
 *
 * Создает отформатированные текстовые блоки
 * с сохранением HTML-разметки и стилей.
 */
class PreviewTextBlockRenderer {
    /**
     * Создает текстовый блок для предпросмотра
     *
     * @param {Object} textBlock - Данные текстового блока
     * @returns {HTMLElement}
     */
    static create(textBlock) {
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-textblock';

        const content = this._createContent(textBlock);
        wrapper.appendChild(content);

        return wrapper;
    }

    /**
     * Создает контент с форматированием
     * @private
     * @param {Object} textBlock - Данные блока
     * @returns {HTMLElement}
     */
    static _createContent(textBlock) {
        const content = document.createElement('div');
        content.className = 'preview-textblock-content';

        this._applyFormatting(content, textBlock.formatting);

        content.innerHTML = textBlock.content;

        return content;
    }

    /**
     * Применяет настройки форматирования
     * @private
     * @param {HTMLElement} element - Элемент контента
     * @param {Object} formatting - Настройки форматирования
     */
    static _applyFormatting(element, formatting) {
        if (!formatting) return;

        if (formatting.fontSize) {
            element.style.fontSize = `${formatting.fontSize}px`;
        }

        if (formatting.alignment) {
            element.style.textAlign = formatting.alignment;
        }
    }
}
