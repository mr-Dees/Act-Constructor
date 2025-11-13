/**
 * Менеджер навигации между шагами
 *
 * Управляет переходами между шагами конструктора,
 * обработкой кнопок навигации и валидацией данных перед сохранением.
 */
class NavigationManager {
    /**
     * Настройка обработчиков навигации
     */
    static setup() {
        this._setupStepButtons();
        this._setupHeaderNavigation();
        this._setupSaveButton();
    }

    /**
     * Настройка кнопок навигации между шагами
     * @private
     */
    static _setupStepButtons() {
        const nextBtn = document.getElementById('nextBtn');
        const backBtn = document.getElementById('backBtn');

        nextBtn?.addEventListener('click', () => App.goToStep(2));
        backBtn?.addEventListener('click', () => App.goToStep(1));
    }

    /**
     * Настройка навигации через клик по заголовкам шагов
     * @private
     */
    static _setupHeaderNavigation() {
        const header = document.querySelector('.header');
        header?.querySelectorAll('.step').forEach(step => {
            step.addEventListener('click', () => {
                const stepNum = parseInt(step.dataset.step);
                App.goToStep(stepNum);
            });
        });
    }

    /**
     * Настройка кнопки сохранения с валидацией
     * @private
     */
    static _setupSaveButton() {
        const generateBtn = document.getElementById('generateBtn');

        generateBtn?.addEventListener('click', async () => {
            await this._handleSave(generateBtn);
        });
    }

    /**
     * Обработка сохранения с полной валидацией
     * @private
     * @param {HTMLElement} generateBtn - Кнопка сохранения
     */
    static async _handleSave(generateBtn) {
        const selectedFormats = FormatMenuManager.getSelectedFormats();

        // Валидация форматов
        if (selectedFormats.length === 0) {
            Notifications.error(
                'Выберите хотя бы один формат для сохранения',
                AppConfig.notifications.duration.error
            );
            return;
        }

        // Валидация структуры акта
        const validationResult = ValidationAct.validateStructure();
        if (!validationResult.valid) {
            Notifications.error(
                validationResult.message,
                AppConfig.notifications.duration.error
            );
            return;
        }

        // Критическая проверка заголовков таблиц
        const headerCheckResult = ValidationTable.validateHeaders();
        if (!headerCheckResult.valid) {
            Notifications.error(
                headerCheckResult.message,
                AppConfig.notifications.duration.warning
            );
            return;
        }

        // Предупреждение о пустых таблицах
        const dataCheckResult = ValidationTable.validateData();
        if (!dataCheckResult.valid) {
            Notifications.show(
                dataCheckResult.message,
                'info',
                AppConfig.notifications.duration.warning
            );
        }

        // Синхронизация данных из DOM
        ItemsRenderer.syncDataToState();

        // Выполнение сохранения с блокировкой UI
        await this._performSave(generateBtn, selectedFormats);
    }

    /**
     * Выполнение сохранения с обработкой состояния кнопки
     * @private
     * @param {HTMLElement} button - Кнопка сохранения
     * @param {string[]} formats - Выбранные форматы
     */
    static async _performSave(button, formats) {
        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = '⏳ Создаём акты...';

        try {
            await APIClient.generateAct(formats);
        } catch (error) {
            Notifications.error(
                `Произошла непредвиденная ошибка: ${error.message}`,
                AppConfig.notifications.duration.error
            );
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}
