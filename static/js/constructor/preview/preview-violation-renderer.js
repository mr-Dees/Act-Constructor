/**
 * Рендерер нарушений для предпросмотра
 *
 * Паритет ПОЛНОТЫ данных с DOCX (build_violation): полные тексты всех полей
 * без обрезки, полный список описаний (descriptionList), полные кейсы и
 * свободные тексты, реальные картинки с подписью (H4/M.3/M.5). Подписи-ярлыки
 * остаются превью-стилем (решение Д.3 — паритет данных, не букв подписей).
 */
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
 * Флаг `small` помечает поля, которые в Word рендерятся 9pt-курсивом
 * (Нарушено/Установлено/descriptionList/additionalContent — см. styles.Sizes.
 * violation_pt). Поля «Причины/Последствия/Ответственный/Рекомендации» — обычный
 * текст листа (12pt, без курсива), поэтому `small: false`.
 *
 * @param {Object} violation - Данные нарушения
 * @returns {Array<Object>} Строки: {type:'line', label, text, small} |
 *          {type:'list', label, items, small} | {type:'image', item}
 */
export function collectViolationLines(violation) {
    const lines = [];

    lines.push({ type: 'line', label: 'Нарушено', text: violation.violated || '—', small: true });
    lines.push({ type: 'line', label: 'Установлено', text: violation.established || '—', small: true });

    if (violation.descriptionList?.enabled) {
        const items = (violation.descriptionList.items || []).filter(item => item && item.trim());
        if (items.length > 0) {
            lines.push({ type: 'list', label: 'В том числе', items, small: true });
        }
    }

    if (violation.additionalContent?.enabled) {
        let caseNumber = 1;
        let textNumber = 1;
        for (const item of violation.additionalContent.items || []) {
            if (item.type === CONTENT_TYPE_CASE) {
                if (item.content?.trim()) {
                    lines.push({ type: 'line', label: `Кейс ${caseNumber}`, text: item.content, small: true });
                    caseNumber++;
                }
            } else if (item.type === CONTENT_TYPE_IMAGE) {
                lines.push({ type: 'image', item });
                caseNumber = 1;
            } else if (item.type === CONTENT_TYPE_FREE_TEXT) {
                if (item.content?.trim()) {
                    lines.push({ type: 'line', label: `Текст ${textNumber}`, text: item.content, small: true });
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
            lines.push({ type: 'line', label, text: field.content, small: false });
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
                this._addLine(container, line.label, line.text, line.small);
            } else if (line.type === 'list') {
                this._addList(container, line.label, line.items, line.small);
            } else if (line.type === 'image') {
                this._addImage(container, line.item);
            }
        }

        return container;
    }

    /**
     * Добавляет абзац «Метка_подчёркнута полный текст» (паритет с DOCX:
     * label-run подчёркнут, body-run обычный). `small` → 9pt-курсив-группа.
     * @private
     */
    static _addLine(container, label, text, small) {
        const line = document.createElement('div');
        line.className = small ? 'preview-violation-line preview-violation-line--small'
                               : 'preview-violation-line';
        if (label) {
            const labelEl = document.createElement('span');
            labelEl.className = 'preview-violation-label';
            labelEl.textContent = `${label}: `;
            line.appendChild(labelEl);
        }
        // text — пользовательское поле нарушения; вставляем как текст-ноду (без HTML).
        line.appendChild(document.createTextNode(text));
        container.appendChild(line);
    }

    /**
     * Добавляет полный список описаний (паритет с буллетами DOCX)
     * @private
     */
    static _addList(container, label, items, small) {
        const line = document.createElement('div');
        line.className = small ? 'preview-violation-line preview-violation-line--small'
                               : 'preview-violation-line';
        const labelEl = document.createElement('span');
        labelEl.className = 'preview-violation-label';
        labelEl.textContent = `${label}:`;
        line.appendChild(labelEl);
        container.appendChild(line);

        const list = document.createElement('ul');
        list.className = small ? 'preview-violation-desclist preview-violation-desclist--small'
                               : 'preview-violation-desclist';
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
            placeholder.className = 'preview-violation-line preview-violation-line--small';
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
        // Явная ширина — рендерим ровно как DOCX (_scale_picture задаёт только
        // ширину, без потолка высоты). Авторазмер (width=0) — ограничиваем
        // высоту долей листа, чтобы огромная картинка не разнесла скролл (Б-1.6).
        if (style.width) {
            img.style.width = style.width;
        } else {
            img.style.maxHeight = style.maxHeight;
        }
        img.onerror = () => {
            const placeholder = document.createElement('div');
            placeholder.className = 'preview-violation-line preview-violation-line--small';
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
