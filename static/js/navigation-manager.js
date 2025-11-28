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
     * Настройка кнопки "Сохранить и экспортировать"
     * @private
     */
    static _setupSaveButton() {
        const generateBtn = document.getElementById('generateBtn');
        generateBtn?.addEventListener('click', async () => {
            await this._handleSaveAndExport(generateBtn);
        });
    }

    /**
     * Обработка сохранения и экспорта
     * @private
     * @param {HTMLElement} generateBtn - Кнопка сохранения
     */
    static async _handleSaveAndExport(generateBtn) {
        // Проверка наличия выбранного акта
        if (!window.currentActId) {
            Notifications.warning('Сначала выберите акт');
            return;
        }

        // Получаем выбранные действия
        const selectedFormats = FormatMenuManager.getSelectedFormats();
        const shouldSaveToDb = selectedFormats.includes('db');
        const exportFormats = selectedFormats.filter(f => f !== 'db');

        // Проверка что выбрано хотя бы одно действие
        if (selectedFormats.length === 0) {
            Notifications.error(
                'Выберите хотя бы одно действие',
                AppConfig.notifications.duration.error
            );
            return;
        }

        // Валидация структуры акта (только для экспорта)
        if (exportFormats.length > 0) {
            if (!this._validateStructure()) return;
            if (!this._validateTables()) return;
        }

        // Синхронизация данных из DOM в AppState
        if (typeof ItemsRenderer !== 'undefined') {
            ItemsRenderer.syncDataToState();
        }

        // Блокируем кнопку
        generateBtn.disabled = true;
        const originalText = generateBtn.textContent;
        generateBtn.textContent = '⏳ Обработка...';

        try {
            // 1. Сохранение в БД (если выбрано)
            if (shouldSaveToDb) {
                await this._saveToDatabase();
            }

            // 2. Экспорт файлов (если выбраны форматы)
            if (exportFormats.length > 0) {
                await this._exportFiles(exportFormats);
            }

        } catch (error) {
            console.error('Ошибка при обработке:', error);
            Notifications.error(
                `Произошла ошибка: ${error.message}`,
                AppConfig.notifications.duration.error
            );
        } finally {
            // Разблокируем кнопку
            generateBtn.disabled = false;
            generateBtn.textContent = originalText;
        }
    }

    /**
     * Сохранение в базу данных
     * @private
     */
    static async _saveToDatabase() {
        try {
            await APIClient.saveActContent(window.currentActId);
            // Уведомление уже показано в APIClient.saveActContent
        } catch (err) {
            console.error('Ошибка сохранения в БД:', err);
            throw err; // Пробрасываем ошибку выше
        }
    }

    /**
     * Экспорт файлов в выбранных форматах
     * @private
     * @param {string[]} formats - Массив форматов для экспорта
     */
    static async _exportFiles(formats) {
        try {
            await APIClient.generateAct(formats);
            // Уведомления и диалог скачивания показаны в APIClient.generateAct
        } catch (err) {
            console.error('Ошибка экспорта файлов:', err);
            throw err; // Пробрасываем ошибку выше
        }
    }

    /**
     * Валидация структуры акта
     * @private
     * @returns {boolean} true если валидация прошла успешно
     */
    static _validateStructure() {
        const result = ValidationAct.validateStructure();
        if (!result.valid) {
            Notifications.error(
                result.message,
                AppConfig.notifications.duration.error
            );
            return false;
        }
        return true;
    }

    /**
     * Валидация таблиц
     * @private
     * @returns {boolean} true если валидация прошла успешно
     */
    static _validateTables() {
        // Критическая проверка заголовков таблиц
        const headerCheckResult = ValidationTable.validateHeaders();
        if (!headerCheckResult.valid) {
            Notifications.error(
                headerCheckResult.message,
                AppConfig.notifications.duration.warning
            );
            return false;
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

        return true;
    }
}
