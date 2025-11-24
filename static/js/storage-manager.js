/**
 * Менеджер локального хранилища
 *
 * Управляет сохранением и восстановлением состояния приложения
 * в localStorage с автоматическим дебаунсом и валидацией размера.
 * Интегрирован с системой Proxy для автоматического отслеживания изменений.
 */
class StorageManager {
    /**
     * Таймер для дебаунса автосохранения
     * @private
     * @type {number|null}
     */
    static _saveTimeout = null;

    /**
     * Интервал периодического автосохранения
     * @private
     * @type {number|null}
     */
    static _periodicSaveInterval = null;

    /**
     * Флаг для отслеживания несохраненных изменений
     * @private
     * @type {boolean}
     */
    static _hasUnsavedChanges = false;

    /**
     * Флаг блокировки автоматического отслеживания
     * Используется для предотвращения ложных срабатываний Proxy
     * @private
     * @type {boolean}
     */
    static _trackingDisabled = false;

    /**
     * Инициализация менеджера хранилища
     *
     * Восстанавливает сохраненное состояние при загрузке приложения
     * и настраивает обработчики событий.
     */
    static init() {
        try {
            this._checkLocalStorageAvailable();
            this._setupEventHandlers();
            this._updateSaveIndicator();
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
     * Восстанавливает сохраненное состояние из localStorage
     * Теперь это публичный метод, вызываемый явно
     */
    static restoreSavedState() {
        const savedState = this._loadState();

        if (!savedState) {
            console.log('Нет сохраненного состояния для восстановления');
            return false;
        }

        try {
            // Отключаем отслеживание на время восстановления
            this._trackingDisabled = true;

            // Восстанавливаем данные в AppState
            AppState.treeData = savedState.tree;
            AppState.tables = savedState.tables || {};
            AppState.textBlocks = savedState.textBlocks || {};
            AppState.violations = savedState.violations || {};
            AppState.tableUISizes = savedState.tableUISizes || {};

            // Восстанавливаем текущий шаг БЕЗ вызова App.goToStep
            const savedStep = savedState.currentStep || 1;
            AppState.currentStep = savedStep;

            // Восстанавливаем выбранный узел
            if (savedState.selectedNodeId) {
                AppState.selectedNode = AppState.findNodeById(savedState.selectedNodeId);
            } else {
                AppState.selectedNode = null;
            }

            // Восстанавливаем форматы сохранения
            if (savedState.selectedFormats) {
                setTimeout(() => {
                    this._restoreSelectedFormats(savedState.selectedFormats);
                }, 100);
            }

            // Перегенерируем нумерацию для консистентности
            AppState.generateNumbering();

            // Обновляем UI шагов в заголовке
            this._updateStepUI(savedStep);

            // Включаем отслеживание обратно
            this._trackingDisabled = false;

            console.log('Состояние успешно восстановлено из localStorage');
            Notifications.info(AppConfig.localStorage.messages.restored);

            this._markAsSaved();
            return true;

        } catch (error) {
            this._trackingDisabled = false;
            console.error('Ошибка восстановления состояния:', error);
            Notifications.error('Не удалось восстановить сохраненное состояние');
            this._clearStorage();
            return false;
        }
    }

    /**
     * Восстанавливает сохраненное состояние из localStorage
     * @private
     */
    static _restoreSavedState() {
        const savedState = this._loadState();

        if (!savedState) {
            console.log('Нет сохраненного состояния для восстановления');
            return;
        }

        try {
            // Отключаем отслеживание на время восстановления
            this._trackingDisabled = true;

            // Восстанавливаем данные в AppState
            AppState.treeData = savedState.tree;
            AppState.tables = savedState.tables || {};
            AppState.textBlocks = savedState.textBlocks || {};
            AppState.violations = savedState.violations || {};
            AppState.tableUISizes = savedState.tableUISizes || {};

            // Восстанавливаем текущий шаг БЕЗ вызова App.goToStep
            const savedStep = savedState.currentStep || 1;
            AppState.currentStep = savedStep;

            // Восстанавливаем выбранный узел
            if (savedState.selectedNodeId) {
                AppState.selectedNode = AppState.findNodeById(savedState.selectedNodeId);
            } else {
                AppState.selectedNode = null;
            }

            // Восстанавливаем форматы сохранения
            if (savedState.selectedFormats) {
                setTimeout(() => {
                    this._restoreSelectedFormats(savedState.selectedFormats);
                }, 100);
            }

            // Перегенерируем нумерацию для консистентности
            AppState.generateNumbering();

            // Перерендерим дерево для восстановления обработчиков событий
            if (typeof treeManager !== 'undefined' && treeManager.render) {
                treeManager.render();

                // Восстанавливаем выделение узла в UI
                if (savedState.selectedNodeId) {
                    this._restoreSelectedNodeUI(savedState.selectedNodeId);
                }
            }

            // Обновляем UI шагов в заголовке
            this._updateStepUI(savedStep);

            // Включаем отслеживание обратно
            this._trackingDisabled = false;

            console.log('Состояние успешно восстановлено из localStorage');
            Notifications.info(AppConfig.localStorage.messages.restored);

            this._markAsSaved();
        } catch (error) {
            this._trackingDisabled = false;
            console.error('Ошибка восстановления состояния:', error);
            Notifications.error('Не удалось восстановить сохраненное состояние');
            this._clearStorage();
        }
    }

    /**
     * Загружает состояние из localStorage
     * @private
     * @returns {Object|null} Сохраненное состояние или null
     */
    static _loadState() {
        try {
            const stateJson = localStorage.getItem(AppConfig.localStorage.stateKey);

            if (!stateJson) return null;

            return JSON.parse(stateJson);
        } catch (error) {
            console.error('Ошибка чтения из localStorage:', error);
            return null;
        }
    }

    /**
     * Восстанавливает выделение узла в UI дерева
     * @private
     * @param {string} nodeId - ID узла для выделения
     */
    static _restoreSelectedNodeUI(nodeId) {
        setTimeout(() => {
            const nodeElement = treeManager.container.querySelector(`[data-node-id="${nodeId}"]`);
            if (nodeElement && treeManager.selectNode) {
                treeManager.selectNode(nodeElement);
            }
        }, 50);
    }

    /**
     * Обновляет UI индикаторов шагов в заголовке
     * @private
     * @param {number} stepNum - Номер активного шага
     */
    static _updateStepUI(stepNum) {
        // Обновляем классы активности для индикаторов шагов
        document.querySelectorAll('.step').forEach(step => {
            const isActive = parseInt(step.dataset.step) === stepNum;
            step.classList.toggle('active', isActive);
            step.setAttribute('aria-selected', isActive.toString());
        });

        // Показываем/скрываем контент шагов
        document.querySelectorAll('.step-content').forEach(content => {
            content.classList.add('hidden');
        });

        const currentContent = document.getElementById(`step${stepNum}`);
        currentContent?.classList.remove('hidden');

        // Обрабатываем специфичную логику шага 2
        if (stepNum === 2) {
            setTimeout(() => {
                if (typeof textBlockManager !== 'undefined' && textBlockManager.initGlobalToolbar) {
                    textBlockManager.initGlobalToolbar();
                }
                if (typeof ItemsRenderer !== 'undefined' && ItemsRenderer.renderAll) {
                    ItemsRenderer.renderAll();
                }
            }, 100);
        }
    }

    /**
     * Настраивает обработчики событий для автосохранения
     * @private
     */
    static _setupEventHandlers() {
        // Сохранение при переходе на другую вкладку/закрытии
        window.addEventListener('beforeunload', () => {
            if (this._hasUnsavedChanges) {
                this.saveState(true);
            }
        });

        // Периодическое автосохранение (каждые 2 минуты при наличии изменений)
        this._periodicSaveInterval = setInterval(() => {
            if (this._hasUnsavedChanges) {
                this.saveState(true);
            }
        }, AppConfig.localStorage.periodicSaveInterval);
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

        this._hasUnsavedChanges = true;
        this._updateSaveIndicator();

        // Запускаем дебаунс автосохранения
        this._debouncedSave();
    }

    /**
     * Помечает состояние как сохраненное
     * @private
     */
    static _markAsSaved() {
        this._hasUnsavedChanges = false;
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
                Notifications.warning(AppConfig.localStorage.messages.storageFull);
                return false;
            }

            // Сохранение данных
            localStorage.setItem(AppConfig.localStorage.stateKey, stateJson);

            // Сохранение временной метки
            const timestamp = new Date().toISOString();
            localStorage.setItem(AppConfig.localStorage.timestampKey, timestamp);

            this._markAsSaved();

            if (!silent) {
                console.log('Состояние сохранено в localStorage');
            }

            return true;

        } catch (error) {
            console.error('Ошибка сохранения в localStorage:', error);

            if (error.name === 'QuotaExceededError') {
                Notifications.error(AppConfig.localStorage.messages.storageFull);
            } else {
                Notifications.error(AppConfig.localStorage.messages.storageError);
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
     * Восстанавливает выбранные форматы в UI
     * @private
     * @param {string[]} formats - Массив форматов для восстановления
     */
    static _restoreSelectedFormats(formats) {
        if (!formats || !Array.isArray(formats)) return;

        const formatCheckboxes = document.querySelectorAll('.format-option input[type="checkbox"]');

        formatCheckboxes.forEach(checkbox => {
            checkbox.checked = formats.includes(checkbox.value);
        });

        // Обновляем индикатор количества форматов на кнопке
        if (typeof FormatMenuManager !== 'undefined' && FormatMenuManager.updateFormatCount) {
            FormatMenuManager.updateFormatCount();
        }
    }

    /**
     * Принудительно сохраняет состояние (вызывается кнопкой или Ctrl+S)
     *
     * @returns {boolean} true если сохранение успешно
     */
    static forceSave() {
        // Отменяем pending дебаунс, если есть
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
        }

        // Немедленно помечаем как сохраненное
        this._hasUnsavedChanges = false;
        this._updateSaveIndicator();

        // Выполняем сохранение (silent режим)
        const success = this.saveState(true);

        if (success) {
            Notifications.success(AppConfig.localStorage.messages.saved);
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
     * Очищает сохраненное состояние из localStorage
     */
    static clearStorage() {
        try {
            localStorage.removeItem(AppConfig.localStorage.stateKey);
            localStorage.removeItem(AppConfig.localStorage.timestampKey);
            this._markAsSaved();
            Notifications.info('Сохраненное состояние удалено');
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
     * @private
     */
    static _updateSaveIndicator() {
        const button = document.getElementById('saveIndicatorBtn');
        const label = document.getElementById('saveIndicatorLabel');

        if (!button || !label) return;

        if (this._hasUnsavedChanges) {
            button.classList.add('unsaved');
            button.classList.remove('saved');
            button.disabled = false;
            button.title = 'Сохранить изменения (Ctrl+S)';
            label.textContent = 'Не сохранено';
        } else {
            button.classList.add('saved');
            button.classList.remove('unsaved');
            button.disabled = true;
            button.title = 'Все изменения сохранены';
            label.textContent = 'Сохранено';
        }
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
    }
}
