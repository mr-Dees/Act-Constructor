/**
 * Телеметрия здоровья редактора (§6.8, минимальная версия).
 *
 * Копит счётчики событий редактора (self-heal observer'а, починки капсул,
 * детерминированный дубль-id, ошибки сохранения в БД, пустой paste) и батчами
 * шлёт их на бэк (POST /api/v1/acts/editor-telemetry). Мотив: все self-heal'ы
 * редактора молчат — о поломках узнаём только от пользователей.
 *
 * Приватность: в payload уходят ТОЛЬКО тип события, id акта и счётчик —
 * никакого пользовательского контента. Username бэк берёт из auth.
 *
 * Точки вызова навешаны как опциональные однострочники
 * `window.EditorTelemetry?.track?.('...')`: отсутствие модуля (portal-страницы,
 * тесты) ничего не ломает. Ошибки сети/сериализации проглатываются —
 * телеметрия НИКОГДА не должна ронять редактор.
 */

import { AppConfig } from '../../shared/app-config.js';

// Допустимые типы событий. Синхронизированы с CHECK-констрейнтом
// check_editor_telemetry_event_type_values (обе schema.sql) и Literal-типом
// бэка (app/domains/acts/schemas/editor_telemetry.py).
const KNOWN_EVENTS = new Set([
    'observer_heal',
    'capsule_repair',
    'dup_id_fix',
    'save_failure',
    'empty_paste',
]);

// Флаш при накоплении FLUSH_AT событий ИЛИ каждые FLUSH_INTERVAL_MS.
const FLUSH_AT = 50;
const FLUSH_INTERVAL_MS = 30000;
const ENDPOINT = '/api/v1/acts/editor-telemetry';

export const EditorTelemetry = {
    // Kill-switch. Дефолт true; сервер уточняет через setEnabled по ответу
    // GET /acts/limits (violation-image-validator.loadImageLimits). До ответа
    // события копятся; при выключенной телеметрии бэк отвечает 204 без записи.
    _enabled: true,

    // Агрегатор: ключ `${actId}|${eventType}` → {event_type, act_id, count}.
    // Хранение в форме payload'а — на флаше не нужно ремапить.
    _pending: new Map(),
    _totalPending: 0,

    // Единственный на страницу interval-таймер (ленивый старт на первом track).
    _timer: null,

    /**
     * Учитывает одно событие редактора. Дешёвый no-op, если телеметрия
     * выключена, тип неизвестен или акт не открыт (RO без actId — не падаем).
     * @param {string} eventType один из KNOWN_EVENTS
     */
    track(eventType) {
        try {
            if (!this._enabled) return;
            if (!KNOWN_EVENTS.has(eventType)) return;
            // actId — из глобала конструктора; приводим к числу (payload → int).
            const actId = Number(window.currentActId);
            if (!actId || Number.isNaN(actId)) return;

            const key = actId + '|' + eventType;
            const entry = this._pending.get(key);
            if (entry) {
                entry.count += 1;
            } else {
                this._pending.set(key, { event_type: eventType, act_id: actId, count: 1 });
            }
            this._totalPending += 1;
            this._ensureTimer();
            if (this._totalPending >= FLUSH_AT) this.flush();
        } catch (_) {
            // телеметрия никогда не роняет редактор: 2 из 5 точек вызова стоят
            // в catch-ветках сохранения, гипотетический throw подменил бы
            // реальную ошибку сохранения.
        }
    },

    /**
     * Отправляет накопленный батч (fire-and-forget). Пустой батч — no-op.
     * @param {{keepalive?: boolean}} [opts={}] keepalive:true — финальный флаш
     *   на beforeunload (переживает закрытие вкладки; тело телеметрии заведомо
     *   мало и в лимит keepalive укладывается).
     */
    flush({ keepalive = false } = {}) {
        if (this._pending.size === 0) return;
        const events = [...this._pending.values()];
        this._pending = new Map();
        this._totalPending = 0;
        try {
            fetch(AppConfig.api.getUrl(ENDPOINT), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ events }),
                credentials: 'same-origin',
                ...(keepalive ? { keepalive: true } : {}),
            }).catch(() => {
                // #10: сеть/прокси упали ДО ответа сервера — счётчики не теряем,
                // возвращаем в очередь (дошлёт следующий флаш). На keepalive-флаше
                // (вкладка закрывается) возвращать некуда — глотаем.
                if (!keepalive) this._requeue(events);
            });
        } catch (_) {
            // fetch бросил синхронно (например, keepalive-лимит тела) — вернём в
            // очередь (кроме keepalive). Телеметрия не должна ронять редактор.
            if (!keepalive) this._requeue(events);
        }
    },

    /**
     * @private #10: возвращает неотправленный батч в очередь при транзиентном
     * сбое — слияние по ключу `${actId}|${eventType}`, как в track. Размер
     * очереди естественно ограничен числом пар (акт × тип события), поэтому
     * повторные сбои не растят её безгранично (растёт только счётчик).
     * @param {Array<{event_type:string, act_id:number, count:number}>} events
     */
    _requeue(events) {
        if (!this._enabled) return; // kill-switch выключился между флашем и сбоем
        for (const e of events) {
            const key = e.act_id + '|' + e.event_type;
            const entry = this._pending.get(key);
            if (entry) entry.count += e.count;
            else this._pending.set(key, { event_type: e.event_type, act_id: e.act_id, count: e.count });
            this._totalPending += e.count;
        }
        this._ensureTimer();
    },

    /**
     * Применяет kill-switch с сервера (флаг из GET /acts/limits). Выключение
     * сбрасывает накопленное и гасит таймер — ни утечки, ни лишних запросов.
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this._enabled = enabled !== false;
        if (!this._enabled) {
            this._pending = new Map();
            this._totalPending = 0;
            this._stopTimer();
        }
    },

    /** @private Ленивый старт единственного на страницу interval-таймера. */
    _ensureTimer() {
        if (this._timer) return;
        this._timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    },

    /** @private Останавливает interval-таймер (kill-switch / тесты). */
    _stopTimer() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    },

    /** @private Финальный флаш на закрытии вкладки (keepalive). */
    _flushOnUnload() {
        this.flush({ keepalive: true });
    },

    /** @private Полный сброс состояния — только для тестов. */
    _resetForTests() {
        this._stopTimer();
        this._pending = new Map();
        this._totalPending = 0;
        this._enabled = true;
    },
};

// Финальный флаш при закрытии вкладки — недоотправленные счётчики не теряются.
// Guard: в node-тестах window.addEventListener отсутствует (импорт не должен падать).
if (typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', () => EditorTelemetry._flushOnUnload());
}

// Дублируется на window ради inline-скриптов и опциональных хуков
// `window.EditorTelemetry?.track?.(...)` в модулях-источниках событий.
window.EditorTelemetry = EditorTelemetry;
