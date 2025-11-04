/**
 * Менеджер для управления текстовыми блоками
 * Отвечает за создание, редактирование и форматирование текстовых блоков в документе
 */
class TextBlockManager {
    /**
     * Создаёт экземпляр TextBlockManager
     */
    constructor() {
        this.selectedTextBlock = null;
        this.globalToolbar = null;
        this.activeEditor = null;
    }

    /**
     * Показывает панель инструментов форматирования
     */
    showToolbar() {
        if (this.globalToolbar) {
            this.globalToolbar.classList.remove('hidden');
        }
    }

    /**
     * Скрывает панель инструментов форматирования
     */
    hideToolbar() {
        if (this.globalToolbar) {
            this.globalToolbar.classList.add('hidden');
        }
    }

    /**
     * Устанавливает активный редактор
     * @param {HTMLElement} editor - Элемент редактора
     */
    setActiveEditor(editor) {
        this.activeEditor = editor;
    }

    /**
     * Очищает активный редактор
     */
    clearActiveEditor() {
        this.activeEditor = null;
    }

    /**
     * Получает текстовый блок по ID
     * @param {string} textBlockId - ID текстового блока
     * @returns {Object|null} Объект текстового блока или null
     */
    getTextBlock(textBlockId) {
        return AppState.textBlocks[textBlockId] || null;
    }

    /**
     * Сохраняет контент текстового блока
     * @param {string} textBlockId - ID текстового блока
     * @param {string} content - HTML-контент
     */
    saveContent(textBlockId, content) {
        const textBlock = this.getTextBlock(textBlockId);
        if (textBlock) {
            textBlock.content = content;
            PreviewManager.update();
        }
    }

    /**
     * Обновляет форматирование текстового блока
     * @param {string} textBlockId - ID текстового блока
     * @param {Object} formatting - Объект с настройками форматирования
     */
    updateFormatting(textBlockId, formatting) {
        const textBlock = this.getTextBlock(textBlockId);
        if (textBlock) {
            Object.assign(textBlock.formatting, formatting);
            PreviewManager.update();
        }
    }
}

const textBlockManager = new TextBlockManager();
