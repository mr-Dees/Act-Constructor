/**
 * Рендерер текстовых блоков для предпросмотра
 *
 * Создает HTML-представление текстовых блоков с сохранением
 * форматирования и стилей.
 */
import { SafeHTML } from '../../shared/sanitize.js';

export class PreviewTextBlockRenderer {
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
        // textBlock.content — пользовательский HTML, см. C-XSS-1.
        // Профиль 'acts' — allowlist, синхронный с бэк-санитайзером (5.2.3).
        SafeHTML.set(content, textBlock.content, 'acts');

        return content;
    }

    /**
     * Применяет форматирование к элементу (M.6: и bold/italic/underline —
     * контейнером, паритет с DOCX-рендером заданного formatting)
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

        if (formatting.bold) {
            element.style.fontWeight = 'bold';
        }

        if (formatting.italic) {
            element.style.fontStyle = 'italic';
        }

        if (formatting.underline) {
            element.style.textDecoration = 'underline';
        }
    }
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.PreviewTextBlockRenderer = PreviewTextBlockRenderer;
