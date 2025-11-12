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
        this._initializeState();
        this._initializeManagers();
        this._setupEventHandlers();
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
        treeManager.render();

        setTimeout(() => PreviewManager.update('previewTrim'), 30);

        ContextMenuManager.init();
        HelpManager.init();
    }

    /**
     * Настройка глобальных обработчиков событий
     * @private
     */
    static _setupEventHandlers() {
        NavigationManager.setup();
        FormatMenuManager.setup();
        this._setupGlobalKeyboardShortcuts();
    }

    /**
     * Настройка глобальных горячих клавиш
     * @private
     */
    static _setupGlobalKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
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
            setTimeout(() => PreviewManager.update('previewTrim'), 30);
        }
    }
}

// Запуск приложения при загрузке DOM
document.addEventListener('DOMContentLoaded', () => App.init());
