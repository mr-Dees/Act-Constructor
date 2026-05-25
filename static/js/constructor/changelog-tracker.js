/**
 * Гранулярное отслеживание локальных изменений.
 * Накапливает записи об операциях, сбрасывает при сохранении в БД.
 */
class ChangelogTracker {
    static _entries = [];
    static _actId = null;
    static _storageKey = null;
    static _debounceTimers = {};
    static MAX_ENTRIES = 500;
    /** Одноразовый флаг показа уведомления о квоте, чтобы не спамить юзера каждые 1 сек debounce. */
    static _quotaWarned = false;

    /**
     * Инициализация с actId, загрузка из localStorage
     * @param {string|number} actId
     */
    static init(actId) {
        this._actId = actId;
        this._storageKey = `act_changelog_${actId}`;
        try {
            const stored = localStorage.getItem(this._storageKey);
            this._entries = stored ? JSON.parse(stored) : [];
        } catch {
            this._entries = [];
        }
    }

    /**
     * Добавить запись об операции
     * @param {string} op - Тип операции
     * @param {string} id - ID элемента
     * @param {string} name - Название элемента
     * @param {Object} [extra={}] - Дополнительные данные
     */
    static record(op, id, name, extra = {}) {
        if (!this._actId) return;

        this._entries.push({
            t: Date.now(),
            op,
            id: id || '',
            name: name || '',
            extra
        });

        // Лимит записей
        if (this._entries.length > this.MAX_ENTRIES) {
            this._entries = this._entries.slice(-this.MAX_ENTRIES);
        }

        this._persist();
    }

    /**
     * Добавить запись с debounce (для modify-операций)
     * @param {string} op - Тип операции
     * @param {string} id - ID элемента
     * @param {string} name - Название элемента
     * @param {Object} [extra={}] - Дополнительные данные
     * @param {number} [debounceMs=5000] - Задержка debounce
     */
    static _recordDebounced(op, id, name, extra = {}, debounceMs = 5000) {
        const key = `${op}_${id}`;

        if (this._debounceTimers[key]) {
            clearTimeout(this._debounceTimers[key].timer);
        }

        this._debounceTimers[key] = {
            timer: setTimeout(() => {
                this.record(op, id, name, extra);
                delete this._debounceTimers[key];
            }, debounceMs),
            op, id, name, extra,
        };
    }

    /**
     * Вернуть и очистить все записи (flush при сохранении)
     * @returns {Array} Массив записей
     */
    static flush() {
        // Срабатываем все pending debounce — добавляем их записи немедленно
        for (const key of Object.keys(this._debounceTimers)) {
            const pending = this._debounceTimers[key];
            clearTimeout(pending.timer);
            this.record(pending.op, pending.id, pending.name, pending.extra);
            delete this._debounceTimers[key];
        }

        const entries = [...this._entries];
        this._entries = [];

        if (this._storageKey) {
            try {
                localStorage.removeItem(this._storageKey);
            } catch { /* ignore */ }
        }

        return entries;
    }

    /**
     * Сохранить в localStorage (debounced 1s)
     * @private
     */
    static _persist() {
        if (this._persistTimer) {
            clearTimeout(this._persistTimer);
        }

        this._persistTimer = setTimeout(() => {
            if (!this._storageKey) return;
            try {
                localStorage.setItem(this._storageKey, JSON.stringify(this._entries));
            } catch (err) {
                // QuotaExceededError: localStorage переполнен. Молча игнорировать опасно —
                // юзер не поймёт, почему журнал изменений «забывает» операции после reload.
                // Показываем уведомление один раз за сессию, чтобы не спамить.
                if (err && err.name === 'QuotaExceededError' && !this._quotaWarned) {
                    this._quotaWarned = true;
                    if (typeof Notifications !== 'undefined') {
                        Notifications.warning(
                            'Заполнено локальное хранилище — журнал изменений не сохраняется. '
                            + 'Сохраните акт и перезагрузите страницу.'
                        );
                    }
                }
            }
        }, 1000);
    }
}

// Глобальный доступ
window.ChangelogTracker = ChangelogTracker;
