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
                await APIClient.saveActContent(window.currentActId);
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
            // Если НЕ сохранили, нужно сохранить перед unlock
            if (!wasSaved && window.currentActId && typeof AppState !== 'undefined' && AppState?.exportData) {
                try {
                    if (typeof Notifications !== 'undefined') {
                        Notifications.info('Сохранение текущего состояния...', AppConfig.notifications.duration.info);
                    }

                    const username = AuthManager?.getCurrentUser?.() || null;
                    if (username) {
                        const data = AppState.exportData();
                        const saveResp = await fetch(
                            AppConfig.api.getUrl(`/api/v1/acts_content/${window.currentActId}/content`),
                            {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-JupyterHub-User': username
                                },
                                body: JSON.stringify(data)
                            }
                        );

                        if (!saveResp.ok) {
                            console.warn('Не удалось сохранить состояние перед выходом, код', saveResp.status);
                        } else {
                            console.log('Текущее состояние сохранено перед выходом');
                        }
                    }
                } catch (saveErr) {
                    console.error('Ошибка сохранения состояния перед выходом:', saveErr);
                    // Продолжаем выход даже если не удалось сохранить
                }
            }

            // Снимаем блокировку через LockManager
            if (window.LockManager && typeof LockManager.manualUnlock === 'function') {
                await LockManager.manualUnlock();
            }

            // Устанавливаем флаг успешного выхода
            sessionStorage.setItem('sessionExitedWithSave', 'true');

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
