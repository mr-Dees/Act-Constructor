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
            // filterAcceptedImageFiles → insertImageFilesInOrder (bulk, #29).
            // Собственного FileReader и логики «только последняя картинка» больше нет.
            if (imageFiles.length > 0) {
                e.preventDefault();

                // Валидация ДО readAsDataURL (H6) — warning с причиной отказа.
                const accepted = this.filterAcceptedImageFiles(imageFiles, violation);
                if (accepted.length === 0) return;

                // insertIndex зафиксирован синхронно ДО async-чтения (приемлемо);
                // тост об успехе с верным числом покажет insertImageFilesInOrder.
                this.insertImageFilesInOrder(violation, targetContainer, insertIndex, accepted);
            }
            // Текст обрабатываем только если картинок в буфере нет.
            else if (textItem) {
                const textContent = e.clipboardData.getData('text/plain').trim();

                if (textContent) {
                    e.preventDefault();

                    // Определяем тип: кейс или текст
                    const normalizedText = textContent.toLowerCase();
                    const startsWithCase = normalizedText.startsWith('кейс');

                    let type, content, message;

                    if (startsWithCase) {
                        type = CONTENT_TYPE_CASE;
                        // Убираем "кейс" (4 символа) и затем номер с разделителем
                        content = textContent
                            .substring(4)
                            .replace(/^\s*\d+\s*[.:\-–—]?\s*/, '')
                            .trim();
                        message = 'Кейс добавлен из буфера обмена';
                    } else {
                        type = CONTENT_TYPE_FREE_TEXT;
                        content = textContent;
                        message = 'Текст добавлен из буфера обмена';
                    }

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
