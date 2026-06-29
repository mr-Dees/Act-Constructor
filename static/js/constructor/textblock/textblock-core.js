/**
 * Менеджер для управления текстовыми блоками
 * Современный подход с поддержкой расширенного форматирования как в Word
 */
import { PreviewManager } from '../preview/preview.js';
import { AppState } from '../state/state-core.js';

export class TextBlockManager {
    constructor() {
        this.selectedTextBlock = null;
        this.globalToolbar = null;
        this.activeEditor = null;

        // Конфигурация доступных размеров шрифта
        this.fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
    }

    /**
     * Показывает панель инструментов
     */
    showToolbar() {
        if (this.globalToolbar) {
            this.globalToolbar.classList.remove('hidden');
        }
    }

    /**
     * Скрывает панель инструментов
     */
    hideToolbar() {
        if (this.globalToolbar) {
            this.globalToolbar.classList.add('hidden');
        }
    }

    /**
     * Устанавливает активный редактор
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
     */
    getTextBlock(textBlockId) {
        return AppState.textBlocks[textBlockId] || null;
    }

    /**
     * Принудительно коммитит pending-правку активного текстблок-редактора.
     *
     * Ввод в редактор сохраняется в state через debounce 500мс
     * (textblock-editor.js::handleEditorInput), поэтому таймерный автосейв /
     * экспорт / переключение акта могут прочитать exportData() без последних
     * символов, ещё висящих в debounce. Метод вызывается из persistence-воронок
     * (StorageManager._flushPendingEdits) ДО exportData(): если в фокусе
     * textblock-редактор с непогашенным saveTimeout — переносим его innerHTML
     * в state и снимаем таймер (он бы повторил ту же работу).
     *
     * @returns {boolean} true если был закоммичен pending-редактор
     */
    flushActiveEditor() {
        const editor = document.activeElement;
        if (!editor || !editor.classList || !editor.classList.contains('textblock-editor')) {
            return false;
        }
        if (!editor.saveTimeout) {
            return false;
        }
        clearTimeout(editor.saveTimeout);
        editor.saveTimeout = null;
        const textBlockId = editor.dataset.textBlockId;
        this.saveContent(textBlockId, editor.innerHTML);
        return true;
    }

    /**
     * Сохраняет контент текстового блока
     */
    saveContent(textBlockId, content) {
        const textBlock = this.getTextBlock(textBlockId);
        if (textBlock) {
            // Снимаем caret-guard'ы + чиним инварианты капсул (дубль-id,
            // расщеплённый клон, пустой data-*) ПЕРЕД записью в БД.
            const stripped = this._stripGuards ? this._stripGuards(content) : content;
            textBlock.content = this.validateAndRepairCapsules
                ? this.validateAndRepairCapsules(stripped) : stripped;
            // Контентная правка одного блока → точечный патч превью.
            PreviewManager.updateBlock('textblock', textBlockId);
        }
    }

    /**
     * Выполняет команду форматирования
     */
    execCommand(command, value = null) {
        if (!this.activeEditor) return false;

        this.activeEditor.focus();

        // Атомарность капсулы: inline-форматные команды по выделению, заходящему
        // ВНУТРЬ тела маркера, иначе клонируют его (дубль ссылки). Расширяем
        // выделение за целые капсулы (как уже делает applyFontSize). Блочные
        // (justify*) и insert* не трогаем.
        const FORMAT_CMDS = ['bold', 'italic', 'underline', 'strikeThrough'];
        if (FORMAT_CMDS.includes(command) && typeof this._expandRangeOutOfMarkers === 'function') {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
                const r = sel.getRangeAt(0);
                this._expandRangeOutOfMarkers(r);
                sel.removeAllRanges();
                sel.addRange(r);
            }
        }

        const result = document.execCommand(command, false, value);

        if (result) {
            const textBlockId = this.activeEditor.dataset.textBlockId;
            this.saveContent(textBlockId, this.activeEditor.innerHTML);
        }

        return result;
    }

    /**
     * Проверяет состояние команды форматирования
     */
    queryCommandState(command) {
        try {
            return document.queryCommandState(command);
        } catch (e) {
            return false;
        }
    }

    /**
     * Получает значение команды
     */
    queryCommandValue(command) {
        try {
            return document.queryCommandValue(command);
        } catch (e) {
            return '';
        }
    }
}

export const textBlockManager = new TextBlockManager();

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.TextBlockManager = TextBlockManager;
window.textBlockManager = textBlockManager;
