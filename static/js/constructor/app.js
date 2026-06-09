/**
 * Главный класс приложения
 *
 * Координирует инициализацию всех модулей и управляет глобальным состоянием.
 * Делегирует специфичную логику соответствующим менеджерам.
 * Интегрирован с StorageManager для автосохранения.
 */
import { ContextMenuManager } from './context-menu/context-menu-core.js';
import { HelpManager } from './dialog/dialog-help.js';
import { FormatMenuManager } from './header/format-menu-manager.js';
import { ItemsRenderer } from './items/items-renderer.js';
import { LifecycleHelper } from './lifecycle-helper.js';
import { NavigationManager } from './navigation-manager.js';
import { PreviewManager } from './preview/preview.js';
import { AppState } from './state/state-core.js';
import { StorageManager } from './storage-manager.js';
import { AppConfig } from '../shared/app-config.js';
import { Notifications } from '../shared/notifications.js';

export class App {
    // Базовые префиксы LS-ключей. Реальные ключи строятся через _getStepKey/_getScrollKey
    // и включают act_id, чтобы шаг и скролл одного акта не подтекали в другой.
    // Старые ключи без суффикса удаляются в _migrateLegacyKeys() при init.
    static _stepKeyPrefix = 'constructor_current_step';
    static _scrollKeyPrefix = 'constructor_scroll_positions';
    static _stepStorageKey = 'constructor_current_step';   // legacy (для миграции)
    static _scrollStorageKey = 'constructor_scroll_positions'; // legacy

    /**
     * Возвращает per-act LS-ключ для текущего шага.
     * Если currentActId ещё не задан — fallback на legacy-ключ.
     * @private
     */
    static _getStepKey() {
        const id = window.currentActId;
        return id ? `${this._stepKeyPrefix}:${id}` : this._stepStorageKey;
    }

    /**
     * Возвращает per-act LS-ключ для позиций скролла.
     * @private
     */
    static _getScrollKey() {
        const id = window.currentActId;
        return id ? `${this._scrollKeyPrefix}:${id}` : this._scrollStorageKey;
    }

    /**
     * Одноразовая миграция: удаляет legacy-ключи без actId, которые могли
     * остаться от предыдущих версий и шадовить per-act ключи.
     * @private
     */
    static _migrateLegacyKeys() {
        try {
            localStorage.removeItem(this._stepStorageKey);
            localStorage.removeItem(this._scrollStorageKey);
        } catch { /* ignore */ }
    }

    /**
     * Инициализация приложения при загрузке страницы
     */
    static init() {
        try {
            // С defer-загрузкой scripts state-core.js может успеть установить
            // Proxy ДО App.init: его bottom-code в ветке `readyState !== 'loading'`
            // ставит setTimeout(0), который выполняется до DOMContentLoaded-обработчика
            // app.js. Без явного disableTracking() мутации внутри _initializeState()
            // (AppState.initializeTree → generateNumbering → ...) трекаются Proxy
            // и поднимают _hasUnsavedChanges=true ДО StorageManager.init(), из-за чего
            // индикатор стартует в local-only/unsaved вместо saved.
            // markAsSyncedWithDB() в финале сбрасывает оба флага в "чистое" состояние.
            StorageManager.disableTracking();

            this._initializeState();
            this._initializeStorageManager();
            this._initializeManagers();
            this._setupEventHandlers();

            // Восстанавливаем шаг и позицию скролла из localStorage (per-act ключи).
            this._restoreStep();
            this._setupScrollPersistence();
            // После _restoreStep/_restoreScroll legacy-значения уже подхвачены
            // в per-act ключи — теперь чистим старые.
            this._migrateLegacyKeys();

            // Применяем режим только чтения если активен
            if (AppConfig.readOnlyMode?.isReadOnly) {
                this._applyReadOnlyMode();
            }

            // Сбрасываем флаги после init: дефолтное дерево/таблицы — это не
            // правки пользователя, а bootstrap-состояние. После loadActContent
            // данные перезапишутся и тоже не должны считаться "грязными".
            StorageManager.markAsSyncedWithDB();
            StorageManager.enableTracking();
        } catch (err) {
            console.error('Критическая ошибка инициализации приложения:', err);
            Notifications.error(`Ошибка инициализации приложения: ${err.message}`);
            // Даже при ошибке снимаем tracking-гард, иначе все последующие
            // правки пользователя перестанут трекаться.
            StorageManager.enableTracking();
        }
    }

    /**
     * Инициализация начального состояния приложения
     * @private
     */
    static _initializeState() {
        try {
            // По умолчанию создаём процессную проверку
            // При загрузке акта из БД структура будет перезаписана
            AppState.initializeTree(true);
            AppState.generateNumbering();
        } catch (err) {
            console.error('Ошибка инициализации состояния:', err);
            Notifications.error(`Ошибка инициализации состояния: ${err.message}`);
            throw err;
        }
    }

    /**
     * Инициализация менеджера хранилища
     * @private
     */
    static _initializeStorageManager() {
        try {
            StorageManager.init();
        } catch (err) {
            console.error('Ошибка инициализации StorageManager:', err);
            // Не критичная ошибка, продолжаем работу без автосохранения
        }
    }

    /**
     * Инициализация всех менеджеров приложения
     * @private
     */
    static _initializeManagers() {
        const managers = [
            {name: 'Tree', fn: () => treeManager.render()},
            {name: 'Preview', fn: () => requestAnimationFrame(() => PreviewManager.update())},
            {name: 'ContextMenu', fn: () => ContextMenuManager.init()},
            {name: 'Help', fn: () => HelpManager.init()}
        ];

        for (const manager of managers) {
            try {
                manager.fn();
            } catch (err) {
                console.error(`Ошибка инициализации ${manager.name}:`, err);
                Notifications.error(`Ошибка инициализации ${manager.name}: ${err.message}`);
            }
        }
    }

    /**
     * Настройка глобальных обработчиков событий
     * @private
     */
    static _setupEventHandlers() {
        const handlers = [
            {name: 'Navigation', fn: () => NavigationManager.setup()},
            {name: 'FormatMenu', fn: () => FormatMenuManager.setup()},
            {name: 'SaveIndicator', fn: () => this._setupSaveIndicator()},
            {name: 'Hotkeys', fn: () => this._setupGlobalKeyboardShortcuts()}
        ];

        for (const handler of handlers) {
            try {
                handler.fn();
            } catch (err) {
                console.error(`Ошибка настройки ${handler.name}:`, err);
                Notifications.error(`Ошибка настройки ${handler.name}: ${err.message}`);
            }
        }
    }

    /**
     * Настройка индикатора сохранности
     * @private
     */
    static _setupSaveIndicator() {
        const saveIndicatorBtn = document.getElementById('saveIndicatorBtn');

        if (saveIndicatorBtn) {
            // Удаляем старые обработчики если были
            const newBtn = saveIndicatorBtn.cloneNode(true);
            saveIndicatorBtn.parentNode.replaceChild(newBtn, saveIndicatorBtn);

            // Добавляем новый обработчик
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                console.log('Save indicator clicked, disabled:', newBtn.disabled);

                if (!newBtn.disabled) {
                    StorageManager.forceSave();
                }
            });

            console.log('Save indicator setup complete');
        } else {
            console.error('saveIndicatorBtn not found');
        }
    }

    /**
     * Настройка глобальных горячих клавиш
     * @private
     */
    static _setupGlobalKeyboardShortcuts() {
        document.addEventListener('keydown', async (e) => {
            if ((e.ctrlKey || e.metaKey) && e.code === AppConfig.hotkeys.save.key) {
                e.preventDefault();
                e.stopImmediatePropagation();

                // H5-A: коммитим pending-редактирование ячейки до сохранения.
                // Без этого Ctrl+S во время editing'а ячейки уходил бы с старым content,
                // потому что textarea.value попадает в AppState только на blur/Enter.
                if (typeof tableManager !== 'undefined' && tableManager.cellsOps?.commitPendingEdit) {
                    tableManager.cellsOps.commitPendingEdit();
                }
                // Аналогично для активного textblock-редактора (его blur синхронит innerHTML
                // в textBlock.content через handleEditorBlur).
                const activeEl = document.activeElement;
                if (activeEl && activeEl.classList?.contains('textblock-editor')) {
                    activeEl.blur();
                }

                // Сохранение с блокировкой + генерация
                await StorageManager.forceSaveAsync();

                // Генерация уже внутри блокирует отслеживание
                const generateBtn = document.getElementById('generateBtn');
                if (generateBtn) {
                    generateBtn.click();
                }
            }
        });
    }

    /**
     * Переключение между шагами приложения
     * @param {number} stepNum - Номер шага (1 или 2)
     */
    static goToStep(stepNum) {
        // Обновляем текущий шаг
        AppState.currentStep = stepNum;
        try {
            localStorage.setItem(this._getStepKey(), stepNum);
        } catch { /* quota — ignore */ }

        this._updateStepVisibility(stepNum);
        this._handleStepTransition(stepNum);

        HelpManager.updateTooltip();
    }

    /**
     * Восстанавливает шаг из localStorage
     * @private
     */
    static _restoreStep() {
        let saved = localStorage.getItem(this._getStepKey());
        if (!saved && window.currentActId) {
            // Fallback на legacy-ключ — мигрируем значение в per-act, legacy потом удалится.
            saved = localStorage.getItem(this._stepStorageKey);
        }
        if (saved) {
            const step = parseInt(saved, 10);
            if (step === 2) {
                this.goToStep(2);
            }
        }
    }

    /**
     * Обновление видимости шагов в UI
     * @private
     * @param {number} stepNum - Номер активного шага
     */
    static _updateStepVisibility(stepNum) {
        // Обновляем индикаторы в заголовке
        document.querySelectorAll('.step').forEach(step => {
            step.classList.toggle('active', parseInt(step.dataset.step) === stepNum);
        });

        // Скрываем все контенты шагов
        document.querySelectorAll('.step-content').forEach(content => {
            content.classList.add('hidden');
        });

        // Показываем текущий шаг
        const currentContent = document.getElementById(`step${stepNum}`);
        currentContent?.classList.remove('hidden');
    }

    /**
     * Обработка специфичной логики при переходе на шаг
     * @private
     * @param {number} stepNum - Номер шага
     */
    static _handleStepTransition(stepNum) {
        if (stepNum === 2) {
            textBlockManager.initGlobalToolbar();
            ItemsRenderer.renderAll();

            // Применяем режим только чтения к новым элементам
            if (AppConfig.readOnlyMode?.isReadOnly) {
                this._applyReadOnlyToContent();
            }
        } else {
            textBlockManager.hideToolbar();
            requestAnimationFrame(() => PreviewManager.update('previewTrim'));
        }
    }

    /**
     * Настраивает сохранение позиций скролла при уходе со страницы
     * и восстанавливает сохранённые позиции
     * @private
     */
    static _setupScrollPersistence() {
        // Сохраняем позиции при уходе со страницы (через общий реестр beforeunload).
        if (typeof LifecycleHelper !== 'undefined') {
            LifecycleHelper.registerBeforeUnload('app:scroll', () => this._saveScrollPositions());
        } else {
            window.addEventListener('beforeunload', () => this._saveScrollPositions());
        }

        // Восстанавливаем позиции после полной отрисовки
        requestAnimationFrame(() => this._restoreScrollPositions());
    }

    /**
     * Сохраняет позиции скролла всех панелей в localStorage
     * @private
     */
    static _saveScrollPositions() {
        const positions = {};

        const tree = document.querySelector('.tree-container');
        if (tree) positions.tree = tree.scrollTop;

        const preview = document.querySelector('.preview');
        if (preview) positions.preview = preview.scrollTop;

        const step2 = document.getElementById('step2');
        if (step2) positions.step2 = step2.scrollTop;

        try {
            localStorage.setItem(this._getScrollKey(), JSON.stringify(positions));
        } catch { /* quota — ignore */ }
    }

    /**
     * Восстанавливает позиции скролла из localStorage (per-act ключ с fallback на legacy).
     * @private
     */
    static _restoreScrollPositions() {
        let saved = localStorage.getItem(this._getScrollKey());
        if (!saved && window.currentActId) {
            saved = localStorage.getItem(this._scrollStorageKey);
        }
        if (!saved) return;

        try {
            const positions = JSON.parse(saved);

            const tree = document.querySelector('.tree-container');
            if (tree && positions.tree) tree.scrollTop = positions.tree;

            const preview = document.querySelector('.preview');
            if (preview && positions.preview) preview.scrollTop = positions.preview;

            const step2 = document.getElementById('step2');
            if (step2 && positions.step2) step2.scrollTop = positions.step2;
        } catch (e) {
            console.error('Ошибка восстановления позиции скролла:', e);
        }
    }

    /**
     * Применяет режим только чтения к интерфейсу
     * @private
     */
    static _applyReadOnlyMode() {
        console.log('Применяется режим только чтения');

        // Добавляем класс к body для глобальных стилей
        document.body.classList.add('read-only-mode');

        // Отключаем кнопку сохранения
        const saveIndicatorBtn = document.getElementById('saveIndicatorBtn');
        if (saveIndicatorBtn) {
            saveIndicatorBtn.disabled = true;
            saveIndicatorBtn.title = AppConfig.readOnlyMode.messages.cannotSave;
            saveIndicatorBtn.classList.add('disabled');
        }

        // Отключаем кнопку генерации
        const generateBtn = document.getElementById('generateBtn');
        if (generateBtn) {
            // Генерация всё ещё доступна для просмотра, но без сохранения в БД
            // Оставляем активной для экспорта
        }

        // Скрываем тулбар форматирования в режиме просмотра
        const toolbar = document.querySelector('.formatting-toolbar');
        if (toolbar) {
            toolbar.classList.add('read-only-hidden');
        }
    }

    /**
     * Применяет режим только чтения к контенту (таблицы, текстблоки, нарушения)
     * @private
     */
    static _applyReadOnlyToContent() {
        // Делаем текстовые блоки нередактируемыми
        document.querySelectorAll('.textblock-content[contenteditable="true"]').forEach(el => {
            el.contentEditable = 'false';
            el.classList.add('read-only');
        });

        // Делаем ячейки таблиц нередактируемыми
        document.querySelectorAll('.table-cell[contenteditable="true"]').forEach(el => {
            el.contentEditable = 'false';
            el.classList.add('read-only');
        });

        // Делаем поля нарушений нередактируемыми
        document.querySelectorAll('.violation-field[contenteditable="true"]').forEach(el => {
            el.contentEditable = 'false';
            el.classList.add('read-only');
        });

        // Делаем input и textarea нередактируемыми
        document.querySelectorAll('.violation-editor input, .violation-editor textarea').forEach(el => {
            el.readOnly = true;
            el.classList.add('read-only');
        });
    }
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
// App.init() запускается из entries/constructor.js, НЕ здесь:
// shared/api.js импортирует этот файл косвенно из portal-entry, и
// module-level DOMContentLoaded-подписка стреляла на portal-страницах,
// падая на AppState.generateNumbering (state-tree.js в portal не входит).
window.App = App;
