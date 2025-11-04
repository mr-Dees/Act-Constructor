/**
 * Расширение TextBlockManager для работы с форматированием
 */
Object.assign(TextBlockManager.prototype, {
    /**
     * Применяет сохранённое форматирование к элементу редактора
     * @param {HTMLElement} editor - DOM-элемент редактора
     * @param {Object} formatting - Объект с настройками форматирования
     */
    applyFormatting(editor, formatting) {
        if (formatting.fontSize) {
            editor.style.fontSize = `${formatting.fontSize}px`;
        }

        if (formatting.alignment) {
            editor.style.textAlign = formatting.alignment;
        }
    }
});
