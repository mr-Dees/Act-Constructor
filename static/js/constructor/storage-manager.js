/**
 * Менеджер локального хранилища
 *
 * Управляет сохранением и восстановлением состояния приложения
 * в localStorage с автоматическим дебаунсом и валидацией размера.
 * Интегрирован с системой Proxy для автоматического отслеживания изменений.
 * Отслеживает синхронизацию с БД для предотвращения потери данных.
 */
class StorageManager {
    /**
     * Таймер для дебаунса автосохранения
     * @private
     * @type {number|null}
     */
    static _saveTimeout = null;

    /**
     * Интервал периодического автосохранения в localStorage
     * @private
     * @type {number|null}
     */
    static _periodicSaveInterval = null;

    /**
     * Интервал периодического сохранения в БД
     * @private
     * @type {number|null}
     */
    static _periodicDbSaveInterval = null;

    /**
     * Флаг для отслеживания несохраненных изменений в localStorage
     * @private
     * @type {boolean}
     */
    static _hasUnsavedChanges = false;

    /**
     * Флаг для отслеживания синхронизации с БД
     * @private
     * @type {boolean}
     */
    static _isSyncedWithDB = true;

    /**
     * Флаг блокировки автоматического отслеживания
     * Используется для предотвращения ложных срабатываний Proxy
     * @private
     * @type {boolean}
     */
    static _trackingDisabled = false;

    /**
     * Флаг программного выхода со страницы
     * При установке в true обработчик beforeunload не блокирует навигацию
     * @private
     * @type {boolean}
     */
    static _programmaticExit = false;

    /**
     * Инициализация менеджера хранилища
     *
     * НЕ восстанавливает состояние автоматически.
     * Восстановление выполняется явно через ActsMenuManager.
     */
    static init() {
        try {
            this._checkLocalStorageAvailable();
            this._setupEventHandlers();
            this._updateSaveIndicator();

            console.log('StorageManager инициализирован (без автовосстановления)');
        } catch (error) {
            console.error('Ошибка инициализации StorageManager:', error);
            Notifications.warning('Автосохранение недоступно в этом браузере');
        }
    }

    /**
     * Проверяет доступность localStorage
     * @private
     * @throws {Error} Если localStorage недоступен
     */
    static _checkLocalStorageAvailable() {
        try {
            const testKey = '__storage_test__';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
        } catch (e) {
            throw new Error('localStorage недоступен');
        }
    }

    /**
     * Настраивает обработчики событий для автосохранения
     * @private
     */
    static _setupEventHandlers() {
        // Предупреждение при попытке закрыть страницу с несохраненными данными
        window.addEventListener('beforeunload', (e) => {
            // Сохраняем в localStorage перед закрытием
            if (this._hasUnsavedChanges) {
                this.saveState(true);
            }

            // При программном выходе не показываем диалог браузера
            if (this._programmaticExit) {
                return;
            }

            // Предупреждаем только если данные не синхронизированы с БД
            if (!this._isSyncedWithDB && window.currentActId) {
                e.preventDefault();
                e.returnValue = 'У вас есть несохраненные изменения. Вы уверены, что хотите покинуть страницу?';
                return e.returnValue;
            }
        });

        // Перехват попыток навигации (для показа кастомного диалога)
        this._setupNavigationInterception();

        // Периодическое автосохранение в localStorage (каждые 2 минуты при наличии изменений)
        this._periodicSaveInterval = setInterval(() => {
            if (this._hasUnsavedChanges) {
                this.saveState(true);
            }
        }, AppConfig.localStorage.periodicSaveInterval);

        // Периодическое сохранение в БД (каждые 2 минуты при наличии несинхронизированных данных)
        this._periodicDbSaveInterval = setInterval(async () => {
            if (this.hasUnsyncedChanges() && window.currentActId) {
                try {
                    await APIClient.saveActContent(window.currentActId, { saveType: 'periodic' });
                } catch (err) {
                    console.error('Периодическое сохранение в БД не удалось:', err);
                }
            }
        }, AppConfig.localStorage.periodicSaveInterval);
    }

    /**
     * Настраивает перехват попыток навигации.
     * Покрывает:
     *  - клик по `<a href>` (внутренние ссылки) — кастомный диалог;
     *  - back/forward (popstate) — кастомный диалог с восстановлением истории;
     *  - закрытие вкладки/прямой URL-ввод — браузерный beforeunload (см. _setupEventHandlers).
     * Программное `window.location.href = ...` всё равно отлавливается beforeunload —
     * перехватить set'тер location напрямую браузер не даёт.
     * @private
     */
    static _setupNavigationInterception() {
        // Флаг разрешения навигации (для программных переходов)
        window._allowNavigation = false;

        // popstate-страж: при back/forward с unsynced правками показываем
        // кастомный confirm. Если юзер подтверждает уход — пускаем; иначе
        // pushState восстанавливает URL.
        history.replaceState({_lockNavGuard: true}, '', window.location.href);
        window.addEventListener('popstate', async (event) => {
            if (window._allowNavigation) return;
            if (!this.hasUnsyncedChanges()) return;

            // Возвращаем URL обратно, чтобы юзер физически не ушёл со страницы,
            // пока думает над диалогом.
            history.pushState({_lockNavGuard: true}, '', window.location.href);

            const confirmed = await DialogManager.show({
                title: 'Несохраненные изменения',
                message: 'У вас есть несохранённые изменения. Вернуться к предыдущей странице без сохранения?',
                icon: '⚠️',
                confirmText: 'Уйти без сохранения',
                cancelText: 'Остаться'
            });
            if (confirmed) {
                window._allowNavigation = true;
                history.back();
            }
        });

        // Перехватываем клики по ссылкам
        document.addEventListener('click', async (e) => {
            // Игнорируем если навигация разрешена
            if (window._allowNavigation) return;

            const link = e.target.closest('a[href]');

            // Игнорируем если это не ссылка или если href пустой/якорь
            if (!link || !link.href || link.href.startsWith('#') || link.href.startsWith('javascript:')) {
                return;
            }

            // Игнорируем внешние ссылки и ссылки с target="_blank"
            if (link.target === '_blank' || link.hostname !== window.location.hostname) {
                return;
            }

            // Проверяем наличие несохраненных изменений
            if (this.hasUnsyncedChanges()) {
                e.preventDefault();

                const confirmed = await DialogManager.show({
                    title: 'Несохраненные изменения',
                    message: 'У вас есть несохраненные изменения. Если вы продолжите, они будут утеряны. Сохранить изменения в базу данных?',
                    icon: '⚠️',
                    confirmText: 'Сохранить и продолжить',
                    cancelText: 'Не сохранять'
                });

                if (confirmed) {
                    try {
                        // Синхронизируем и сохраняем
                        if (typeof ItemsRenderer !== 'undefined') {
                            ItemsRenderer.syncDataToState();
                        }

                        await APIClient.saveActContent(window.currentActId, { saveType: 'manual' });
                        Notifications.success('Изменения сохранены');
                    } catch (err) {
                        console.error('Ошибка сохранения:', err);
                        Notifications.error('Не удалось сохранить изменения');

                        const continueAnyway = await DialogManager.show({
                            title: 'Ошибка сохранения',
                            message: 'Не удалось сохранить изменения. Продолжить без сохранения?',
                            icon: '❌',
                            confirmText: 'Продолжить',
                            cancelText: 'Отмена'
                        });

                        if (!continueAnyway) {
                            return;
                        }
                    }
                }

                // Разрешаем навигацию и переходим по ссылке
                window._allowNavigation = true;
                window.location.href = link.href;
            }
        });
    }

    /**
     * Помечает состояние как измененное и запускает дебаунс сохранения
     *
     * Автоматически вызывается через Proxy при изменении AppState.
     * Игнорируется если отслеживание временно отключено.
     */
    static markAsUnsaved() {
        // Игнорируем если отслеживание отключено
        if (this._trackingDisabled) {
            return;
        }

        // Устанавливаем оба флага одновременно
        this._hasUnsavedChanges = true;
        this._isSyncedWithDB = false;

        // Обновляем индикатор
        this._updateSaveIndicator();

        // Запускаем дебаунс автосохранения
        this._debouncedSave();
    }

    /**
     * Помечает состояние как сохраненное в localStorage
     * @private
     */
    static _markAsSaved() {
        // Сбрасываем только флаг несохраненных изменений
        // Флаг синхронизации с БД остается как есть
        this._hasUnsavedChanges = false;
        this._updateSaveIndicator();
    }

    /**
     * Помечает состояние как синхронизированное с БД
     */
    static markAsSyncedWithDB() {
        // При синхронизации с БД оба флага сбрасываются
        this._hasUnsavedChanges = false;
        this._isSyncedWithDB = true;
        this._updateSaveIndicator();
    }

    /**
     * Отложенное сохранение с дебаунсом
     * @private
     */
    static _debouncedSave() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }

        this._saveTimeout = setTimeout(() => {
            this.saveState(true);
        }, AppConfig.localStorage.autoSaveDebounce);
    }

    /**
     * Сохраняет текущее состояние в localStorage
     *
     * @param {boolean} [silent=false] - Не показывать уведомление о сохранении
     * @returns {boolean} true если сохранение успешно
     */
    static saveState(silent = false) {
        try {
            const stateToSave = this._prepareStateForSaving();
            const stateJson = JSON.stringify(stateToSave);

            // Проверка размера данных
            if (stateJson.length > AppConfig.localStorage.maxStorageSize) {
                console.warn('Размер данных превышает лимит localStorage');
                Notifications.warning('Недостаточно места для сохранения. Попробуйте упростить структуру акта.');
                return false;
            }

            // Сохранение данных
            localStorage.setItem(AppConfig.localStorage.stateKey, stateJson);

            // Сохранение временной метки
            const timestamp = new Date().toISOString();
            localStorage.setItem(AppConfig.localStorage.timestampKey, timestamp);

            // 🔧При сохранении в localStorage меняем ТОЛЬКО флаг несохраненных изменений
            // Флаг синхронизации с БД НЕ трогаем
            this._markAsSaved();

            if (!silent) {
                console.log('Состояние сохранено в localStorage');
            }

            return true;

        } catch (error) {
            console.error('Ошибка сохранения в localStorage:', error);

            if (error.name === 'QuotaExceededError') {
                Notifications.error('Недостаточно места для сохранения. Попробуйте упростить структуру акта.');
            } else {
                Notifications.error('Ошибка сохранения данных');
            }

            return false;
        }
    }

    /**
     * Подготавливает состояние для сохранения
     * @private
     * @returns {Object} Подготовленное состояние
     */
    static _prepareStateForSaving() {
        return {
            actId: window.currentActId || null,
            tree: AppState.treeData,
            tables: AppState.tables,
            textBlocks: AppState.textBlocks,
            violations: AppState.violations,
            tableUISizes: AppState.tableUISizes,
            currentStep: AppState.currentStep,
            selectedNodeId: AppState.selectedNode?.id || null,
            selectedFormats: this._getSelectedFormats(),
            version: '1.0.0',
            savedAt: new Date().toISOString()
        };
    }

    /**
     * Получает текущие выбранные форматы из UI
     * @private
     * @returns {string[]} Массив выбранных форматов
     */
    static _getSelectedFormats() {
        const formatCheckboxes = document.querySelectorAll('.format-option input[type="checkbox"]');
        const selectedFormats = [];

        formatCheckboxes.forEach(checkbox => {
            if (checkbox.checked) {
                selectedFormats.push(checkbox.value);
            }
        });

        return selectedFormats;
    }

    /**
     * Принудительно сохраняет состояние (вызывается кнопкой или Ctrl+S)
     *
     * @returns {boolean} true если сохранение успешно
     */
    static forceSave() {
        // Блокируем сохранение в режиме только чтения
        if (AppConfig.readOnlyMode?.isReadOnly) {
            Notifications.warning(AppConfig.readOnlyMode.messages.cannotSave);
            return false;
        }

        // Отменяем pending дебаунс, если есть
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
        }

        // Выполняем сохранение (silent режим)
        const success = this.saveState(true);

        if (success) {
            Notifications.success('Изменения сохранены');
        } else {
            // Если сохранение не удалось, возвращаем флаг
            this._hasUnsavedChanges = true;
            this._updateSaveIndicator();
        }

        return success;
    }

    /**
     * Асинхронная версия принудительного сохранения
     *
     * Блокирует отслеживание изменений на время выполнения операции.
     * Используется когда нужна гарантия последовательного выполнения.
     *
     * @returns {Promise<boolean>} Promise с результатом сохранения
     */
    static async forceSaveAsync() {
        return new Promise((resolve) => {
            // Блокируем отслеживание на время сохранения и последующих операций
            this._trackingDisabled = true;

            requestAnimationFrame(() => {
                const result = this.forceSave();

                // Небольшая задержка для завершения всех операций
                setTimeout(() => {
                    // Разблокируем отслеживание
                    this._trackingDisabled = false;
                    resolve(result);
                }, 100);
            });
        });
    }

    /**
     * Временно отключает отслеживание изменений
     *
     * Используется для операций, которые модифицируют состояние,
     * но не должны помечать его как несохраненное.
     */
    static disableTracking() {
        this._trackingDisabled = true;
    }

    /**
     * Включает отслеживание изменений обратно
     */
    static enableTracking() {
        this._trackingDisabled = false;
    }

    /**
     * Разрешает покинуть страницу без предупреждения браузера.
     * Вызывается при программном выходе (автовыход по неактивности,
     * кнопка выхода, акт заблокирован другим пользователем).
     */
    static allowUnload() {
        this._programmaticExit = true;
    }

    /**
     * Выполняет функцию без отслеживания изменений
     *
     * @param {Function} fn - Функция для выполнения
     * @returns {*} Результат выполнения функции
     */
    static withoutTracking(fn) {
        this._trackingDisabled = true;
        try {
            return fn();
        } finally {
            this._trackingDisabled = false;
        }
    }

    /**
     * Проверяет наличие несохраненных в БД изменений
     * @returns {boolean} true если данные не синхронизированы с БД
     */
    static hasUnsyncedChanges() {
        return !this._isSyncedWithDB && window.currentActId !== null;
    }

    /**
     * Очищает сохраненное состояние из localStorage
     */
    static clearStorage() {
        try {
            localStorage.removeItem(AppConfig.localStorage.stateKey);
            localStorage.removeItem(AppConfig.localStorage.timestampKey);

            // При очистке сбрасываем оба флага
            this._hasUnsavedChanges = false;
            this._isSyncedWithDB = true;

            this._updateSaveIndicator();
            console.log('localStorage очищен');
        } catch (error) {
            console.error('Ошибка очистки localStorage:', error);
        }
    }

    /**
     * Внутренняя очистка без логов (для использования в catch блоках)
     * @private
     */
    static _clearStorage() {
        try {
            localStorage.removeItem(AppConfig.localStorage.stateKey);
            localStorage.removeItem(AppConfig.localStorage.timestampKey);
        } catch (error) {
            console.error('Ошибка очистки localStorage:', error);
        }
    }

    /**
     * Получает временную метку последнего сохранения
     * @returns {string|null} ISO строка времени или null
     */
    static getLastSaveTimestamp() {
        return localStorage.getItem(AppConfig.localStorage.timestampKey);
    }

    /**
     * Обновляет индикатор сохранности в UI
     * Три состояния:
     * - saved (белый): сохранено в localStorage И БД
     * - local-only (желтый): сохранено только в localStorage
     * - unsaved (красный): не сохранено нигде
     * @private
     */
    static _updateSaveIndicator() {
        const button = document.getElementById('saveIndicatorBtn');
        const label = document.getElementById('saveIndicatorLabel');

        if (!button || !label) return;

        // Удаляем все классы состояний
        button.classList.remove('saved', 'local-only', 'unsaved');

        // Упрощенная и более понятная логика
        if (this._hasUnsavedChanges) {
            // Красный: есть изменения, которые не сохранены даже в localStorage
            button.classList.add('unsaved');
            button.disabled = false;
            button.title = 'Сохранить изменения (Ctrl+S)';
            label.textContent = 'Не сохранено';
        } else if (!this._isSyncedWithDB && window.currentActId) {
            // Желтый: сохранено в localStorage, но не в БД
            button.classList.add('local-only');
            button.disabled = false;
            button.title = 'Сохранить в базу данных (Ctrl+S)';
            label.textContent = 'Только локально';
        } else {
            // Белый: полностью синхронизировано
            button.classList.add('saved');
            button.disabled = true;
            button.title = 'Все изменения сохранены';
            label.textContent = 'Сохранено';
        }

        // Дополнительный лог для отладки
        console.log('Индикатор обновлен:', {
            hasUnsavedChanges: this._hasUnsavedChanges,
            isSyncedWithDB: this._isSyncedWithDB,
            state: button.classList.contains('unsaved') ? 'unsaved' :
                button.classList.contains('local-only') ? 'local-only' : 'saved'
        });
    }

    /**
     * Проверяет, есть ли несохраненные изменения
     * @returns {boolean} true если есть несохраненные изменения
     */
    static hasUnsavedChanges() {
        return this._hasUnsavedChanges;
    }

    /**
     * Очищает все таймеры при уничтожении
     */
    static destroy() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
        }

        if (this._periodicSaveInterval) {
            clearInterval(this._periodicSaveInterval);
            this._periodicSaveInterval = null;
        }

        if (this._periodicDbSaveInterval) {
            clearInterval(this._periodicDbSaveInterval);
            this._periodicDbSaveInterval = null;
        }
    }

    /**
     * Инвалидирует кеш актов (для вызова после изменений)
     */
    static invalidateActsCache() {
        if (window.ActsManagerPage && typeof window.ActsManagerPage.invalidateCache === 'function') {
            window.ActsManagerPage.invalidateCache();
        }
    }
}
