/**
 * Управление нарушениями в документе
 * Создает и обрабатывает интерактивные формы для ввода нарушений
 */
import { PreviewManager } from '../preview/preview.js';
import { RENDER_CLASSES } from '../render-classes.js';
import { AppConfig } from '../../shared/app-config.js';
import { EscapeStack } from '../../shared/escape-stack.js';
import { Notifications } from '../../shared/notifications.js';

export class ViolationManager {
    constructor() {
        this.selectedViolation = null;
        // Переменная для отслеживания последней позиции при drag
        this.lastDragOverIndex = null;
        // Хранилище активных violation для быстрого доступа.
        // Запись добавляется в createAdditionalContentField (violation-additional-content.js);
        // удаляется через removeViolation при разрушении узла дерева — без этого Map
        // рос бесконтрольно при switch'е между актами / удалении нарушений.
        this.activeViolations = new Map();
        // AbortController'ы document-слушателей drop по violation.id
        // (см. setupFileDragAndDrop): abort при повторной установке поля,
        // удалении нарушения и destroy() — иначе слушатели копились
        // на каждый ре-рендер поля дополнительных материалов.
        this._fileDropControllers = new Map();
        // Текущий активный контейнер для paste (только когда мышь внутри)
        this.currentActiveContainer = null;
        // Позиция курсора для вставки (null означает конец списка)
        this.cursorInsertPosition = null;
        // Unsubscribe ESC-хэндлера активной зоны в EscapeStack
        // (push в _setActiveZone, снятие в _resetActiveZone/destroy).
        this._escapeZoneUnsub = null;
    }

    /**
     * Инициализирует обработчики после загрузки всех модулей
     * Вызывается после подключения всех расширений
     */
    initialize() {
        // Настраиваем глобальный обработчик вставки
        this.setupPasteHandler();
    }

    /**
     * Активирует зону вставки (мышь внутри контейнера дополнительного
     * контента) и регистрирует сброс зоны по ESC через EscapeStack —
     * вместо прежнего собственного document-listener'а в обход стека.
     * Идемпотентен: повторная активация не плодит хэндлеры.
     * @param {HTMLElement} container - Контейнер дополнительного контента
     */
    _setActiveZone(container) {
        this.currentActiveContainer = container;
        if (!this._escapeZoneUnsub) {
            this._escapeZoneUnsub = EscapeStack.push(() => {
                this._resetActiveZone();
                Notifications.info('Активная зона сброшена');
            });
        }
    }

    /**
     * Сбрасывает активную зону вставки и снимает ESC-хэндлер со стека.
     * Идемпотентен.
     */
    _resetActiveZone() {
        this.currentActiveContainer = null;
        this.cursorInsertPosition = null;
        if (this._escapeZoneUnsub) {
            const unsub = this._escapeZoneUnsub;
            this._escapeZoneUnsub = null;
            unsub();
        }
    }

    /**
     * Удаляет нарушение из реестра активных. Идемпотентен.
     * Вызывать при разрушении DOM-секции нарушения / удалении узла дерева.
     * @param {string} violationId
     */
    removeViolation(violationId) {
        if (!violationId) return;
        this.activeViolations.delete(violationId);
        const controller = this._fileDropControllers.get(violationId);
        if (controller) {
            controller.abort();
            this._fileDropControllers.delete(violationId);
        }

        // #23: активная зона вставки принадлежала удаляемому нарушению — сбрасываем
        // её (иначе paste/ESC работали бы с зоной уже несуществующего нарушения).
        const owner = this.currentActiveContainer?.querySelector?.('.additional-content-items')
            ?.dataset?.violationId;
        if (owner === violationId) {
            this._resetActiveZone();
        }
    }

    /**
     * Полный сброс реестра активных нарушений.
     * Безопасно вызывать при switch'е акта или teardown.
     */
    destroy() {
        this.activeViolations.clear();
        this._fileDropControllers.forEach(controller => controller.abort());
        this._fileDropControllers.clear();
        this._resetActiveZone();
        this.selectedViolation = null;
        this.lastDragOverIndex = null;
    }

    /**
     * Создает элемент нарушения для отображения в интерфейсе
     * @param {Object} violation - Объект нарушения с полями (violated, established, и т.д.)
     * @param {Object} node - Узел дерева, к которому привязано нарушение
     * @returns {HTMLElement} Контейнер с формой нарушения
     */
    createViolationElement(violation, node) {
        const section = document.createElement('div');
        section.className = RENDER_CLASSES.VIOLATION_SECTION;
        section.dataset.violationId = violation.id;

        const columnsContainer = document.createElement('div');
        columnsContainer.className = 'violation-columns';

        // Колонка "Нарушено"
        const violatedColumn = document.createElement('div');
        violatedColumn.className = 'violation-column';

        const violatedLabel = document.createElement('div');
        violatedLabel.className = 'violation-label';
        violatedLabel.textContent = 'Нарушено:';
        violatedColumn.appendChild(violatedLabel);

        const violatedTextarea = document.createElement('textarea');
        violatedTextarea.className = RENDER_CLASSES.VIOLATION_TEXTAREA;
        violatedTextarea.placeholder = 'Опишите нарушение...';
        violatedTextarea.value = violation.violated || '';
        violatedTextarea.rows = 4;

        // Проверяем режим только чтения
        const isReadOnly = AppConfig.readOnlyMode?.isReadOnly;
        if (isReadOnly) {
            violatedTextarea.readOnly = true;
            violatedTextarea.classList.add('read-only');
        } else {
            // Настраиваем обработку клавиш для сохранения изменений.
            // Аудит правки фиксируется diff-ом при сохранении (violation-audit.js),
            // а не per-keystroke — отдельная запись в журнал здесь не нужна.
            this.setupTextareaHandlers(violatedTextarea, (value) => {
                this.setViolationField(violation, 'violated', value);
            });
        }

        violatedColumn.appendChild(violatedTextarea);

        // Колонка "Установлено"
        const establishedColumn = document.createElement('div');
        establishedColumn.className = 'violation-column';

        const establishedLabel = document.createElement('div');
        establishedLabel.className = 'violation-label';
        establishedLabel.textContent = 'Установлено:';
        establishedColumn.appendChild(establishedLabel);

        const establishedTextarea = document.createElement('textarea');
        establishedTextarea.className = RENDER_CLASSES.VIOLATION_TEXTAREA;
        establishedTextarea.placeholder = 'Опишите установленное...';
        establishedTextarea.value = violation.established || '';
        establishedTextarea.rows = 4;

        // Проверяем режим только чтения
        if (isReadOnly) {
            establishedTextarea.readOnly = true;
            establishedTextarea.classList.add('read-only');
        } else {
            // Настраиваем обработку клавиш для сохранения изменений.
            // Аудит правки — diff при сохранении (violation-audit.js), не per-keystroke.
            this.setupTextareaHandlers(establishedTextarea, (value) => {
                this.setViolationField(violation, 'established', value);
            });
        }

        establishedColumn.appendChild(establishedTextarea);

        columnsContainer.appendChild(violatedColumn);
        columnsContainer.appendChild(establishedColumn);
        section.appendChild(columnsContainer);

        // Контейнер для дополнительных опциональных полей
        const optionalFieldsContainer = document.createElement('div');
        optionalFieldsContainer.className = 'violation-optional-fields';

        optionalFieldsContainer.appendChild(
            this.createOptionalField(violation, 'descriptionList', 'Описание причин', 'list', isReadOnly)
        );

        optionalFieldsContainer.appendChild(
            this.createAdditionalContentField(violation, isReadOnly)
        );

        optionalFieldsContainer.appendChild(
            this.createOptionalField(violation, 'reasons', 'Причины', 'text', isReadOnly)
        );

        optionalFieldsContainer.appendChild(
            this.createOptionalField(violation, 'consequences', 'Последствия', 'text', isReadOnly)
        );

        optionalFieldsContainer.appendChild(
            this.createOptionalField(violation, 'responsible', 'Ответственные', 'text', isReadOnly)
        );

        optionalFieldsContainer.appendChild(
            this.createOptionalField(violation, 'recommendations', 'Рекомендации', 'text', isReadOnly)
        );

        section.appendChild(optionalFieldsContainer);

        return section;
    }

    /**
     * Настраивает обработчики событий для textarea с поддержкой отмены
     * @param {HTMLTextAreaElement} textarea - Элемент textarea
     * @param {Function} onUpdate - Callback для обновления данных
     */
    setupTextareaHandlers(textarea, onUpdate) {
        let originalValue = textarea.value;

        // Обновляем данные при каждом изменении
        const handleInput = () => {
            onUpdate(textarea.value);
        };

        // Обработка горячих клавиш
        const handleKeyDown = (e) => {
            if (e.key === 'Enter' && e.shiftKey) {
                // Shift+Enter — добавить новую строку (стандартное поведение)
                e.stopPropagation();
            } else if (e.key === 'Enter' && !e.shiftKey) {
                // Enter — сохранить изменения и снять фокус
                e.preventDefault();
                textarea.blur();
            } else if (e.key === 'Escape') {
                // Escape — отменить изменения и восстановить исходное значение
                e.preventDefault();
                e.stopPropagation();
                textarea.value = originalValue;
                onUpdate(originalValue);
                textarea.blur();
            }
        };

        // Запоминаем исходное значение при получении фокуса
        const handleFocus = () => {
            originalValue = textarea.value;
        };

        textarea.addEventListener('input', handleInput);
        textarea.addEventListener('keydown', handleKeyDown);
        textarea.addEventListener('focus', handleFocus);
    }

    /**
     * Создает опциональное поле с чекбоксом для включения/выключения
     * @param {Object} violation - Объект нарушения
     * @param {string} fieldName - Имя поля в объекте violation
     * @param {string} label - Текст метки поля
     * @param {string} type - Тип поля ('list' или 'text')
     * @returns {HTMLElement} Контейнер с опциональным полем
     */
    createOptionalField(violation, fieldName, label, type, isReadOnly = false) {
        // #20 страховка А: дешёвая защита от отсутствующего под-объекта поля
        // (старые/повреждённые данные до normalizeViolations на загрузке).
        // Не перезатирает валидные данные — подставляет дефолт только при
        // полном отсутствии поля; последующие чтения (в т.ч. renderList) безопасны.
        if (!violation[fieldName] || typeof violation[fieldName] !== 'object') {
            violation[fieldName] = { enabled: false, items: [], content: '' };
        }

        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'violation-optional-field';

        // Чекбокс для включения/выключения поля
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'violation-field-toggle';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `${violation.id}-${fieldName}`;
        checkbox.checked = violation[fieldName].enabled;
        checkbox.disabled = isReadOnly;

        // В режиме просмотра чекбокс заблокирован, мутирующий слушатель не вешаем.
        // Уже включённые секции остаются раскрытыми (display ниже) для чтения.
        if (!isReadOnly) {
            checkbox.addEventListener('change', () => {
                this.setViolationField(violation, `${fieldName}.enabled`, checkbox.checked);
                contentContainer.style.display = checkbox.checked ? 'block' : 'none';
            });
        }

        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = checkbox.id;
        checkboxLabel.textContent = label;
        checkboxLabel.className = 'violation-field-label';

        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(checkboxLabel);
        fieldContainer.appendChild(checkboxContainer);

        // Контейнер для содержимого поля
        const contentContainer = document.createElement('div');
        contentContainer.className = 'violation-field-content';
        contentContainer.style.display = violation[fieldName].enabled ? 'block' : 'none';

        // Создаем либо список, либо текстовое поле
        if (type === 'list') {
            const listContainer = document.createElement('div');
            listContainer.className = 'violation-list-container';

            const addButton = document.createElement('button');
            addButton.className = 'violation-list-add-btn';
            addButton.textContent = '+ Добавить пункт';
            addButton.disabled = isReadOnly;

            if (!isReadOnly) {
                addButton.addEventListener('click', () => {
                    if (this.addViolationListItem(violation)) {
                        this.renderList(listContainer, violation, fieldName, isReadOnly);
                    }
                });
            }

            contentContainer.appendChild(addButton);
            contentContainer.appendChild(listContainer);
            this.renderList(listContainer, violation, fieldName, isReadOnly);

        } else if (type === 'text') {
            const textarea = document.createElement('textarea');
            textarea.className = RENDER_CLASSES.VIOLATION_TEXTAREA;
            textarea.placeholder = label ? `Введите ${label.toLowerCase()}...` : '...';
            textarea.value = violation[fieldName].content || '';
            textarea.rows = 3;

            if (isReadOnly) {
                textarea.readOnly = true;
                textarea.classList.add('read-only');
            } else {
                // Настраиваем обработку клавиш
                this.setupTextareaHandlers(textarea, (value) => {
                    this.setViolationField(violation, `${fieldName}.content`, value);
                });
            }

            contentContainer.appendChild(textarea);
        }

        fieldContainer.appendChild(contentContainer);
        return fieldContainer;
    }

    /**
     * Отрисовывает маркированный список элементов
     * @param {HTMLElement} container - Контейнер для списка
     * @param {Object} violation - Объект нарушения
     * @param {string} fieldName - Имя поля со списком
     */
    renderList(container, violation, fieldName, isReadOnly = false) {
        container.innerHTML = '';

        violation[fieldName].items.forEach((item, index) => {
            const itemContainer = document.createElement('div');
            itemContainer.className = 'violation-list-item';
            // Подсветка пустого пункта (#9-Г, Wave 2): не блокирует ввод, только визуальный сигнал.
            itemContainer.classList.toggle('violation-list-item--empty', !item.trim());

            const input = document.createElement('input');
            input.type = 'text';
            input.className = RENDER_CLASSES.VIOLATION_LIST_INPUT;
            input.value = item;
            input.placeholder = `Пункт ${index + 1}`;

            if (isReadOnly) {
                input.readOnly = true;
                input.classList.add('read-only');
            } else {
                let originalValue = item;

                // Обновляем массив при вводе
                input.addEventListener('input', () => {
                    this.setViolationListItem(violation, index, input.value);
                    itemContainer.classList.toggle('violation-list-item--empty', !input.value.trim());
                });

                // Обработка горячих клавиш для элементов списка
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        // Enter — сохранить и снять фокус
                        e.preventDefault();
                        input.blur();
                    } else if (e.key === 'Escape') {
                        // Escape — отменить изменения
                        e.preventDefault();
                        input.value = originalValue;
                        violation[fieldName].items[index] = originalValue;
                        itemContainer.classList.toggle('violation-list-item--empty', !originalValue.trim());
                        input.blur();
                        PreviewManager.updateBlock('violation', violation.id);
                    }
                });

                // Запоминаем исходное значение
                input.addEventListener('focus', () => {
                    originalValue = input.value;
                });
            }

            // Кнопка удаления элемента списка
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'violation-list-delete-btn';
            deleteBtn.textContent = '×';
            deleteBtn.disabled = isReadOnly;

            if (!isReadOnly) {
                deleteBtn.addEventListener('click', () => {
                    if (this.removeViolationListItem(violation, index)) {
                        this.renderList(container, violation, fieldName, isReadOnly);
                    }
                });
            }

            itemContainer.appendChild(input);
            itemContainer.appendChild(deleteBtn);
            container.appendChild(itemContainer);
        });
    }
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.ViolationManager = ViolationManager;
