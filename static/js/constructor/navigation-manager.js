/**
 * Менеджер навигации между шагами
 *
 * Управляет переходами между шагами конструктора,
 * обработкой кнопок навигации и валидацией данных перед сохранением.
 */
import { App } from './app.js';
import { FormatMenuManager } from './header/format-menu-manager.js';
import { StorageManager } from './storage-manager.js';
import { ValidationAct } from './validation/validation-act.js';
import { ValidationTable } from './validation/validation-table.js';
import { APIClient, LockLostError } from '../shared/api.js';
import { AppConfig } from '../shared/app-config.js';
import { Notifications } from '../shared/notifications.js';

export class NavigationManager {
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

        // Валидация структуры акта — всегда, перед любым действием:
        // сохранение «только в БД» проходит те же проверки, что и экспорт.
        if (!this._validateStructure()) return;
        if (!this._validateTables()) return;

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
            // 409 Conflict на save: лок акта был снят (фоновый autoExit по
            // неактивности — вкладка была в фоне). В отличие от обычного
            // autoExit'а, тут save НЕ прошёл (markAsSyncedWithDB не вызвался) —
            // изменения НЕ записаны в БД. Ставим ОТДЕЛЬНЫЙ флаг `sessionLockLost`
            // (не `sessionAutoExited`, у которого плашка лжёт «изменения
            // сохранены») и редиректим на список. Черновик в localStorage НЕ
            // трогаем — он остаётся последним носителем несохранённых правок.
            if (typeof LockLostError !== 'undefined' && error instanceof LockLostError) {
                console.warn('[NavigationManager] LockLostError на save → редирект на список актов (изменения НЕ в БД)');
                sessionStorage.setItem('sessionLockLost', 'true');
                // Снимаем браузерный beforeunload-warning. allowUnload() НЕ
                // чистит localStorage — только ставит флаг программного выхода,
                // так что локальный черновик сохраняется.
                if (typeof StorageManager !== 'undefined' && typeof StorageManager.allowUnload === 'function') {
                    StorageManager.allowUnload();
                }
                // Жёсткий редирект без confirmNavigation: save вернул 409,
                // markAsSyncedWithDB не вызвался, hasUnsavedChanges=true →
                // confirmNavigation показал бы кастомную плашку «Несохранённые
                // изменения. Уйти?» и блокировал бы навигацию. Сессия уже
                // завершена — спрашивать поздно.
                window.location.href = AppConfig.api.getUrl('/acts');
                return;
            }
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
            await APIClient.saveActContent(window.currentActId, { saveType: 'manual' });
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

        // Предупреждение о пустых таблицах (не блокирует, уровень warning)
        const dataCheckResult = ValidationTable.validateData();
        if (dataCheckResult.isWarning) {
            Notifications.show(
                dataCheckResult.message,
                'warning',
                AppConfig.notifications.duration.warning
            );
        }

        // Предупреждение о незаполненных ТБ (не блокирует, уровень warning)
        const tbCheckResult = ValidationAct.validateTb();
        if (tbCheckResult.isWarning) {
            Notifications.show(
                tbCheckResult.message,
                'warning',
                AppConfig.notifications.duration.warning
            );
        }

        return true;
    }
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.NavigationManager = NavigationManager;
