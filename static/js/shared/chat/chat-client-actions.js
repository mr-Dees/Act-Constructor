/**
 * ClientActionsRegistry — реестр и исполнитель чисто-клиентских команд.
 *
 * Вызывается из ChatRenderer при получении блока type === 'client_action'.
 * Стандартные команды: open_url, notify, trigger_sdk.
 * Домены могут регистрировать свои через ClientActionsRegistry.register(...).
 */
(function () {
    'use strict';

    const handlers = {};

    const ClientActionsRegistry = {
        register(name, fn) {
            if (typeof fn !== 'function') {
                console.error(
                    `ClientActionsRegistry.register: handler для "${name}" не функция`
                );
                return;
            }
            handlers[name] = fn;
        },

        execute(action, params) {
            const fn = handlers[action];
            if (!fn) {
                console.warn(`ClientActionsRegistry: неизвестная команда "${action}"`);
                return;
            }
            try {
                fn(params || {});
            } catch (err) {
                console.error(`ClientActionsRegistry: ошибка в "${action}":`, err);
            }
        },

        isRegistered(action) {
            return typeof handlers[action] === 'function';
        },

        list() {
            return Object.keys(handlers);
        },
    };

    // ── Стандартные команды ────────────────────────────────────────────

    // Whitelist URL-схем для open_url. Совпадает с backend ALLOWED_OPEN_URL_SCHEMES
    // в app/core/chat/blocks.py — defense in depth, чтобы при пропуске
    // валидации на бэке (новый источник ClientActionBlock) фронт всё равно
    // отверг javascript:..., data:..., vbscript:..., file:...
    const ALLOWED_OPEN_URL_SCHEMES = ['http://', 'https://', 'mailto:', '/'];

    function isAllowedUrl(url) {
        if (typeof url !== 'string' || !url) return false;
        return ALLOWED_OPEN_URL_SCHEMES.some(s => url.startsWith(s));
    }

    ClientActionsRegistry.register('open_url', ({ url }) => {
        if (!isAllowedUrl(url)) {
            console.warn(`open_url: запрещённая схема URL: ${String(url).slice(0, 40)}`);
            return;
        }
        window.location.href = url;
    });

    ClientActionsRegistry.register('notify', ({ message, level }) => {
        const lvl = level || 'info';
        if (window.Notifications && typeof window.Notifications.show === 'function') {
            window.Notifications.show(message, lvl);
        } else {
            // Fallback, если модуль уведомлений ещё не подключён
            console.log(`[notify:${lvl}] ${message}`);
        }
    });

    // Whitelist методов для trigger_sdk. Без него LLM мог бы вызвать любую
    // функцию window: alert, eval-аналоги, fetch, и т.д.
    const ALLOWED_SDK_METHODS = new Set([
        // Пусто по умолчанию: проект пока не использует trigger_sdk.
        // Добавляй сюда явно, когда понадобится конкретный SDK-метод.
    ]);

    ClientActionsRegistry.register('trigger_sdk', ({ method, args }) => {
        if (typeof method !== 'string' || !ALLOWED_SDK_METHODS.has(method)) {
            console.warn(`trigger_sdk: метод "${method}" не в whitelist`);
            return;
        }
        if (typeof window[method] !== 'function') {
            console.warn(`trigger_sdk: метод "${method}" не существует в window`);
            return;
        }
        window[method](...(Array.isArray(args) ? args : []));
    });

    window.ClientActionsRegistry = ClientActionsRegistry;
})();
