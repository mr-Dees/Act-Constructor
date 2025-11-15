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
        } catch (err) {
            Notifications.error(`Ошибка инициализации состояния: ${err.message}`);
            throw err;
        }

        try {
            this._initializeManagers();
        } catch (err) {
            Notifications.error(`Ошибка инициализации менеджеров: ${err.message}`);
            // продолжим работу, приложение частично работоспособно
        }

        try {
            this._setupEventHandlers();
        } catch (err) {
            Notifications.error(`Ошибка настройки событий: ${err.message}`);
        }
    }

    /**
     * Инициализация начального состояния приложения
     * @private
     */
    static _initializeState() {
        AppState.initializeTree();
        AppState.generateNumbering();

        if (!AppState.tableUISizes) {
            AppState.tableUISizes = {};
        }
    }

    /**
     * Инициализация всех менеджеров приложения
     * @private
     */
    static _initializeManagers() {
        // Оборачиваем каждый блок в try/catch для "graceful degrade"
        try {
            treeManager.render();
        } catch (err) {
            Notifications.error('Ошибка инициализации дерева: ' + err.message);
        }

        try {
            requestAnimationFrame(() => PreviewManager.update());
        } catch (err) {
            Notifications.error('Ошибка инициализации PreviewManager: ' + err.message);
        }

        try {
            ContextMenuManager.init();
        } catch (err) {
            Notifications.error('Ошибка инициализации ContextMenuManager: ' + err.message);
        }

        try {
            HelpManager.init();
        } catch (err) {
            Notifications.error('Ошибка инициализации HelpManager: ' + err.message);
        }
    }

    /**
     * Настройка глобальных обработчиков событий
     * @private
     */
    static _setupEventHandlers() {
        try {
            NavigationManager.setup();
        } catch (err) {
            Notifications.error('Ошибка NavigationManager: ' + err.message);
        }

        try {
            FormatMenuManager.setup();
        } catch (err) {
            Notifications.error('Ошибка FormatMenuManager: ' + err.message);
        }

        try {
            this._setupGlobalKeyboardShortcuts();
        } catch (err) {
            Notifications.error('Ошибка инициализации горячих клавиш: ' + err.message);
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

        HelpManager?.updateTooltip();
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
