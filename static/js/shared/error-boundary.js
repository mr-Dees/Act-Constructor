/**
 * Глобальный error boundary для фронтенда.
 *
 * Перехватывает:
 *   - синхронные ошибки через window.onerror,
 *   - неперехваченные Promise rejection'ы через unhandledrejection.
 *
 * При каждой ошибке:
 *   1) логирует подробности в console.error,
 *   2) показывает пользователю toast через window.Notifications (если уже загружен),
 *   3) отправляет отчёт на POST /api/v1/system/client-error с rate-limit
 *      (не чаще 1 запроса в 5 сек) — чтобы вечный setInterval с ошибкой
 *      не залил бэкенд.
 *
 * Подключается через <script defer src="..."> ПОСЛЕ notifications.js и
 * ДО основных доменных модулей, чтобы успеть поймать ошибки их инициализации.
 */
class ErrorBoundary {
    /**
     * Минимальный интервал между отправками отчётов на сервер (мс).
     * Перехватчик ловит все ошибки, но сетевой репорт идёт не чаще раза в 5 сек.
     */
    static REPORT_INTERVAL_MS = 5000;

    /** @type {number} timestamp последнего успешного _reportToServer (Date.now) */
    static _lastReportAt = 0;

    /**
     * Отправляет отчёт об ошибке на бэкенд с rate-limit.
     * Сам по себе fetch завёрнут в try/catch — ошибки репортера не должны
     * провоцировать новый unhandledrejection и каскад.
     *
     * @param {Object} payload — данные ошибки (тип, message, stack, и т.д.)
     */
    static _reportToServer(payload) {
        const now = Date.now();
        if (now - this._lastReportAt < this.REPORT_INTERVAL_MS) {
            return;
        }
        this._lastReportAt = now;

        try {
            // AppConfig.api.getUrl нужен для корректного префикса под JupyterHub-proxy.
            // Если AppConfig ещё не загрузился (boundary активен с самого старта) —
            // fallback на относительный путь.
            const url = (typeof AppConfig !== 'undefined' && AppConfig.api?.getUrl)
                ? AppConfig.api.getUrl('/api/v1/system/client-error')
                : '/api/v1/system/client-error';

            const body = {
                type: payload.type || 'error',
                message: payload.message || '',
                url: payload.url || window.location.href,
                lineno: payload.lineno ?? null,
                colno: payload.colno ?? null,
                stack: payload.stack || null,
                userAgent: navigator.userAgent,
                currentActId: window.currentActId ?? null,
            };

            // keepalive: запрос уйдёт даже если пользователь закрывает вкладку
            // в момент ошибки (полезно для onerror в beforeunload-ситуациях).
            fetch(url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body),
                keepalive: true,
            }).catch(() => {
                // Тихо глотаем — мы не должны генерировать новые unhandledrejection.
            });
        } catch (_) {
            // Полностью гасим — error boundary никогда не должен сам падать.
        }
    }
}

window.ErrorBoundary = ErrorBoundary;

window.addEventListener('error', (e) => {
    console.error('[GlobalError]', e.error || e.message, e.filename, e.lineno);
    try {
        if (typeof Notifications !== 'undefined') {
            Notifications.error('Произошла непредвиденная ошибка. Обновите страницу.');
        }
        ErrorBoundary._reportToServer({
            type: 'error',
            message: String(e.error?.message || e.message || 'unknown'),
            url: e.filename,
            lineno: e.lineno,
            colno: e.colno,
            stack: e.error?.stack,
        });
    } catch (_) {
        // не каскадим
    }
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('[UnhandledPromise]', e.reason);
    try {
        if (typeof Notifications !== 'undefined') {
            Notifications.error('Произошла непредвиденная ошибка. Обновите страницу.');
        }
        ErrorBoundary._reportToServer({
            type: 'unhandledrejection',
            message: String(e.reason?.message || e.reason || 'unknown'),
            stack: e.reason?.stack,
        });
    } catch (_) {
        // не каскадим
    }
});
