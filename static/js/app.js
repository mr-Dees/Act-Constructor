/**
 * Главный класс приложения
 *
 * Координирует инициализацию всех модулей и управляет глобальным состоянием.
 * Делегирует специфичную логику соответствующим менеджерам.
 */
class App {
    /**
     * Инициализация приложения при загрузке страницы
     */
    static init() {
        try {
            this._initializeState();
            this._initializeManagers();
            this._setupEventHandlers();
        } catch (err) {
            console.error('Критическая ошибка инициализации приложения:', err);
            Notifications.error(`Ошибка инициализации приложения: ${err.message}`);
        }
    }

    /**
     * Инициализация начального состояния приложения
     * @private
     */
    static _initializeState() {
        try {
            AppState.initializeTree();
            AppState.generateNumbering();

            if (!AppState.tableUISizes) {
                AppState.tableUISizes = {};
            }
        } catch (err) {
            console.error('Ошибка инициализации состояния:', err);
            Notifications.error(`Ошибка инициализации состояния: ${err.message}`);
            throw err;
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
     * Настройка глобальных горячих клавиш
     * @private
     */
    static _setupGlobalKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.code === AppConfig.hotkeys.save.key) {
                e.preventDefault();

                if (AppState.currentStep === 2) {
                    const generateBtn = document.getElementById('generateBtn');
                    generateBtn?.click();
                }
            }
        });
    }

    /**
     * Переключение между шагами приложения
     * @param {number} stepNum - Номер шага (1 или 2)
     */
    static goToStep(stepNum) {
        AppState.currentStep = stepNum;

        this._updateStepVisibility(stepNum);
        this._handleStepTransition(stepNum);

        HelpManager.updateTooltip();
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
        } else {
            textBlockManager.hideToolbar();
            requestAnimationFrame(() => PreviewManager.update('previewTrim'));
        }
    }
}

// Запуск приложения при загрузке DOM
document.addEventListener('DOMContentLoaded', () => App.init());
