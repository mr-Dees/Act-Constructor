/**
 * Шина событий чата
 *
 * Синхронный pub/sub для связи модулей чата.
 * Модули подписываются на события и публикуют их,
 * не зная друг о друге напрямую.
 */
const ChatEventBus = {

    /** @type {Object<string, Set<function>>} */
    _listeners: {},

    /**
     * Подписка на событие
     *
     * @param {string} event — имя события
     * @param {function} handler — обработчик
     */
    on(event, handler) {
        if (!this._listeners[event]) {
            this._listeners[event] = new Set();
        }
        this._listeners[event].add(handler);
    },

    /**
     * Отписка от события
     *
     * @param {string} event — имя события
     * @param {function} handler — обработчик
     */
    off(event, handler) {
        if (this._listeners[event]) {
            this._listeners[event].delete(handler);
        }
    },

    /**
     * Публикация события
     *
     * @param {string} event — имя события
     * @param {*} [data] — данные события
     */
    emit(event, data) {
        const handlers = this._listeners[event];
        if (!handlers) return;
        for (const handler of handlers) {
            try {
                handler(data);
            } catch (err) {
                console.error(`ChatEventBus: ошибка в обработчике «${event}»`, err);
            }
        }
    },

    /**
     * Удаляет все подписки (для тестов)
     */
    reset() {
        this._listeners = {};
    },
};

window.ChatEventBus = ChatEventBus;
