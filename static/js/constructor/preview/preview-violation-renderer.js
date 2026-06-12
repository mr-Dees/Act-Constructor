/**
 * Рендерер нарушений для предпросмотра
 *
 * Паритет ПОЛНОТЫ данных с DOCX (build_violation): полные тексты всех полей
 * без обрезки, полный список описаний (descriptionList), полные кейсы и
 * свободные тексты, реальные картинки с подписью (H4/M.3/M.5). Подписи-ярлыки
 * остаются превью-стилем (решение Д.3 — паритет данных, не букв подписей).
 */
import { SafeHTML } from '../../shared/sanitize.js';
import { getImageLimits } from '../violation/violation-image-validator.js';
import {
    CONTENT_TYPE_CASE,
    CONTENT_TYPE_FREE_TEXT,
    CONTENT_TYPE_IMAGE,
} from '../violation/violation-content-item.js';

/** Высота листа A4 в мм — база для ограничения высоты картинок (Б-1.6). */
const SHEET_HEIGHT_MM = 297;

/**
 * Чистая модель строк нарушения — полные тексты, как в DOCX.
 * Семантика нумерации кейсов и сброса счётчиков — как в
 * docx/builders/violation.py и MD/TXT-форматтерах.
 *
 * @param {Object} violation - Данные нарушения
 * @returns {Array<Object>} Строки: {type:'line', label, text} |
 *          {type:'list', label, items} | {type:'image', item}
 */
export function collectViolationLines(violation) {
    const lines = [];

    lines.push({ type: 'line', label: 'Нарушено', text: violation.violated || '—' });
    lines.push({ type: 'line', label: 'Установлено', text: violation.established || '—' });

    if (violation.descriptionList?.enabled) {
        const items = (violation.descriptionList.items || []).filter(item => item && item.trim());
        if (items.length > 0) {
            lines.push({ type: 'list', label: 'В том числе', items });
        }
    }

    if (violation.additionalContent?.enabled) {
        let caseNumber = 1;
        let textNumber = 1;
        for (const item of violation.additionalContent.items || []) {
            if (item.type === CONTENT_TYPE_CASE) {
                if (item.content?.trim()) {
                    lines.push({ type: 'line', label: `Кейс ${caseNumber}`, text: item.content });
                    caseNumber++;
                }
            } else if (item.type === CONTENT_TYPE_IMAGE) {
                lines.push({ type: 'image', item });
                caseNumber = 1;
            } else if (item.type === CONTENT_TYPE_FREE_TEXT) {
                if (item.content?.trim()) {
                    lines.push({ type: 'line', label: `Текст ${textNumber}`, text: item.content });
                    textNumber++;
                }
                caseNumber = 1;
            }
        }
    }

    const optionalFields = [
        ['reasons', 'Причины'],
        ['consequences', 'Последствия'],
        ['responsible', 'Ответственный за решение проблем'],
        ['recommendations', 'Рекомендации'],
    ];
    for (const [key, label] of optionalFields) {
        const field = violation[key];
        if (field?.enabled && field?.content) {
            lines.push({ type: 'line', label, text: field.content });
        }
    }

    return lines;
}

/**
 * Чистый маппинг item.width / лимита высоты → inline-стиль картинки превью.
 *
 * @param {Object} item - Элемент типа image (поле width: 0 — авто)
 * @param {number} previewMaxHeightPercent - Лимит высоты, % высоты листа
 * @returns {{width: string, maxHeight: string}} Значения CSS-свойств
 */
export function imagePresentationStyle(item, previewMaxHeightPercent) {
    const width = item && item.width > 0 ? `${item.width}%` : '';
    const heightMm = SHEET_HEIGHT_MM * (previewMaxHeightPercent || 40) / 100;
    // Округление до 0.1 мм, без хвоста «.0».
    const maxHeight = `${parseFloat(heightMm.toFixed(1))}mm`;
    return { width, maxHeight };
}

export class PreviewViolationRenderer {
    /**
     * Создает элемент нарушения (полные данные, без обрезки)
     *
     * @param {Object} violation - Данные нарушения
     * @returns {HTMLElement} Элемент нарушения
     */
    static create(violation) {
        const container = document.createElement('div');
        container.className = 'preview-violation';

        for (const line of collectViolationLines(violation)) {
            if (line.type === 'line') {
                this._addLine(container, line.label, line.text);
            } else if (line.type === 'list') {
                this._addList(container, line.label, line.items);
            } else if (line.type === 'image') {
                this._addImage(container, line.item);
            }
        }

        return container;
    }

    /**
     * Добавляет строку «Метка: полный текст»
     * @private
     */
    static _addLine(container, label, text) {
        const line = document.createElement('div');
        line.className = 'preview-violation-line';
        // label статичен; text — пользовательское поле нарушения, escape перед склейкой.
        line.innerHTML = `${label}: ${SafeHTML.escapeHtml(text)}`;
        container.appendChild(line);
    }

    /**
     * Добавляет полный список описаний (паритет с буллетами DOCX)
     * @private
     */
    static _addList(container, label, items) {
        const line = document.createElement('div');
        line.className = 'preview-violation-line';
        line.textContent = `${label}:`;
        container.appendChild(line);

        const list = document.createElement('ul');
        list.className = 'preview-violation-desclist';
        for (const item of items) {
            const li = document.createElement('li');
            li.textContent = item;
            list.appendChild(li);
        }
        container.appendChild(list);
    }

    /**
     * Добавляет картинку: по центру, подпись курсивом снизу (как DOCX, Б-1.5).
     * Сломанная картинка (onerror) заменяется текстовым плейсхолдером.
     * @private
     */
    static _addImage(container, item) {
        const wrap = document.createElement('div');
        wrap.className = 'preview-violation-image-wrap';

        if (!item.url) {
            // Пустой url (черновик) → плейсхолдер, как в DOCX/MD/TXT.
            const placeholder = document.createElement('div');
            placeholder.className = 'preview-violation-line';
            placeholder.textContent = `Изображение: ${item.filename || ''}`;
            wrap.appendChild(placeholder);
            container.appendChild(wrap);
            this._appendCaption(container, item);
            return;
        }

        const img = document.createElement('img');
        img.className = 'preview-violation-image';
        img.alt = item.caption || item.filename || '';
        const style = imagePresentationStyle(item, getImageLimits().previewMaxHeightPercent);
        if (style.width) img.style.width = style.width;
        img.style.maxHeight = style.maxHeight;
        img.onerror = () => {
            const placeholder = document.createElement('div');
            placeholder.className = 'preview-violation-line';
            placeholder.textContent = `Изображение: ${item.filename || ''}`;
            wrap.replaceChildren(placeholder);
        };
        img.src = item.url;
        wrap.appendChild(img);
        container.appendChild(wrap);
        this._appendCaption(container, item);
    }

    /**
     * Подпись картинки курсивом по центру (если задана)
     * @private
     */
    static _appendCaption(container, item) {
        if (!item.caption) return;
        const caption = document.createElement('div');
        caption.className = 'preview-violation-caption';
        caption.textContent = item.caption;
        container.appendChild(caption);
    }
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.PreviewViolationRenderer = PreviewViolationRenderer;
