/**
 * Слежение за бездействием пользователя.
 *
 * Выделен из LockManager (§6 п.9 аудита): activity-листенеры на document,
 * периодическая проверка простоя и проброс visibilitychange. Решения о
 * продлении лока, диалогах и выходе остаются в LockManager — watchdog
 * только сообщает о событиях через колбэки.
 *
 * Гарантии очистки: stop() снимает ВСЕ подписки на document
 * (4 activity-события + visibilitychange) и останавливает таймер проверки.
 * Идемпотентен; контракт закреплён в tests/playwright/specs/09-lock-listeners-leak.spec.ts.
 */
export class InactivityWatchdog {
    /** События пользовательской активности, сбрасывающие таймер простоя. */
    static _activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];

    /**
     * @param {Object} options
     * @param {number} options.checkIntervalSeconds - период проверки простоя, сек
     * @param {number} options.idleTimeoutMinutes - порог бездействия, мин
     * @param {Function} options.onIdle - вызывается один раз при превышении порога,
     *   аргумент — целое число минут простоя; проверка при этом останавливается
     *   (повторный запуск — startIdleCheck())
     * @param {Function|null} [options.onVisibilityChange] - вызывается на каждый
     *   visibilitychange документа (решение принимает подписчик)
     */
    constructor({ checkIntervalSeconds, idleTimeoutMinutes, onIdle, onVisibilityChange = null }) {
        this._checkIntervalSeconds = checkIntervalSeconds;
        this._idleTimeoutMinutes = idleTimeoutMinutes;
        this._onIdle = onIdle;
        this._onVisibilityChange = onVisibilityChange;
        this._lastActivity = Date.now();
        this._checkInterval = null;
        // Bound-handler'ы сохраняются для корректного removeEventListener в stop().
        this._activityHandler = null;
        this._visibilityHandler = null;
    }

    /**
     * Запускает слежение: activity-листенеры, visibilitychange и проверку простоя.
     */
    start() {
        this._setupActivityTracking();
        this._setupVisibilityHandling();
        this.startIdleCheck();
    }

    /**
     * Полная остановка: таймер проверки + все подписки на document. Идемпотентен.
     */
    stop() {
        this.stopIdleCheck();
        this._teardownVisibilityHandling();
        this._teardownActivityTracking();
    }

    /**
     * Помечает «активность сейчас» (сброс таймера простоя).
     * Используется LockManager'ом после успешного продления по кнопке «Продолжить».
     */
    touch() {
        this._lastActivity = Date.now();
    }

    /**
     * Сколько миллисекунд прошло с последней активности.
     * @returns {number}
     */
    getIdleMs() {
        return Date.now() - this._lastActivity;
    }

    /**
     * Запускает (или перезапускает) периодическую проверку простоя.
     * При превышении порога проверка останавливается и вызывается onIdle.
     */
    startIdleCheck() {
        this.stopIdleCheck();
        const intervalMs = this._checkIntervalSeconds * 1000;
        this._checkInterval = setInterval(() => this._checkIdle(), intervalMs);
    }

    /**
     * Останавливает периодическую проверку простоя (листенеры остаются).
     */
    stopIdleCheck() {
        if (this._checkInterval) {
            clearInterval(this._checkInterval);
            this._checkInterval = null;
        }
    }

    /**
     * Тик проверки простоя. Вынесен из setInterval-замыкания для тестируемости.
     * @private
     */
    _checkIdle() {
        const minutesIdle = this.getIdleMs() / 1000 / 60;
        if (minutesIdle >= this._idleTimeoutMinutes) {
            this.stopIdleCheck();
            this._onIdle(Math.floor(minutesIdle));
        }
    }

    /**
     * Отслеживание активности пользователя.
     * Один handler reuse-ится для 4 событий и сохраняется в _activityHandler,
     * чтобы stop() мог снять listeners через removeEventListener.
     * @private
     */
    _setupActivityTracking() {
        // На случай повторного start() — снять старые сначала.
        this._teardownActivityTracking();
        this._activityHandler = () => {
            this._lastActivity = Date.now();
        };
        InactivityWatchdog._activityEvents.forEach(event =>
            document.addEventListener(event, this._activityHandler, {passive: true})
        );
    }

    /**
     * Снимает activity-listeners. Идемпотентен.
     * @private
     */
    _teardownActivityTracking() {
        if (!this._activityHandler) return;
        InactivityWatchdog._activityEvents.forEach(event =>
            document.removeEventListener(event, this._activityHandler)
        );
        this._activityHandler = null;
    }

    /**
     * Подписка на visibilitychange документа (если задан колбэк).
     * @private
     */
    _setupVisibilityHandling() {
        this._teardownVisibilityHandling();
        if (!this._onVisibilityChange) return;
        this._visibilityHandler = () => this._onVisibilityChange();
        document.addEventListener('visibilitychange', this._visibilityHandler);
    }

    /**
     * Снимает visibilitychange-listener. Идемпотентен.
     * @private
     */
    _teardownVisibilityHandling() {
        if (!this._visibilityHandler) return;
        document.removeEventListener('visibilitychange', this._visibilityHandler);
        this._visibilityHandler = null;
    }
}
