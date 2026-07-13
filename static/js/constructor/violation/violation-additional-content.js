/**
 * Модуль управления дополнительным контентом
 * Кейсы, изображения, произвольный текст
 */

import { ContextMenuManager } from '../context-menu/context-menu-core.js';
import { PreviewManager } from '../preview/preview.js';
import { ViolationManager } from './violation-core.js';
import { ValidationCore } from '../validation/validation-core.js';
import { Notifications } from '../../shared/notifications.js';
import { AppState } from '../state/state-core.js';
import {
    estimateActImageBytes,
    getImageLimits,
    loadImageLimits,
    validateImageFile,
} from './violation-image-validator.js';
import { CONTENT_TYPE_IMAGE, createContentItem } from './violation-content-item.js';
import { readFilesInOrder } from './violation-file-reading.js';

// Расширение ViolationManager
Object.assign(ViolationManager.prototype, {
    /**
     * Создает расширяемую секцию дополнительного контента
     * @param {Object} violation - Объект нарушения
     * @returns {HTMLElement} Контейнер с подсущностями
     */
    createAdditionalContentField(violation, isReadOnly = false) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'violation-optional-field violation-additional-content';

        // Регистрируем violation в хранилище для быстрого доступа
        this.activeViolations.set(violation.id, violation);

        // Лимиты картинок подтягиваются один раз заранее (fire-and-forget):
        // к моменту приёма первого файла валидатор уже знает серверные значения.
        loadImageLimits();

        // Чекбокс для включения секции
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'violation-field-toggle';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `${violation.id}-additionalContent`;
        checkbox.checked = violation.additionalContent.enabled;
        checkbox.disabled = isReadOnly;

        // В режиме просмотра чекбокс заблокирован, мутирующий слушатель не вешаем.
        if (!isReadOnly) {
            checkbox.addEventListener('change', () => {
                this.setViolationField(violation, 'additionalContent.enabled', checkbox.checked);
                contentContainer.style.display = checkbox.checked ? 'block' : 'none';

                // Если выключаем - сбрасываем активный контейнер
                if (!checkbox.checked && this.currentActiveContainer === contentContainer) {
                    this._resetActiveZone();
                }
            });
        }

        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = checkbox.id;
        checkboxLabel.textContent = 'Дополнительный контент';
        checkboxLabel.className = 'violation-field-label';

        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(checkboxLabel);
        fieldContainer.appendChild(checkboxContainer);

        // Контейнер содержимого
        const contentContainer = document.createElement('div');
        contentContainer.className = 'violation-field-content additional-content-wrapper';
        contentContainer.style.display = violation.additionalContent.enabled ? 'block' : 'none';

        // Делаем контейнер focusable для перехвата Ctrl+V
        contentContainer.setAttribute('tabindex', '0');

        // Контейнер для элементов
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'additional-content-items';
        itemsContainer.dataset.violationId = violation.id;

        // Отслеживаем вход мыши в contentContainer.
        // Активация зоны регистрирует сброс по ESC в EscapeStack (violation-5).
        contentContainer.addEventListener('mouseenter', () => {
            if (violation.additionalContent.enabled) {
                this._setActiveZone(contentContainer);
            }
        });

        // Отслеживаем выход мыши из contentContainer
        contentContainer.addEventListener('mouseleave', () => {
            if (this.currentActiveContainer === contentContainer) {
                this._resetActiveZone();
                // Удаляем индикатор при выходе мыши
                this.removeInsertIndicators(itemsContainer);
            }
        });

        // Отслеживаем движение мыши для определения позиции курсора
        contentContainer.addEventListener('mousemove', (e) => {
            if (violation.additionalContent.enabled && this.currentActiveContainer === contentContainer) {
                // Вычисляем позицию курсора относительно элементов
                const position = this.calculateCursorPosition(e, itemsContainer);
                this.cursorInsertPosition = position;

                // Визуализируем позицию вставки. В пустом контейнере при
                // простом наведении индикатор не показываем (не прячем
                // подсказку «ПКМ...»); при файловом drag его рисует dragover
                // в violation-file-upload.js — mousemove во время drag не приходит.
                if (itemsContainer.querySelector('.content-item-wrapper')) {
                    this.updateInsertIndicator(itemsContainer, position);
                }
            }
        });

        // В режиме просмотра — только чтение: без приёма файлов и без меню
        // добавления/удаления элементов.
        if (!isReadOnly) {
            // Настраиваем Drag and Drop для файлов
            this.setupFileDragAndDrop(itemsContainer, violation, contentContainer);

            // Обработчик контекстного меню - используем новый ContextMenuManager
            itemsContainer.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Вычисляем позицию для вставки на основе клика
                const insertPosition = this.calculateCursorPosition(e, itemsContainer);

                // Проверяем, клик по элементу или по пустой области
                const clickedWrapper = e.target.closest('.content-item-wrapper');

                const options = {
                    violation,
                    contentContainer,
                    itemId: clickedWrapper ? clickedWrapper.dataset.itemId : null,
                    insertPosition
                };

                // Используем новый единый ContextMenuManager
                ContextMenuManager.show(e.clientX, e.clientY, null, 'violation', options);
            });
        }

        contentContainer.appendChild(itemsContainer);

        // Рендерим существующие элементы
        this.renderContentItems(violation, itemsContainer, isReadOnly);

        fieldContainer.appendChild(contentContainer);
        return fieldContainer;
    },

    /**
     * Вычисляет позицию курсора для вставки элементов
     * @param {Event} event - Событие мыши
     * @param {HTMLElement} container - Контейнер с элементами
     * @returns {number} Индекс позиции для вставки
     */
    calculateCursorPosition(event, container) {
        const wrappers = Array.from(container.querySelectorAll('.content-item-wrapper'));

        if (wrappers.length === 0) {
            return 0;
        }

        const clickY = event.clientY;

        for (let i = 0; i < wrappers.length; i++) {
            const wrapperRect = wrappers[i].getBoundingClientRect();
            const wrapperTop = wrapperRect.top;
            const wrapperBottom = wrapperRect.bottom;
            const wrapperHeight = wrapperRect.height;

            // Делим элемент на три зоны: верхняя треть, средняя треть, нижняя треть
            const topThird = wrapperTop + wrapperHeight / 3;
            const bottomThird = wrapperTop + (wrapperHeight * 2) / 3;

            if (clickY < topThird) {
                // Курсор в верхней трети элемента - вставляем перед ним
                return i;
            } else if (clickY >= topThird && clickY < bottomThird) {
                // Курсор в средней трети - вставляем перед элементом
                return i;
            } else if (clickY >= bottomThird && clickY <= wrapperBottom) {
                // Курсор в нижней трети - вставляем после элемента
                return i + 1;
            }
        }

        // Если курсор ниже всех элементов - вставляем в конец
        return wrappers.length;
    },

    /**
     * Визуализирует индикатор места вставки
     * @param {HTMLElement} container - Контейнер с элементами
     * @param {number} position - Позиция для вставки
     */
    updateInsertIndicator(container, position) {
        // Удаляем предыдущие индикаторы
        this.removeInsertIndicators(container);

        const wrappers = Array.from(container.querySelectorAll('.content-item-wrapper'));

        // Создаем индикатор
        const indicator = document.createElement('div');
        indicator.className = 'insert-indicator';

        if (wrappers.length === 0 || position >= wrappers.length) {
            // Пустой контейнер или вставка в конец
            container.appendChild(indicator);
        } else {
            // Вставка в начало или между элементами
            container.insertBefore(indicator, wrappers[position]);
        }
    },

    /**
     * Удаляет все индикаторы позиции вставки из контейнера
     * @param {HTMLElement} container - Контейнер с элементами
     */
    removeInsertIndicators(container) {
        const indicators = container.querySelectorAll('.insert-indicator');
        indicators.forEach(ind => ind.remove());
    },

    /**
     * Добавляет элемент контента в указанную позицию
     * @param {Object} violation - Объект нарушения
     * @param {string} type - Тип элемента ('case', 'image', 'freeText')
     * @param {HTMLElement} container - Контейнер содержимого
     * @param {number} insertIndex - Позиция для вставки
     * @param {Object} extraData - Дополнительные данные элемента
     * @returns {boolean} true при успешной вставке, false при отказе
     *          (режим просмотра или достигнут лимит элементов, #4)
     */
    addContentItemAtPosition(violation, type, container, insertIndex, extraData = {}) {
        // Единая точка вставки (контекстное меню / paste / DnD). Guard закрывает
        // и программные пути добавления в режиме просмотра (#1).
        const guard = ValidationCore.requireWrite('cannotAddContent');
        if (guard) return false;

        // Единый гейт лимита числа элементов для ЛЮБОГО типа контента (#4):
        // раньше лимит проверялся только для картинок, кейсы/текст добавлялись
        // без счёта, и бэкенд резал >50 элементов сразу на весь акт (422).
        const maxItems = getImageLimits().maxItemsPerViolation;
        if (violation.additionalContent.items.length >= maxItems) {
            Notifications.warning(
                `Достигнут лимит элементов дополнительного контента на нарушение (${maxItems}).`,
            );
            return false;
        }

        // Фабрика создаёт только релевантные типу поля (violation-3):
        // кейс/текст — content; картинка — url/caption/filename/width.
        const newItem = createContentItem(type, insertIndex, extraData);

        // Вставляем элемент в нужную позицию
        violation.additionalContent.items.splice(insertIndex, 0, newItem);

        // Обновляем порядок всех элементов
        violation.additionalContent.items.forEach((item, idx) => {
            item.order = idx;
        });

        const itemsContainer = container.querySelector('.additional-content-items');

        // Сохраняем текущее состояние активности
        const wasActive = this.currentActiveContainer === container;

        this.renderContentItems(violation, itemsContainer);

        // Восстанавливаем активность после перерисовки
        if (wasActive) {
            this.currentActiveContainer = container;
        }

        PreviewManager.updateBlock('violation', violation.id);
        return true;
    },

    /**
     * Валидирует пачку файлов картинок ДО чтения в base64 (H6).
     *
     * Общая точка для всех трёх способов приёма (выбор файлов, drag&drop,
     * Ctrl+V). Лимиты (MIME/размер/суммарный по акту/число элементов) —
     * с GET /acts/limits, см. violation-image-validator.js. Отказ каждого
     * файла сопровождается Notifications.warning с причиной.
     *
     * @param {File[]} files - Файлы-кандидаты
     * @param {Object} violation - Нарушение, в которое добавляются картинки
     * @returns {File[]} Прошедшие валидацию файлы
     */
    filterAcceptedImageFiles(files, violation) {
        let runningBytes = estimateActImageBytes(AppState.violations);
        let runningCount = (violation.additionalContent?.items || []).length;
        const accepted = [];

        for (const file of files) {
            const result = validateImageFile(file, {
                existingTotalBytes: runningBytes,
                itemsCount: runningCount,
            });
            if (!result.ok) {
                Notifications.warning(result.reason);
                continue;
            }
            accepted.push(file);
            runningBytes += file.size;
            runningCount += 1;
        }

        return accepted;
    },

    /**
     * Вставляет пачку картинок в детерминированном порядке выбора файлов
     * (violation-4): файлы читаются параллельно, но вставка идёт строго
     * по порядку списка после завершения всех чтений. Нечитаемые файлы
     * пропускаются с Notifications.error, порядок остальных сохраняется.
     *
     * @param {Object} violation - Объект нарушения
     * @param {HTMLElement} container - Контейнер содержимого
     * @param {number} insertIndex - Позиция для вставки первой картинки
     * @param {File[]} files - Прошедшие валидацию файлы в порядке выбора
     */
    async insertImageFilesInOrder(violation, container, insertIndex, files) {
        const results = await readFilesInOrder(files);

        let addedCount = 0;
        for (const result of results) {
            if (!result.ok) {
                console.error('Ошибка при чтении файла:', result.file.name, result.error);
                Notifications.error(`Ошибка при чтении ${result.file.name}`);
                continue;
            }

            const added = this.addContentItemAtPosition(
                violation,
                CONTENT_TYPE_IMAGE,
                container,
                insertIndex + addedCount,
                {
                    url: result.url,
                    filename: result.file.name,
                },
            );
            // Гейт лимита (#4) отказал — причина не исчезнет для оставшихся
            // файлов пачки, дальше вставлять некуда: останавливаем цикл, не
            // завышая addedCount (иначе success-тост соврёт про число вставленных).
            if (!added) break;
            addedCount++;
        }

        if (addedCount > 0) {
            const message = addedCount === 1
                ? 'Изображение добавлено'
                : `Добавлено изображений: ${addedCount}`;
            Notifications.success(message);
        }
    },

    /**
     * Инициирует выбор файлов изображений с указанием позиции
     * @param {Object} violation - Объект нарушения
     * @param {HTMLElement} container - Контейнер содержимого
     * @param {number} insertIndex - Позиция для вставки
     */
    triggerImageUploadAtPosition(violation, container, insertIndex) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.multiple = true;
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', (e) => {
            if (!e.target.files || e.target.files.length === 0) return;

            // Валидация ДО readAsDataURL (H6) — отказники отсеяны с warning'ом.
            const files = this.filterAcceptedImageFiles(Array.from(e.target.files), violation);
            if (files.length === 0) return;

            // Вставка в порядке выбора файлов (violation-4).
            this.insertImageFilesInOrder(violation, container, insertIndex, files);
        });

        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
    }
});
