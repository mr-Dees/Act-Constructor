/**
 * Модуль обработки вставки из буфера обмена
 * Поддержка Ctrl+V для изображений и текста
 */

import { ViolationManager } from './violation-core.js';
import { Notifications } from '../../shared/notifications.js';
import { AppConfig } from '../../shared/app-config.js';
import {
    CONTENT_TYPE_CASE,
    CONTENT_TYPE_FREE_TEXT,
} from './violation-content-item.js';

/**
 * Строгий маркер кейса: «Кейс» + номер + разделитель в начале строки.
 * Флаг i ловит «кейс» в любом регистре; класс разделителей —
 * точка / двоеточие / скобка / дефис / en-dash / em-dash. Требует РОВНО
 * такой префикс: «Кейсы …», «Кейс 7 без разделителя» — уже не кейс.
 */
const CASE_PREFIX_RE = /^Кейс\s*\d+\s*[.:)\-–—]/i;

/**
 * Определяет тип вставляемого из буфера текста и очищает содержимое.
 * Кейс — только при строгом совпадении CASE_PREFIX_RE; тогда снимается
 * РОВНО совпавший префикс (не фиксированные 4 символа). Иначе — произвольный
 * текст без изменений.
 *
 * @param {string} textContent - Оригинальный текст буфера (ожидается .trim()'нутым)
 * @returns {{type: string, content: string}}
 */
export function parseClipboardText(textContent) {
    if (CASE_PREFIX_RE.test(textContent)) {
        return {
            type: CONTENT_TYPE_CASE,
            content: textContent.replace(CASE_PREFIX_RE, '').trim(),
        };
    }
    return { type: CONTENT_TYPE_FREE_TEXT, content: textContent };
}

/**
 * true, если стандартную вставку в этот target перехватывать НЕЛЬЗЯ:
 * поле ввода (textarea/input) или contenteditable-редактор (текстблок).
 * Иначе Ctrl+V в редакторе, когда мышь/фокус рядом с зоной нарушения,
 * ушёл бы в дополнительный контент (#19).
 *
 * @param {EventTarget} target - e.target события paste
 * @returns {boolean}
 */
export function pasteTargetIsEditable(target) {
    if (!target) return false;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return true;
    if (target.closest && target.closest('[contenteditable="true"]')) return true;
    return false;
}

// Расширение ViolationManager
Object.assign(ViolationManager.prototype, {
    /**
     * Настраивает глобальный обработчик вставки изображений и текста из буфера обмена
     */
    setupPasteHandler() {
        document.addEventListener('paste', async (e) => {
            // Режим просмотра: вставка в дополнительный контент запрещена (#1).
            // Глобальный слушатель живёт всегда — guard именно здесь обязателен.
            if (AppConfig.readOnlyMode?.isReadOnly) return;

            // Проверяем, есть ли текущий активный контейнер
            if (!this.currentActiveContainer) {
                return;
            }

            // Если вставка происходит в textarea или input внутри дополнительного контента —
            // не перехватываем, позволяем стандартное поведение браузера
            const target = e.target;
            if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
                return;
            }

            // Получаем данные из буфера обмена
            const items = e.clipboardData?.items;
            if (!items) {
                return;
            }

            const targetContainer = this.currentActiveContainer;
            const itemsContainer = targetContainer.querySelector('.additional-content-items');
            const violationId = itemsContainer?.dataset.violationId;

            if (!violationId) {
                return;
            }

            // Получаем violation из хранилища
            const violation = this.activeViolations.get(violationId);
            if (!violation) {
                console.error('Violation not found in storage:', violationId);
                return;
            }

            // Определяем позицию вставки на основе положения курсора
            const insertIndex = this.cursorInsertPosition !== null
                ? this.cursorInsertPosition
                : violation.additionalContent.items.length;

            // Собираем ВСЕ картинки буфера (не только последнюю, #28) и
            // отдельно наличие текста.
            const imageFiles = [];
            let textItem = null;

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                } else if (item.type === 'text/plain') {
                    textItem = item;
                }
            }

            // Картинки идут ТЕМ ЖЕ конвейером, что drop/upload (#28):
            // filterAcceptedImageFiles → диалог качества (Q3) → ресайз → bulk (#29).
            // Собственного FileReader и логики «только последняя картинка» больше нет.
            if (imageFiles.length > 0) {
                e.preventDefault();

                // Тип-валидация ДО чтения (H6/#26) — warning с причиной отказа.
                const accepted = this.filterAcceptedImageFiles(imageFiles, violation);
                if (accepted.length === 0) return;

                // insertIndex зафиксирован синхронно ДО async-чтения (приемлемо);
                // тост об успехе с верным числом покажет insertImageFilesInOrder.
                this.promptQualityThenInsertImages(violation, targetContainer, insertIndex, accepted);
            }
            // Текст обрабатываем только если картинок в буфере нет.
            else if (textItem) {
                const textContent = e.clipboardData.getData('text/plain').trim();

                if (textContent) {
                    e.preventDefault();

                    // Строгий маркер кейса (#5): «Кейс N<разделитель>» снимается
                    // ровно по совпадению, иначе — произвольный текст как есть.
                    const { type, content } = parseClipboardText(textContent);
                    const message = type === CONTENT_TYPE_CASE
                        ? 'Кейс добавлен из буфера обмена'
                        : 'Текст добавлен из буфера обмена';

                    // Единый гейт лимита (#4) уже мог отказать (Notifications.warning
                    // показан внутри) — тогда false, и success не зовём, чтобы не
                    // подтверждать вставку, которой не произошло. updateBlock делает
                    // сама addContentItemAtPosition — без двойного апдейта (#29).
                    const added = this.addContentItemAtPosition(violation, type, targetContainer, insertIndex, {
                        content: content
                    });
                    if (!added) return;

                    Notifications.success(message);
                }
            }
        });
    }
});
