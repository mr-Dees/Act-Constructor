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

    ClientActionsRegistry.register('open_url', ({ url }) => {
        if (!url) {
            console.warn('open_url: пустой url');
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

    ClientActionsRegistry.register('trigger_sdk', ({ method, args }) => {
        if (typeof window[method] !== 'function') {
            console.warn(`trigger_sdk: метод "${method}" не существует в window`);
            return;
        }
        window[method](...(Array.isArray(args) ? args : []));
    });

    window.ClientActionsRegistry = ClientActionsRegistry;
})();
