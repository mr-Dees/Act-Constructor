/**
 * Менеджер локального хранилища
 *
 * Управляет сохранением и восстановлением состояния приложения
 * в localStorage с автоматическим дебаунсом и валидацией размера.
 * Интегрирован с системой Proxy для автоматического отслеживания изменений.
 * Отслеживает синхронизацию с БД для предотвращения потери данных.
 */
import { ItemsRenderer } from './items/items-renderer.js';
import { LifecycleHelper } from './lifecycle-helper.js';
import { AppState } from './state/state-core.js';
// ActsManagerPage не импортируется: constructor → portal — неправильное направление
// зон. Используем lazy через window.ActsManagerPage (см. invalidateCache-вызов ниже).
import { APIClient } from '../shared/api.js';
import { AppConfig } from '../shared/app-config.js';
import { DialogManager } from '../shared/dialog/dialog-confirm.js';
import { Notifications } from '../shared/notifications.js';

export class StorageManager {
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
     * Единое состояние persistence-индикатора.
     * Возможные значения:
     *  - 'saved'      — синхронизировано с localStorage И БД (белый);
     *  - 'local-only' — сохранено только в localStorage, не в БД (жёлтый);
     *  - 'unsaved'    — есть изменения, ещё не сохранённые даже локально (красный).
     *
     * Старые булевы флаги (_hasUnsavedChanges, _isSyncedWithDB) остаются как
     * computed-зеркала через _setState — массивы load-bearing consumer'ов
     * (beforeunload, периодические таймеры, hasUnsavedChanges()) продолжают
     * работать без массовой замены проверок.
     * @private
     * @type {'saved'|'local-only'|'unsaved'}
     */
    static _state = 'saved';

    /**
     * Флаг для отслеживания несохраненных изменений в localStorage
     * (зеркало _state === 'unsaved'). Управляется через _setState.
     * @private
     * @type {boolean}
     */
    static _hasUnsavedChanges = false;

    /**
     * Флаг для отслеживания синхронизации с БД
     * (зеркало _state === 'saved'). Управляется через _setState.
     * @private
     * @type {boolean}
     */
    static _isSyncedWithDB = true;

    /**
     * Счётчик глубины блокировки автоматического отслеживания (M.11).
     * disableTracking() инкрементирует, enableTracking() декрементирует
     * (с полом 0); отслеживание выключено, пока счётчик > 0. Счётчик (а не
     * boolean) нужен, чтобы вложенные/перекрывающиеся пары disable/enable
     * композировались, а не затирали друг друга.
     * @private
     * @type {number}
     */
    static _trackingDepth = 0;

    /**
     * Серверный updated_at акта на момент последней успешной синхронизации
     * с БД (из ответа GET-контента или PUT-сохранения). Пишется в метаданные
     * снимка localStorage (baseUpdatedAt) и используется решением о
     * восстановлении черновика (H3): восстановление предлагается только
     * если акт с момента снимка никто не менял.
     * @private
     * @type {string|null}
     */
    static _baseUpdatedAt = null;

    /**
     * Флаг «о сбое сохранения в БД уже предупреждали» (§9 offline).
     * Не даёт спамить предупреждением на каждый периодический тик;
     * сбрасывается при первой успешной синхронизации (markAsSyncedWithDB).
     * @private
     * @type {boolean}
     */
    static _dbSaveFailureNotified = false;

    /**
     * Обработчик window 'online' для немедленного повторного сохранения
     * в БД после восстановления соединения. null = не подписан.
     * @private
     * @type {Function|null}
     */
    static _onlineRetryHandler = null;

    /**
     * Флаг программного выхода со страницы
     * При установке в true обработчик beforeunload не блокирует навигацию
     * @private
     * @type {boolean}
     */
    static _programmaticExit = false;

    /**
     * Сохранённый обработчик document 'click' (перехват навигации по ссылкам).
     * Храним, чтобы снять его в _teardownEventHandlers (pfe-10/12). null = не подписан.
     * @private
     * @type {Function|null}
     */
    static _navClickHandler = null;

    /**
     * Сохранённый обработчик window 'popstate' (перехват back/forward).
     * Храним, чтобы снять его в _teardownEventHandlers (pfe-10/12). null = не подписан.
     * @private
     * @type {Function|null}
     */
    static _navPopstateHandler = null;

    /**
     * Lock «идёт сохранение снимка» (pfe-3). Взводится на время saveState и
     * сбрасывается в finally. Не даёт периодическому и явному save пересечься
     * на одном снимке (re-entrant вызов пропускается).
     * @private
     * @type {boolean}
     */
    static _saveInProgress = false;

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
        // pfe-12: повторный init должен быть идемпотентным — гасим прежние
        // интервалы и навигационные слушатели ДО создания новых, иначе
        // накапливаются двойные таймеры и PUT-каналы.
        this._teardownEventHandlers();

        // Предупреждение при попытке закрыть страницу с несохраненными данными.
        // Регистрируется через общий реестр beforeunload-обработчиков LifecycleHelper,
        // чтобы можно было централизованно снять обработчик при destroy/teardown.
        const beforeUnloadHandler = (e) => {
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
        };
        if (typeof LifecycleHelper !== 'undefined') {
            LifecycleHelper.registerBeforeUnload('storage:unsaved-warning', beforeUnloadHandler);
        } else {
            window.addEventListener('beforeunload', beforeUnloadHandler);
        }

        // Перехват попыток навигации (для показа кастомного диалога)
        this._setupNavigationInterception();

        // Периодическое автосохранение в localStorage (каждые 2 минуты при наличии изменений)
        // E-6: пропускаем тик, если идёт drag-and-drop — иначе сохраним промежуточное
        // состояние treeData во время mutation, в которой parent.children в неконсистентном виде.
        // Через периодический интервал следующий тик подберёт изменения.
        this._periodicSaveInterval = setInterval(() => {
            if (AppState._dragInProgress) return;
            if (this._hasUnsavedChanges) {
                this.saveState(true);
            }
        }, AppConfig.localStorage.periodicSaveInterval);

        // Периодическое сохранение в БД (каждые 2 минуты при наличии несинхронизированных данных)
        // E-6: та же защита от race с drag'ом.
        //
        // E2 (by-design): авто/периодическое сохранение НЕ запускает контентную
        // валидацию (пустые заголовки/нет данных/нет шапки). Это сознательно —
        // черновик обязан сохраняться всегда, а каскад метрик/рисков легитимно
        // создаёт пустые сводные таблицы, которые контентная проверка пометила
        // бы как неполные. Контентная валидация — только перед ЭКСПОРТОМ
        // (navigation-manager). Структурная целостность остаётся защищённой
        // сервером (HTTP 422) на каждом PUT /content независимо от saveType.
        this._periodicDbSaveInterval = setInterval(async () => {
            if (AppState._dragInProgress) return;
            if (this.hasUnsyncedChanges() && window.currentActId) {
                try {
                    await APIClient.saveActContent(window.currentActId, { saveType: 'periodic' });
                } catch (err) {
                    // §9 offline: ошибку не глотаем — предупреждаем (один раз
                    // до успеха) и подписываемся на восстановление соединения.
                    console.error('Периодическое сохранение в БД не удалось:', err);
                    this._notifyDbSaveFailure();
                }
            }
        }, AppConfig.localStorage.periodicSaveInterval);
    }

    /**
     * Обрабатывает сбой фонового сохранения в БД (§9 offline).
     *
     * Показывает предупреждение один раз (без спама на каждый периодический
     * тик; повторное предупреждение возможно только после успешной
     * синхронизации) и подписывается на window 'online' для немедленного
     * повторного сохранения при восстановлении соединения.
     * @private
     */
    static _notifyDbSaveFailure() {
        if (!this._dbSaveFailureNotified) {
            this._dbSaveFailureNotified = true;
            Notifications.warning(
                'Не удалось сохранить изменения в базу данных. ' +
                'Правки сохранены локально; повторная попытка — автоматически.'
            );
        }
        if (!this._onlineRetryHandler) {
            this._onlineRetryHandler = () => {
                this._retryDbSave();
            };
            window.addEventListener('online', this._onlineRetryHandler);
        }
    }

    /**
     * Немедленный повторный save в БД после восстановления соединения.
     * При новой неудаче уведомление не дублируется (_dbSaveFailureNotified
     * ещё взведён), подписка на 'online' сохраняется до успеха.
     * @private
     */
    static async _retryDbSave() {
        if (AppState._dragInProgress) return;
        if (!this.hasUnsyncedChanges() || !window.currentActId) return;
        try {
            await APIClient.saveActContent(window.currentActId, { saveType: 'periodic' });
        } catch (err) {
            console.error('Повторное сохранение после восстановления сети не удалось:', err);
        }
    }

    /**
     * Снимает подписку на 'online' и сбрасывает флаг показанного
     * предупреждения о сбое сохранения в БД.
     * @private
     */
    static _resetDbSaveFailureState() {
        this._dbSaveFailureNotified = false;
        if (this._onlineRetryHandler) {
            window.removeEventListener('online', this._onlineRetryHandler);
            this._onlineRetryHandler = null;
        }
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
        // Хендлеры храним в полях (стрелки сохраняют this=класс), чтобы снять
        // их в _teardownEventHandlers (pfe-10/12).
        history.replaceState({_lockNavGuard: true}, '', window.location.href);
        this._navPopstateHandler = async (event) => {
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
        };
        window.addEventListener('popstate', this._navPopstateHandler);

        // Перехватываем клики по ссылкам
        this._navClickHandler = async (e) => {
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
        };
        document.addEventListener('click', this._navClickHandler);
    }

    /**
     * Снимает все слушатели и гасит таймеры StorageManager (pfe-10/12).
     *
     * Идемпотентно: безопасно вызывать повторно (поля занулены, unregister/
     * removeEventListener — no-op для отсутствующих). Используется и при
     * повторном init (_setupEventHandlers), и при destroy.
     * @private
     */
    static _teardownEventHandlers() {
        if (this._periodicSaveInterval) {
            clearInterval(this._periodicSaveInterval);
            this._periodicSaveInterval = null;
        }
        if (this._periodicDbSaveInterval) {
            clearInterval(this._periodicDbSaveInterval);
            this._periodicDbSaveInterval = null;
        }
        if (typeof LifecycleHelper !== 'undefined') {
            LifecycleHelper.unregister('storage:unsaved-warning');
        }
        if (this._navPopstateHandler) {
            window.removeEventListener('popstate', this._navPopstateHandler);
            this._navPopstateHandler = null;
        }
        if (this._navClickHandler) {
            document.removeEventListener('click', this._navClickHandler);
            this._navClickHandler = null;
        }
    }

    /**
     * Единственная точка перевода persistence-state в новое значение.
     * Синхронно обновляет зеркальные булевы флаги и индикатор.
     * Старые API-методы (markAsUnsaved / _markAsSaved / markAsSyncedWithDB)
     * — обёртки над _setState.
     *
     * @private
     * @param {'saved'|'local-only'|'unsaved'} newState
     */
    static _setState(newState) {
        if (newState !== 'saved' && newState !== 'local-only' && newState !== 'unsaved') {
            console.warn('StorageManager._setState: неизвестное состояние', newState);
            return;
        }
        this._state = newState;
        // Зеркала для обратной совместимости с консьюмерами, читающими булевы поля
        // напрямую (beforeunload-warning, _updateSaveIndicator, hasUnsavedChanges).
        this._hasUnsavedChanges = (newState === 'unsaved');
        this._isSyncedWithDB = (newState === 'saved');
        this._updateSaveIndicator();
    }

    /**
     * Помечает состояние как измененное и запускает дебаунс сохранения
     *
     * Автоматически вызывается через Proxy при изменении AppState.
     * Игнорируется если отслеживание временно отключено.
     */
    static markAsUnsaved() {
        if (this._trackingDepth > 0) {
            return;
        }
        this._setState('unsaved');
        // Запускаем дебаунс автосохранения
        this._debouncedSave();
    }

    /**
     * Помечает состояние как сохраненное в localStorage (но не обязательно в БД).
     * @private
     */
    static _markAsSaved() {
        // Если уже синхронизировано с БД — состояние не должно деградировать в 'local-only'.
        // _markAsSaved вызывается из saveState (всегда после mutation), поэтому
        // прежнее состояние почти всегда было 'unsaved'. Сохраняем 'saved' если оно было.
        if (this._state === 'saved') {
            return;
        }
        this._setState('local-only');
    }

    /**
     * Помечает состояние как синхронизированное с БД.
     * Заодно сбрасывает offline-машинерию (предупреждение о сбое сохранения
     * можно показывать снова, подписка на 'online' больше не нужна).
     */
    static markAsSyncedWithDB() {
        this._setState('saved');
        this._resetDbSaveFailureState();
    }

    /**
     * Запоминает серверный updated_at акта (база для метаданных снимка).
     * Вызывается после успешного GET-контента и успешного PUT-сохранения.
     *
     * @param {string|null} updatedAt ISO-строка серверного updated_at
     */
    static setBaseUpdatedAt(updatedAt) {
        this._baseUpdatedAt = updatedAt || null;
    }

    /**
     * Помечает восстановленный из localStorage черновик как
     * несинхронизированный с БД и переписывает снимок свежими метаданными.
     * Вызывается из loadActContent после включения трекинга — итоговое
     * состояние 'local-only' (жёлтый): данные есть локально, но не в БД.
     */
    static applyRestoredDraftState() {
        this._setState('unsaved');
        this.saveState(true);
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
     * Сохраняет снимок-черновик текущего акта в localStorage (M.8, pfe-1).
     *
     * Снимок = ОДИН вызов AppState.exportData() (тот же сериализатор, что и
     * body PUT /content — никаких расхождений форматов и сырых Proxy-объектов)
     * + метаданные для восстановления (H3): actId, savedAt, baseUpdatedAt.
     *
     * Ключ — per-act (`audit_workstation_state:{actId}`), снимки других актов
     * при записи удаляются (живёт только снимок текущего акта). Снимок пишется
     * только при наличии несинхронизированных изменений и удаляется после
     * успешного PUT в БД — «снимок есть» означает «есть несохранённые правки».
     *
     * @param {boolean} [silent=false] - Не показывать лог о сохранении
     * @returns {boolean} true если сохранение успешно (или сохранять нечего)
     */
    static saveState(silent = false) {
        // pfe-3: re-entrancy guard. Если запись снимка уже идёт (периодический
        // тик прилетел во время явного save или наоборот) — пропускаем повтор,
        // чтобы два сохранения не пересеклись на одном снимке.
        if (this._saveInProgress) {
            return false;
        }
        this._saveInProgress = true;
        try {
            const actId = window.currentActId || null;
            if (!actId) {
                console.warn('saveState: нет открытого акта — снимок не записан');
                return false;
            }

            // Всё синхронизировано с БД — несинхронизированных правок нет,
            // снимок не нужен (и не должен породить ложный диалог восстановления).
            if (this._state === 'saved') {
                return true;
            }

            const snapshot = {
                actId,
                savedAt: new Date().toISOString(),
                baseUpdatedAt: this._baseUpdatedAt,
                version: 2,
                data: AppState.exportData()
            };
            const stateJson = JSON.stringify(snapshot);

            // Проверка размера данных
            if (stateJson.length > AppConfig.localStorage.maxStorageSize) {
                console.warn('Размер данных превышает лимит localStorage');
                Notifications.warning('Недостаточно места для сохранения. Попробуйте упростить структуру акта.');
                return false;
            }

            // Сохранение данных + чистка снимков других актов и legacy-ключей
            localStorage.setItem(this._snapshotKey(actId), stateJson);
            this._purgeForeignSnapshots(actId);

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
        } finally {
            // pfe-3: lock снимается всегда — даже при раннем return или ошибке.
            this._saveInProgress = false;
        }
    }

    /**
     * Ключ localStorage для снимка акта.
     * @private
     * @param {number|string} actId ID акта
     * @returns {string}
     */
    static _snapshotKey(actId) {
        return `${AppConfig.localStorage.stateKeyPrefix}:${actId}`;
    }

    /**
     * Читает снимок-черновик акта из localStorage.
     * Повреждённый (не-JSON) снимок удаляется, возвращается null.
     *
     * @param {number|string} actId ID акта
     * @returns {Object|null} Снимок {actId, savedAt, baseUpdatedAt, version, data} или null
     */
    static readSnapshot(actId) {
        const key = this._snapshotKey(actId);
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (error) {
            console.error('Повреждённый снимок в localStorage — удаляем:', error);
            try {
                localStorage.removeItem(key);
            } catch { /* ignore */ }
            return null;
        }
    }

    /**
     * Удаляет снимок-черновик акта из localStorage.
     * Вызывается после успешной синхронизации с БД, при отказе от
     * восстановления и для устаревших снимков.
     *
     * @param {number|string} actId ID акта
     */
    static removeSnapshot(actId) {
        try {
            localStorage.removeItem(this._snapshotKey(actId));
        } catch (error) {
            console.error('Ошибка удаления снимка из localStorage:', error);
        }
    }

    /**
     * Удаляет снимки других актов и legacy-ключи старого формата.
     * Политика: localStorage не резиновый — живёт только снимок текущего акта.
     * @private
     * @param {number|string} currentActId ID текущего акта
     */
    static _purgeForeignSnapshots(currentActId) {
        const prefix = `${AppConfig.localStorage.stateKeyPrefix}:`;
        const currentKey = this._snapshotKey(currentActId);
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix) && key !== currentKey) {
                toRemove.push(key);
            }
        }
        // Legacy-ключи единого снимка (формат до per-act ключей).
        toRemove.push('audit_workstation_state', 'audit_workstation_timestamp');
        toRemove.forEach(key => localStorage.removeItem(key));
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
            // Если сохранение не удалось, возвращаем state в 'unsaved'.
            this._setState('unsaved');
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
            this.disableTracking();

            requestAnimationFrame(() => {
                const result = this.forceSave();

                // Небольшая задержка для завершения всех операций
                setTimeout(() => {
                    // Разблокируем отслеживание
                    this.enableTracking();
                    resolve(result);
                }, AppConfig.timings.enableTrackingAfterSave);
            });
        });
    }

    /**
     * Временно отключает отслеживание изменений (инкремент глубины, M.11).
     *
     * Используется для операций, которые модифицируют состояние,
     * но не должны помечать его как несохраненное. Вложенные пары
     * disable/enable композируются: отслеживание включится обратно
     * только когда КАЖДЫЙ disable получит свой enable.
     */
    static disableTracking() {
        this._trackingDepth++;
    }

    /**
     * Включает отслеживание изменений обратно (декремент глубины, пол 0).
     */
    static enableTracking() {
        this._trackingDepth = Math.max(0, this._trackingDepth - 1);
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
        this.disableTracking();
        try {
            return fn();
        } finally {
            this.enableTracking();
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
     * Очищает сохраненные снимки актов из localStorage
     * (все per-act снимки + legacy-ключи старого формата)
     */
    static clearStorage() {
        try {
            this._clearStorage();

            // При очистке возвращаемся в чистое состояние.
            this._setState('saved');
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
            const prefix = `${AppConfig.localStorage.stateKeyPrefix}:`;
            const toRemove = ['audit_workstation_state', 'audit_workstation_timestamp'];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(prefix)) {
                    toRemove.push(key);
                }
            }
            toRemove.forEach(key => localStorage.removeItem(key));
        } catch (error) {
            console.error('Ошибка очистки localStorage:', error);
        }
    }

    /**
     * Получает временную метку последнего сохранения снимка текущего акта
     * @returns {string|null} ISO строка времени или null
     */
    static getLastSaveTimestamp() {
        const actId = window.currentActId || null;
        if (!actId) return null;
        return this.readSnapshot(actId)?.savedAt ?? null;
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

        // Read-only режим: индикатор всегда заблокирован,
        // никакие изменения не сохраняются.
        if (typeof AppConfig !== 'undefined' && AppConfig.readOnlyMode?.isReadOnly) {
            button.classList.remove('unsaved', 'local-only');
            button.classList.add('saved');
            button.disabled = true;
            button.title = 'Режим только для чтения';
            label.textContent = 'Только чтение';
            return;
        }

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
     * Универсальное подтверждение программной навигации.
     * Контракт: при необходимости спрашивает подтверждение, и если переход
     * разрешён (несохранённых изменений нет ЛИБО пользователь подтвердил) —
     * при наличии opts.url ОБЯЗАТЕЛЬНО выполняет редирект.
     *
     * Без перехода (return true без редиректа) пользователь застревал на
     * странице при отсутствии несохранённого: вызывающие места (lock-manager
     * 409/500, header-exit) делегируют переход сюда и сами не редиректят.
     *
     * @param {string} [targetUrl] - URL для редиректа (информационно, фактический переход через opts.url)
     * @param {{url?: string}} [opts]
     * @returns {Promise<boolean>}
     */
    static async confirmNavigation(targetUrl, opts = {}) {
        if (!this.hasUnsyncedChanges()) {
            if (opts.url) {
                window._allowNavigation = true;
                this.allowUnload();
                window.location.href = opts.url;
            }
            return true;
        }
        const ok = await DialogManager.show({
            type: 'confirm',
            title: 'Несохраненные изменения',
            message: 'У вас есть несохранённые изменения. Уйти со страницы?',
            icon: '⚠️',
            confirmText: 'Уйти',
            cancelText: 'Остаться'
        });
        if (ok && opts.url) {
            window._allowNavigation = true;
            this.allowUnload();
            window.location.href = opts.url;
        }
        return ok;
    }

    /**
     * Очищает все таймеры и снимает слушатели при уничтожении.
     * pfe-10: помимо таймеров снимает beforeunload/click/popstate, иначе
     * после destroy старые обработчики продолжали висеть на window/document.
     */
    static destroy() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
        }

        // Гасит периодические интервалы + снимает beforeunload/click/popstate.
        this._teardownEventHandlers();

        this._resetDbSaveFailureState();
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

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.StorageManager = StorageManager;
