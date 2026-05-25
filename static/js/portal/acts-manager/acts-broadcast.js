/**
 * Cross-tab уведомления о событиях актов через BroadcastChannel.
 * Подписчики получают сигналы об удалении/дублировании/сохранении актов,
 * чтобы инвалидировать локальные кеши списка без F5.
 */
class ActsBroadcast {
    static CHANNEL = 'acts';
    static _bc = null;
    static _listeners = new Set();

    static init() {
        if (this._bc) return;
        if (typeof BroadcastChannel === 'undefined') {
            console.warn('BroadcastChannel недоступен — cross-tab sync отключён');
            return;
        }
        this._bc = new BroadcastChannel(this.CHANNEL);
        this._bc.addEventListener('message', (e) => {
            this._listeners.forEach(fn => fn(e.data));
        });
    }

    static notify(eventType, payload) {
        this.init();
        if (!this._bc) return;
        this._bc.postMessage({type: eventType, payload, ts: Date.now()});
    }

    static subscribe(handler) {
        this.init();
        this._listeners.add(handler);
        return () => this._listeners.delete(handler);
    }
}

window.ActsBroadcast = ActsBroadcast;
