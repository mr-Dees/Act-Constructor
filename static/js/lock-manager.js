/**
 * Менеджер блокировок актов
 *
 * Загружает настройки с сервера и работает с ними.
 * Автоматически завершает работу при бездействии если пользователь не реагирует.
 * При выходе всегда сохраняет изменения.
 */
class LockManager {
    static _actId = null;
    static _config = null;
    static _inactivityCheckInterval = null;
    static _extensionInterval = null;
    static _inactivityDialogTimeout = null;
    static _lastActivity = Date.now();
    static _lastExtensionAt = Date.now();
    static _exitPending = null;

    /**
     * Инициализация менеджера блокировок
     */
    static async init(actId) {
        this._actId = actId;
        this._resetState();

        try {
            await this._loadConfig();
            await this._lockAct();

            this._setupActivityTracking();
            this._startInactivityCheck();
            this._startAutoExtension();
            this._setupBeforeUnload();
            this._setupPageHide();

            console.log('LockManager инициализирован для акта', actId);
            console.log('Настройки блокировок:', this._config);

        } catch (error) {
            console.error('Ошибка инициализации LockManager:', error);
            throw error;
        }
    }

    /**
     * Загружает настройки блокировок с сервера
     * @private
     */
    static async _loadConfig() {
        try {
            const response = await fetch('/api/v1/system/config/lock');

            if (!response.ok) {
                throw new Error('Не удалось загрузить настройки');
            }

            this._config = await response.json();
            console.log('Настройки блокировок загружены:', this._config);

        } catch (error) {
            console.error('Ошибка загрузки настроек, используем значения по умолчанию:', error);

            this._config = {
                lockDurationMinutes: AppConfig.lock.lockDurationMinutes,
                inactivityTimeoutMinutes: AppConfig.lock.inactivityTimeoutMinutes,
                inactivityCheckIntervalSeconds: AppConfig.lock.inactivityCheckIntervalSeconds,
                minExtensionIntervalMinutes: AppConfig.lock.minExtensionIntervalMinutes,
                inactivityDialogTimeoutSeconds: AppConfig.lock.inactivityDialogTimeoutSeconds
            };
        }
    }

    /**
     * Сброс внутреннего состояния
     * @private
     */
    static _resetState() {
        this._lastActivity = Date.now();
        this._lastExtensionAt = Date.now();
        this._exitPending = null;
    }

    /**
     * Блокирует акт через API
     * @private
     */
    static async _lockAct() {
        const username = AuthManager.getCurrentUser();

        const response = await fetch(`/api/v1/acts/${this._actId}/lock`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-JupyterHub-User': username
            }
        });

        if (response.status === 409) {
            const error = await response.json();
            StorageManager.clearStorage();

            const lockedBy = this._extractUsernameFromError(error.detail);

            await DialogManager.show({
                title: 'Акт редактируется',
                message: AppConfig.lock.messages.actLockedByUser(lockedBy),
                icon: '🔒',
                type: 'warning',
                confirmText: 'Вернуться к списку',
                hideCancel: true,
                allowEscape: false,
                allowOverlayClose: false
            });

            window.location.href = '/';
            throw new Error('ACT_LOCKED');
        }

        if (!response.ok) {
            throw new Error('Не удалось заблокировать акт');
        }

        const data = await response.json();
        console.log('Акт заблокирован до', data.locked_until);
    }

    /**
     * Извлекает username из сообщения об ошибке
     * @private
     */
    static _extractUsernameFromError(errorDetail) {
        const match = errorDetail.match(/пользователем\s+([^\s.]+)/);
        return match ? match[1] : 'другим пользователем';
    }

    /**
     * Продлевает блокировку через API
     * @private
     */
    static async _extendLock() {
        const username = AuthManager.getCurrentUser();

        try {
            const response = await fetch(`/api/v1/acts/${this._actId}/extend-lock`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-JupyterHub-User': username
                }
            });

            if (!response.ok) {
                throw new Error('Не удалось продлить блокировку');
            }

            const data = await response.json();
            console.log('Блокировка продлена до', data.locked_until);

            return true;

        } catch (error) {
            console.error('Ошибка продления блокировки:', error);
            return false;
        }
    }

    /**
     * Продлевает блокировку безопасно
     * @private
     */
    static async _extendLockSafely() {
        try {
            const ok = await this._extendLock();
            if (ok) {
                this._lastExtensionAt = Date.now();
            }
            return ok;
        } catch (e) {
            console.error('Ошибка автопродления блокировки:', e);
            return false;
        }
    }

    /**
     * Настраивает отслеживание активности пользователя
     * @private
     */
    static _setupActivityTracking() {
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];

        const updateActivity = () => {
            this._lastActivity = Date.now();
        };

        events.forEach(event => {
            document.addEventListener(event, updateActivity, {passive: true});
        });
    }

    /**
     * Запускает периодическую проверку бездействия
     * @private
     */
    static _startInactivityCheck() {
        const intervalMs = this._config.inactivityCheckIntervalSeconds * 1000;

        this._inactivityCheckInterval = setInterval(() => {
            const now = Date.now();
            const minutesInactive = (now - this._lastActivity) / 1000 / 60;

            if (minutesInactive >= this._config.inactivityTimeoutMinutes) {
                clearInterval(this._inactivityCheckInterval);
                this._inactivityCheckInterval = null;

                this._handleInactivity(Math.floor(minutesInactive));
            }
        }, intervalMs);
    }

    /**
     * Запускает автоматическое продление блокировки
     * @private
     */
    static _startAutoExtension() {
        const intervalMs = this._config.inactivityCheckIntervalSeconds * 1000;

        this._extensionInterval = setInterval(() => {
            const now = Date.now();
            const minutesSinceActivity = (now - this._lastActivity) / 1000 / 60;
            const minutesSinceExtension = (now - this._lastExtensionAt) / 1000 / 60;

            if (minutesSinceActivity < this._config.inactivityTimeoutMinutes &&
                minutesSinceExtension >= this._config.minExtensionIntervalMinutes) {

                console.log('Пользователь активен, продлеваем блокировку в фоне');
                this._extendLockSafely();
            }
        }, intervalMs);
    }

    /**
     * Обрабатывает ситуацию бездействия
     * @private
     */
    static async _handleInactivity(minutesInactive) {
        const cfg = AppConfig.lock;
        const timeoutSeconds = this._config.inactivityDialogTimeoutSeconds;

        // Запускаем таймер автоматического выхода
        this._inactivityDialogTimeout = setTimeout(() => {
            console.log('Время ожидания истекло, автоматический выход с сохранением');
            this._initiateExit('autoExit');
        }, timeoutSeconds * 1000);

        const stay = await DialogManager.show({
            title: cfg.messages.inactivityTitle,
            message: `${cfg.messages.inactivityQuestion(minutesInactive)}\n\nАвтоматический выход через ${timeoutSeconds} секунд.`,
            icon: '💤',
            type: 'warning',
            confirmText: 'Продолжить работу',
            cancelText: 'Сохранить и выйти',
            allowEscape: true,
            allowOverlayClose: true
        });

        // Отменяем таймер
        if (this._inactivityDialogTimeout) {
            clearTimeout(this._inactivityDialogTimeout);
            this._inactivityDialogTimeout = null;
        }

        if (stay) {
            // Продолжаем работу
            const extended = await this._extendLockSafely();
            this._lastActivity = Date.now();

            if (extended && typeof Notifications !== 'undefined') {
                Notifications.success(cfg.messages.sessionExtended);
            } else if (!extended && typeof Notifications !== 'undefined') {
                Notifications.error(cfg.messages.cannotExtend);
            }

            this._startInactivityCheck();
        } else {
            // Выходим с сохранением
            this._initiateExit('manualExit');
        }
    }

    /**
     * Инициирует выход с сохранением
     * @private
     */
    static _initiateExit(action) {
        // Запоминаем намерение выйти (всегда с сохранением)
        this._exitPending = {
            action: action,
            actId: this._actId,
            shouldSave: true,
            messageFlag: action === 'autoExit' ? 'sessionAutoExited' : 'sessionExitedWithSave'
        };

        // Очищаем таймеры
        this.destroy();

        // Редирект
        window.location.href = '/';
    }

    /**
     * Настраивает обработчик закрытия вкладки
     * @private
     */
    static _setupBeforeUnload() {
        window.addEventListener('beforeunload', () => {
            // Если есть отложенный выход - не снимаем блокировку здесь
            if (this._exitPending) {
                return;
            }

            // Случайное закрытие вкладки - снимаем блокировку
            const blob = new Blob(
                [JSON.stringify({})],
                {type: 'application/json'}
            );

            navigator.sendBeacon(
                `/api/v1/acts/${this._actId}/unlock`,
                blob
            );
        });
    }

    /**
     * Настраивает обработчик pagehide
     * @private
     */
    static _setupPageHide() {
        window.addEventListener('pagehide', () => {
            // Страница РЕАЛЬНО выгружается
            if (this._exitPending) {
                console.log('Страница выгружается, сохраняем команду:', this._exitPending);

                sessionStorage.setItem('lockManager_pendingAction', JSON.stringify(this._exitPending));
                sessionStorage.setItem(this._exitPending.messageFlag, 'true');
            }
        });
    }

    /**
     * Очистка ресурсов
     */
    static destroy() {
        if (this._inactivityCheckInterval) {
            clearInterval(this._inactivityCheckInterval);
            this._inactivityCheckInterval = null;
        }

        if (this._extensionInterval) {
            clearInterval(this._extensionInterval);
            this._extensionInterval = null;
        }

        if (this._inactivityDialogTimeout) {
            clearTimeout(this._inactivityDialogTimeout);
            this._inactivityDialogTimeout = null;
        }
    }

    /**
     * Выполняет отложенные действия после загрузки главной страницы
     */
    static async executePendingActions() {
        const pendingActionJson = sessionStorage.getItem('lockManager_pendingAction');

        console.log('executePendingActions вызван, pendingAction:', pendingActionJson);

        if (!pendingActionJson) {
            console.log('Нет отложенных действий');
            return;
        }

        // Удаляем команду сразу
        sessionStorage.removeItem('lockManager_pendingAction');

        try {
            const pendingAction = JSON.parse(pendingActionJson);
            const {action, actId, shouldSave} = pendingAction;

            console.log('Выполняем отложенное действие:', pendingAction);

            const username = AuthManager.getCurrentUser();
            console.log('Текущий пользователь:', username);

            // Сохраняем если нужно
            if (shouldSave) {
                try {
                    const cachedData = localStorage.getItem(`act_${actId}_content`);

                    if (cachedData) {
                        console.log('Найдены кешированные данные, сохраняем...');

                        const saveResponse = await fetch(`/api/v1/acts/${actId}/content`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-JupyterHub-User': username
                            },
                            body: cachedData
                        });

                        if (saveResponse.ok) {
                            console.log('Данные успешно сохранены');
                        } else {
                            console.error('Ошибка сохранения, статус:', saveResponse.status);
                        }
                    } else {
                        console.log('Кешированные данные не найдены');
                    }
                } catch (e) {
                    console.error('Ошибка сохранения после редиректа:', e);
                }
            }

            // Снимаем блокировку
            console.log('Снимаем блокировку с акта', actId);

            const unlockResponse = await fetch(`/api/v1/acts/${actId}/unlock`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-JupyterHub-User': username
                }
            });

            if (unlockResponse.ok) {
                console.log('Блокировка успешно снята с акта', actId);
            } else {
                const errorText = await unlockResponse.text();
                console.error('Ошибка снятия блокировки, статус:', unlockResponse.status, 'ответ:', errorText);
            }

        } catch (error) {
            console.error('Ошибка выполнения отложенного действия:', error);
        }
    }
}

window.LockManager = LockManager;
