/**
 * Аудит правок нарушений через diff при сохранении (#17).
 *
 * Журнал изменений фиксировал правки лишь двух полей нарушения
 * (violated/established) через per-keystroke debounce; остальные шесть полей
 * (описания/доп.материалы/причины/принятые меры/последствия/ответственные)
 * проходили бесследно, а общий debounce-ключ склеивал правку обоих полей в
 * одну запись. Теперь снимок нарушений берётся при загрузке акта, а перед
 * каждым flush журнала синтезируется по ОДНОЙ записи modify_violation на
 * каждое изменившееся нарушение — независимо от того, какое поле правилось
 * (UI аудит-лога показывает только тип операции, гранулярность поля не нужна).
 *
 * Производительность: снимок НЕ клонирует base64-байты картинок. Отпечаток
 * картинки — это её id + метаданные (тип/подпись/имя файла/ширина), без url.
 * Сравнение — строковое равенство нормализованного отпечатка нарушения.
 * Следствие: правка ТОЛЬКО байтов url при неизменных id/метаданных изменением
 * не считается (граничный, крайне редкий кейс — реальная замена картинки
 * меняет id/имя файла).
 *
 * Синтез вшит в ChangelogTracker.flush() через pre-flush hook (регистрируется
 * ниже как module-level side effect) — отрабатывает на всех трёх flush-сайтах
 * (авто-сейв, ручное сохранение, истечение сессии) без ручной синхронизации.
 *
 * #5: flush() отрабатывает ДО await fetch(PUT) на всех трёх save-сайтах — эталон
 * нельзя сдвигать прямо в synthesize(), иначе неудачный PUT теряет и запись
 * аудита (уже улетела во flush), и саму правку (эталон уже съехал). Поэтому
 * synthesize() лишь откладывает кандидата в _pendingSnapshot; коммит эталона —
 * через confirmSave(), вызываемый вызывающей стороной только при resp.ok.
 *
 * Модуль без DOM — тестируется под node:test напрямую.
 */
import { ChangelogTracker } from '../changelog-tracker.js';

export class ViolationAudit {
    /** Эталонный снимок: Map<violationId, отпечаток(строка)>. */
    static _snapshot = new Map();

    /**
     * Снимок-кандидат, вычисленный последним synthesize(), но ещё не подтверждённый
     * успешным сохранением (#5: раньше _snapshot сдвигался ДО ответа PUT — при
     * неудачном сохранении запись аудита уже улетала во flush, а эталон уже
     * съезжал на пост-правочное состояние, и правка терялась безвозвратно).
     * Коммитится в _snapshot только через confirmSave().
     */
    static _pendingSnapshot = null;

    /**
     * Отпечаток текстового под-поля (reasons/measures/consequences/responsible).
     * @param {Object} field
     * @returns {{enabled: boolean, content: string}}
     */
    static _textField(field) {
        const f = field || {};
        return { enabled: !!f.enabled, content: f.content || '' };
    }

    /**
     * Отпечаток одного элемента доп.материалов БЕЗ бинарных данных картинки.
     * Кейс/текст — id+тип+content; картинка — id+тип+подпись+имя+ширина
     * (url с base64 намеренно исключён, см. модульный комментарий).
     * @param {Object} item
     * @returns {Object}
     */
    static _itemFingerprint(item) {
        if (!item || typeof item !== 'object') return { id: null, type: null };
        if (item.type === 'image') {
            return {
                id: item.id,
                type: item.type,
                caption: item.caption || '',
                filename: item.filename || '',
                width: item.width || 0,
            };
        }
        return { id: item.id, type: item.type, content: item.content || '' };
    }

    /**
     * Нормализованный отпечаток нарушения (строка) — все восемь полей, но без
     * base64-байтов картинок. Порядок ключей фиксирован → стабильная сериализация.
     * @param {Object} violation
     * @returns {string}
     */
    static fingerprint(violation) {
        if (!violation || typeof violation !== 'object') return '';
        const dl = violation.descriptionList || {};
        const ac = violation.additionalContent || {};
        return JSON.stringify({
            violated: violation.violated || '',
            established: violation.established || '',
            descriptionList: {
                enabled: !!dl.enabled,
                items: Array.isArray(dl.items) ? dl.items : [],
            },
            additionalContent: {
                enabled: !!ac.enabled,
                items: Array.isArray(ac.items) ? ac.items.map(i => this._itemFingerprint(i)) : [],
            },
            reasons: this._textField(violation.reasons),
            measures: this._textField(violation.measures),
            consequences: this._textField(violation.consequences),
            responsible: this._textField(violation.responsible),
        });
    }

    /**
     * Снимает эталон при загрузке акта. Перезаписывает предыдущий снимок целиком
     * — switch акта переустанавливает эталон новым load'ом (см. api.js).
     * @param {Object<string, Object>} violations
     */
    static snapshot(violations) {
        this._snapshot = new Map();
        if (!violations || typeof violations !== 'object') return;
        for (const [id, v] of Object.entries(violations)) {
            this._snapshot.set(id, this.fingerprint(v));
        }
    }

    /** Полный сброс снимка (teardown / тесты). */
    static reset() {
        this._snapshot = new Map();
        this._pendingSnapshot = null;
    }

    /**
     * Синтез записей modify_violation: одна запись на каждое нарушение, чей
     * отпечаток отличается от снимка. Свежий отпечаток кандидата откладывается
     * в _pendingSnapshot — эталон (_snapshot) НЕ трогается здесь (#5: сдвиг
     * эталона до подтверждения сохранения терял правку при неудачном PUT).
     * Коммит эталона — через confirmSave() из вызывающей стороны при resp.ok.
     * Новые нарушения (нет в снимке) в modify НЕ попадают — их фиксирует
     * add_violation при создании.
     * @param {Object<string, Object>} violations - текущее AppState.violations
     */
    static synthesize(violations) {
        if (!violations || typeof violations !== 'object') return;
        const pending = new Map();
        for (const [id, v] of Object.entries(violations)) {
            const fp = this.fingerprint(v);
            if (this._snapshot.has(id) && fp !== this._snapshot.get(id)) {
                ChangelogTracker.record('modify_violation', id, 'Нарушение');
            }
            pending.set(id, fp);
        }
        // Кандидат на новый эталон — коммитится только через confirmSave().
        this._pendingSnapshot = pending;
    }

    /**
     * Подтверждает успешное сохранение: коммитит отложенный снимок в эталон.
     * Вызывается ТОЛЬКО из success-ветки PUT /content (никогда из catch/finally)
     * — при неудачном сохранении _snapshot остаётся прежним, и следующий
     * synthesize() заново обнаружит и запишет ту же правку.
     */
    static confirmSave() {
        if (this._pendingSnapshot) {
            this._snapshot = this._pendingSnapshot;
            this._pendingSnapshot = null;
        }
    }
}

// Pre-flush hook: синтез diff-аудита на всех flush-сайтах (авто/ручной/сессия).
// Читает актуальные нарушения из AppState на момент flush.
ChangelogTracker.registerPreFlushHook(() => {
    const violations = (typeof window !== 'undefined' && window.AppState)
        ? window.AppState.violations
        : null;
    ViolationAudit.synthesize(violations);
});

// Window-global для совместимости с inline-скриптами и диагностики.
if (typeof window !== 'undefined') {
    window.ViolationAudit = ViolationAudit;
}
