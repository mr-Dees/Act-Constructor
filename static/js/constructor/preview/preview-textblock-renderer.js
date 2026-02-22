/**
 * Рендерер текстовых блоков для предпросмотра
 *
 * Создает HTML-представление текстовых блоков с сохранением
 * форматирования и стилей.
 */
class PreviewTextBlockRenderer {
    /**
     * Создает элемент текстового блока
     *
     * @param {Object} textBlock - Данные текстового блока
     * @returns {HTMLElement} Элемент текстового блока
     */
    static create(textBlock) {
        const container = this._createContainer();
        const content = this._createContent(textBlock);

        container.appendChild(content);
        return container;
    }

    /**
     * Создает контейнер текстового блока
     * @private
     */
    static _createContainer() {
        const container = document.createElement('div');
        container.className = 'preview-textblock';
        return container;
    }

    /**
     * Создает элемент содержимого с форматированием
     * @private
     */
    static _createContent(textBlock) {
        const content = document.createElement('div');
        content.className = 'preview-textblock-content';

        this._applyFormatting(content, textBlock.formatting);
        content.innerHTML = textBlock.content;

        return content;
    }

    /**
     * Применяет форматирование к элементу
     * @private
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
