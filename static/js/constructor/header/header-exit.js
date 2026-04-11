/**
 * Обработчик кнопки выхода в список актов
 *
 * Выполняет корректное завершение сессии редактирования:
 * - Сохраняет текущее состояние акта
 * - Снимает блокировку
 * - Переходит на главную страницу
 */
class HeaderExit {
    /**
     * Инициализирует обработчик кнопки выхода
     */
    static init() {
        const exitBtn = document.getElementById('exitToActsBtn');

        if (!exitBtn) {
            console.warn('HeaderExit: кнопка выхода не найдена');
            return;
        }

        exitBtn.addEventListener('click', async () => {
            await this._handleExit();
        });

        console.log('HeaderExit инициализирован');
    }

    /**
     * Обрабатывает выход из редактора
     * @private
     */
    static async _handleExit() {
        // Read-only пользователи просто выходят без вопросов о сохранении
        if (AppConfig.readOnlyMode?.isReadOnly) {
            window.location.href = AppConfig.api.getUrl('/acts');
            return;
        }

        // Проверяем есть ли изменения
        const hasUnsavedChanges = StorageManager?.hasUnsavedChanges?.() || false;

        if (hasUnsavedChanges) {
            // Спрашиваем про сохранение
            const shouldSave = await DialogManager.show({
                title: 'Сохранить изменения?',
                message: 'У вас есть несохраненные изменения. Сохранить перед выходом?',
                icon: '💾',
                confirmText: 'Сохранить и выйти',
                cancelText: 'Выйти без сохранения',
                type: 'warning'
            });

            if (shouldSave) {
                await this._saveAndExit();
            } else {
                await this._exitWithoutSaving();
            }
        } else {
            // Нет изменений - просто выходим
            await this._exitWithoutSaving();
        }
    }

    /**
     * Сохраняет акт и выходит
     * @private
     */
    static async _saveAndExit() {
        try {
            // Показываем индикатор загрузки
            if (typeof Notifications !== 'undefined') {
                Notifications.info('Сохранение...', AppConfig.notifications.duration.info);
            }

            // Сохраняем контент
            if (window.currentActId && typeof APIClient !== 'undefined') {
                await APIClient.saveActContent(window.currentActId, { saveType: 'manual' });
            }

            // Успешно сохранили - теперь выходим
            await this._performExit(true);

        } catch (error) {
            console.error('Ошибка сохранения при выходе:', error);

            if (typeof Notifications !== 'undefined') {
                Notifications.error(
                    'Ошибка сохранения: ' + error.message,
                    AppConfig.notifications.duration.error
                );
            }

            // Спрашиваем выйти ли без сохранения
            const forceExit = await DialogManager.show({
                title: 'Ошибка сохранения',
                message: 'Не удалось сохранить изменения. Выйти без сохранения?',
                icon: '❌',
                confirmText: 'Да, выйти',
                cancelText: 'Отмена',
                type: 'danger'
            });

            if (forceExit) {
                await this._exitWithoutSaving();
            }
        }
    }

    /**
     * Выходит без сохранения
     * @private
     */
    static async _exitWithoutSaving() {
        await this._performExit(false);
    }

    /**
     * Выполняет выход: снимает блокировку и переходит на главную
     * @private
     * @param {boolean} wasSaved - Были ли сохранены изменения перед выходом
     */
    static async _performExit(wasSaved = false) {
        try {
            // Read-only пользователи не сохраняют и не разблокируют
            if (AppConfig.readOnlyMode?.isReadOnly) {
                console.log('HeaderExit: read-only режим, пропускаем сохранение и unlock');
                window.location.href = AppConfig.api.getUrl('/acts');
                return;
            }

            // Разрешаем навигацию без предупреждения браузера
            if (typeof StorageManager !== 'undefined' && typeof StorageManager.allowUnload === 'function') {
                StorageManager.allowUnload();
            }

            // Снимаем блокировку через LockManager
            if (window.LockManager && typeof LockManager.manualUnlock === 'function') {
                await LockManager.manualUnlock();
            }

            // Устанавливаем флаг только если данные были сохранены
            if (wasSaved) {
                sessionStorage.setItem('sessionExitedWithSave', 'true');
            }

            // Переходим на главную
            window.location.href = AppConfig.api.getUrl('/acts');

        } catch (error) {
            console.error('Ошибка при выходе:', error);

            // Все равно пытаемся перейти
            window.location.href = AppConfig.api.getUrl('/acts');
        }
    }
}

// Инициализируем при загрузке DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => HeaderExit.init());
} else {
    HeaderExit.init();
}

// Глобальный доступ
window.HeaderExit = HeaderExit;
