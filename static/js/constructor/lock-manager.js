/**
 * Менеджер блокировок актов
 *
 * Загружает настройки блокировок с сервера, управляет продлением и снятием блокировок.
 * Автоматически завершает сессию при бездействии пользователя.
 * Гарантирует одиночный unlock: предотвращает дублирующее снятие блокировки через sendBeacon.
 */
class LockManager {
    static _actId = null;
    static _config = null;
    static _inactivityCheckInterval = null;
    static _extensionInterval = null;
    static _inactivityDialogTimeout = null;
    static _countdownInterval = null;
    static _lastActivity = Date.now();
    static _lastExtensionAt = Date.now();
    static _warningShown = false;
    static _isExiting = false;
    static _manualUnlockTriggered = false;
    static _beforeUnloadHandler = null;

    /**
     * Инициализирует менеджер для конкретного акта
     * @param {number} actId - ID акта
     */
    static async init(actId) {
        // Проверяем режим только чтения - блокировка не нужна
        if (AppConfig.readOnlyMode?.isReadOnly) {
            console.log('LockManager: Режим только чтения, блокировка не требуется');
            this._actId = actId; // Сохраняем ID для возможного использования
            return;
        }

        this._actId = actId;
        this._resetState();

        try {
            await this._loadConfig();
            await this._lockAct();

            this._setupActivityTracking();
            this._startInactivityCheck();
            this._startAutoExtension();
            this._setupBeforeUnload();

            console.log('LockManager инициализирован для акта', actId);
            console.log('Настройки блокировок:', this._config);
        } catch (error) {
            console.error('Ошибка инициализации LockManager:', error);
            throw error;
        }
    }

    /**
     * Явный метод ручного unlock из внешнего кода.
     * ДЕЛАЕТ:
     *  - отключает beforeunload
     *  - ставит флаг, чтобы sendBeacon не отправлялся
     *  - снимает блокировку на сервере
     *  - останавливает все таймеры
     */
    static async manualUnlock() {
        // Read-only пользователь не имеет блокировки - ничего делать не нужно
        if (AppConfig.readOnlyMode?.isReadOnly) {
            console.log('LockManager.manualUnlock: read-only режим, блокировка не требуется');
            return;
        }

        if (!this._actId) {
            console.warn('LockManager.manualUnlock вызван без активного акта');
            return;
        }

        if (this._isExiting || this._manualUnlockTriggered) {
            console.log('LockManager.manualUnlock: уже выполняется выход/разблокировка');
            return;
        }

        this._manualUnlockTriggered = true;
        this.disableBeforeUnload();
        this.destroy();

        const username = AuthManager?.getCurrentUser?.() || null;
        if (!username) {
            console.warn('LockManager.manualUnlock: пользователь неизвестен — пропускаем unlock');
            return;
        }

        try {
            const resp = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${this._actId}/unlock`), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-JupyterHub-User': username
                }
            });

            if (!resp.ok) {
                console.warn('LockManager.manualUnlock: не удалось снять блокировку, статус', resp.status);
            } else {
                console.log(`[LockManager] Акт ${this._actId} успешно разблокирован вручную`);
            }
        } catch (e) {
            console.error('[LockManager] Ошибка сети при manualUnlock:', e);
        }
    }

    /**
     * Загружает конфигурацию блокировок с сервера
     * @private
     */
    static async _loadConfig() {
        try {
            const response = await fetch(AppConfig.api.getUrl('/api/v1/acts/config/lock'));
            if (!response.ok) throw new Error('Не удалось загрузить настройки');
            this._config = await response.json();
            console.log('Настройки блокировок загружены:', this._config);
        } catch (error) {
            console.error('Ошибка загрузки, используем значения по умолчанию');
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
     * Сбрасывает внутреннее состояние менеджера
     * @private
     */
    static _resetState() {
        this._lastActivity = Date.now();
        this._lastExtensionAt = Date.now();
        this._warningShown = false;
        this._isExiting = false;
        this._manualUnlockTriggered = false;
    }

    /**
     * Выполняет запрос на блокировку акта
     * @private
     */
    static async _lockAct() {
        const username = AuthManager.getCurrentUser();
        const response = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${this._actId}/lock`), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-JupyterHub-User': username
            }
        });

        if (response.status === 409) {
            const error = await response.json();
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

            // Разрешаем навигацию без предупреждения браузера
            if (typeof StorageManager !== 'undefined' && typeof StorageManager.allowUnload === 'function') {
                StorageManager.allowUnload();
            }

            window.location.href = AppConfig.api.getUrl('/acts');
            throw new Error('ACT_LOCKED');
        }

        if (!response.ok) {
            await DialogManager.show({
                title: 'Ошибка блокировки',
                message: AppConfig.lock.messages.lockFailed,
                icon: '⚠️',
                type: 'danger',
                confirmText: 'Вернуться к списку',
                hideCancel: true,
                allowEscape: false,
                allowOverlayClose: false
            });

            if (typeof StorageManager !== 'undefined' && typeof StorageManager.allowUnload === 'function') {
                StorageManager.allowUnload();
            }

            window.location.href = AppConfig.api.getUrl('/acts');
            throw new Error('LOCK_FAILED');
        }

        const data = await response.json();
        console.log('Акт заблокирован до', data.locked_until);
    }

    /**
     * Извлекает имя пользователя из текста ошибки
     * @private
     */
    static _extractUsernameFromError(errorDetail) {
        const match = errorDetail.match(/пользователем\s+([^\s.]+)/);
        return match ? match[1] : 'другим пользователем';
    }

    /**
     * Продлевает блокировку по API
     * @private
     */
    static async _extendLock() {
        const username = AuthManager.getCurrentUser();
        try {
            const response = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${this._actId}/extend-lock`), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-JupyterHub-User': username
                }
            });
            if (!response.ok) throw new Error('Не удалось продлить блокировку');
            const data = await response.json();
            console.log('Блокировка продлена до', data.locked_until);
            return true;
        } catch (error) {
            console.error('Ошибка продления блокировки:', error);
            return false;
        }
    }

    /**
     * Безопасное продление с обработкой ошибок
     * @private
     */
    static async _extendLockSafely() {
        try {
            const ok = await this._extendLock();
            if (ok) this._lastExtensionAt = Date.now();
            return ok;
        } catch (e) {
            console.error('Ошибка автопродления блокировки:', e);
            return false;
        }
    }

    /**
     * Отслеживание активности пользователя.
     * @private
     */
    static _setupActivityTracking() {
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        const updateActivity = () => (this._lastActivity = Date.now());
        events.forEach(event =>
            document.addEventListener(event, updateActivity, {passive: true})
        );
    }

    /**
     * Периодическая проверка бездействия.
     * @private
     */
    static _startInactivityCheck() {
        const intervalMs = this._config.inactivityCheckIntervalSeconds * 1000;
        this._inactivityCheckInterval = setInterval(() => {
            const now = Date.now();
            const minutesIdle = (now - this._lastActivity) / 1000 / 60;
            if (minutesIdle >= this._config.inactivityTimeoutMinutes) {
                clearInterval(this._inactivityCheckInterval);
                this._inactivityCheckInterval = null;
                this._handleInactivity(Math.floor(minutesIdle));
            }
        }, intervalMs);
    }

    /**
     * Автоматическое продление блокировки.
     * @private
     */
    static _startAutoExtension() {
        const intervalMs = this._config.inactivityCheckIntervalSeconds * 1000;
        this._extensionInterval = setInterval(async () => {
            const now = Date.now();
            const sinceActivity = (now - this._lastActivity) / 1000 / 60;
            const sinceExtension = (now - this._lastExtensionAt) / 1000 / 60;
            if (
                sinceActivity < this._config.inactivityTimeoutMinutes &&
                sinceExtension >= this._config.minExtensionIntervalMinutes
            ) {
                console.log('Пользователь активен → продлеваем блокировку');
                const ok = await this._extendLockSafely();
                if (!ok) {
                    console.error('Автопродление не удалось → выход');
                    this._initiateExit('extensionFailed');
                }
            }
        }, intervalMs);
    }

    /**
     * Настраивает beforeunload, который выполняет unlock при закрытии страницы.
     * Если установлен флаг _manualUnlockTriggered, sendBeacon не отправляется.
     * @private
     */
    static _setupBeforeUnload() {
        this._beforeUnloadHandler = () => {
            if (this._isExiting || this._manualUnlockTriggered || !this._actId) return;

            const username = AuthManager.getCurrentUser();
            const blob = new Blob(
                [JSON.stringify({username})],
                {type: 'application/json'}
            );

            navigator.sendBeacon(AppConfig.api.getUrl(`/api/v1/acts/${this._actId}/unlock`), blob);
            console.log('BeforeUnload → отправлен beacon для unlock');
        };
        window.addEventListener('beforeunload', this._beforeUnloadHandler);
    }

    /**
     * Отключает обработчик beforeunload.
     * Используется при ручной разблокировке.
     */
    static disableBeforeUnload() {
        if (this._beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this._beforeUnloadHandler);
            this._beforeUnloadHandler = null;
            console.log('LockManager.beforeunload отключен');
        }
    }

    /**
     * Завершает все интервалы и таймеры.
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
        if (this._countdownInterval) {
            clearInterval(this._countdownInterval);
            this._countdownInterval = null;
        }
    }

    /**
     * Обрабатывает состояние бездействия и вызывает автоматическое завершение.
     * @private
     */
    static async _handleInactivity(minutesInactive) {
        const cfg = AppConfig.lock;
        const timeoutSeconds = this._config.inactivityDialogTimeoutSeconds;

        this._inactivityDialogTimeout = setTimeout(() => {
            console.log('Истекло время подтверждения, автосохранение и выход.');
            this._initiateExit('autoExit');
        }, timeoutSeconds * 1000);

        const dialogPromise = DialogManager.show({
            title: cfg.messages.inactivityTitle,
            message: cfg.messages.inactivityQuestion(minutesInactive),
            icon: '💤',
            type: 'warning',
            confirmText: 'Продолжить',
            cancelText: 'Сохранить и выйти'
        });

        // Добавляем элемент с живым обратным отсчётом
        const overlay = document.querySelector('.custom-dialog-overlay:last-child');
        const messageEl = overlay?.querySelector('.dialog-message');
        let countdownEl = null;
        if (messageEl) {
            countdownEl = document.createElement('p');
            countdownEl.className = 'dialog-message';
            countdownEl.style.marginTop = '4px';
            countdownEl.style.fontWeight = 'bold';
            countdownEl.textContent = `Авто-выход через ${timeoutSeconds} сек.`;
            messageEl.after(countdownEl);
        }

        let remaining = timeoutSeconds;
        this._countdownInterval = setInterval(() => {
            remaining--;
            if (remaining < 0) remaining = 0;
            if (countdownEl) countdownEl.textContent = `Авто-выход через ${remaining} сек.`;
            if (remaining <= 0) clearInterval(this._countdownInterval);
        }, 1000);

        const stay = await dialogPromise;

        if (this._inactivityDialogTimeout) {
            clearTimeout(this._inactivityDialogTimeout);
            this._inactivityDialogTimeout = null;
        }
        if (this._countdownInterval) {
            clearInterval(this._countdownInterval);
            this._countdownInterval = null;
        }

        if (stay) {
            const extended = await this._extendLockSafely();
            if (extended) {
                this._lastActivity = Date.now();
                if (Notifications) Notifications.success(cfg.messages.sessionExtended);
                this._startInactivityCheck();
            } else {
                if (Notifications) Notifications.error(cfg.messages.cannotExtend);
                await this._initiateExit('extensionFailed');
            }
        } else {
            await this._initiateExit('manualExit');
        }
    }

    /**
     * Выполняет корректное завершение сессии и разблокировку акта.
     * @private
     */
    static async _initiateExit(action) {
        if (this._isExiting) return;
        this._isExiting = true;
        this._manualUnlockTriggered = true; // 🚫 блокируем sendBeacon

        this.destroy();
        this.disableBeforeUnload();

        // Разрешаем навигацию без предупреждения браузера
        if (typeof StorageManager !== 'undefined' && typeof StorageManager.allowUnload === 'function') {
            StorageManager.allowUnload();
        }

        const username = AuthManager?.getCurrentUser?.() || null;
        const messageFlag = action === 'autoExit'
            ? 'sessionAutoExited'
            : 'sessionExitedWithSave';

        console.log(`LockManager: выход (${action}) начат…`);

        try {
            // --- 1️⃣ Сохраняем акт ТОЛЬКО если есть AppState (значит открыт в конструкторе) ---
            if (typeof AppState !== 'undefined' && AppState?.exportData) {
                try {
                    const data = AppState.exportData();
                    const saveResp = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${this._actId}/content`), {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-JupyterHub-User': username
                        },
                        body: JSON.stringify(data)
                    });

                    if (!saveResp.ok) {
                        console.error(`[LockManager] Ошибка сохранения контента (код ${saveResp.status})`);
                    } else {
                        console.log('[LockManager] Контент акта сохранён');
                        // Синхронизируем флаг StorageManager после успешного сохранения
                        if (typeof StorageManager !== 'undefined' && typeof StorageManager.markAsSyncedWithDB === 'function') {
                            StorageManager.markAsSyncedWithDB();
                        }
                    }
                } catch (saveErr) {
                    console.error('LockManager: ошибка при сохранении контента конструктора:', saveErr);
                }
            } else {
                console.log('[LockManager] AppState отсутствует — пропускаем сохранение (страница метаданных)');
            }

            // --- 2️⃣ Снимаем блокировку ---
            if (this._actId && username) {
                try {
                    const resp = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${this._actId}/unlock`), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-JupyterHub-User': username
                        }
                    });

                    if (!resp.ok) {
                        console.warn(`[LockManager] Ошибка unlock (код ${resp.status})`);
                    } else {
                        console.log(`[LockManager] Акт ${this._actId} успешно разблокирован (exit)`);
                    }
                } catch (unlockErr) {
                    console.error('[LockManager] Ошибка сети при unlock:', unlockErr);
                }
            }

            sessionStorage.setItem(messageFlag, 'true');
        } catch (err) {
            console.error('[LockManager] Ошибка выхода:', err);
            sessionStorage.setItem(messageFlag, 'true');
        } finally {
            const closedId = this._actId;
            this._actId = null;
            console.log(`LockManager: завершение выхода для акта ${closedId}`);
            setTimeout(() => window.location.href = AppConfig.api.getUrl('/acts'), 300);
        }
    }
}

window.LockManager = LockManager;
