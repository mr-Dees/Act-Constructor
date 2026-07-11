/**
 * Состояние представления таблицы (видимость колонок + ширины + произвольные
 * extra-флаги) с persist в localStorage. Доменно-агностично: ключ хранилища и
 * набор колонок передаются снаружи. Невалидное состояние молча откатывается к дефолту.
 */
export class TableViewState {
  /**
   * @param {Object} opts
   * @param {string} opts.storageKey ключ localStorage (включает версию схемы)
   * @param {Array} opts.columns массив колонок {key, width, hidden?}
   * @param {Object} [opts.storage] хранилище (по умолчанию window.localStorage)
   */
  constructor({ storageKey, columns, storage }) {
    this._key = storageKey;
    this._order = columns.map(c => c.key);
    this._defaultWidth = Object.fromEntries(columns.map(c => [c.key, c.width]));
    this._storage = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    // Колонки с флагом hidden:true скрыты по умолчанию (напр. служебные ID/Создано/Изменено);
    // пользователь может включить их через панель видимости, состояние тогда осядет в localStorage.
    this._defaultHidden = new Set(columns.filter(c => c.hidden).map(c => c.key));
    this._hidden = new Set(this._defaultHidden);
    this._widths = {};
    this._load();
  }

  _load() {
    try {
      const raw = this._storage && this._storage.getItem(this._key);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.v !== 2) return; // старое (v1) / битое состояние — остаёмся на дефолте
      if (Array.isArray(data.hidden) && Array.isArray(data.known)) {
        // Персист хранит СКРЫТЫЕ ключи + снимок всех известных ключей (`known`) на момент сохранения.
        // Для колонок, что были в снимке, уважаем сохранённое решение (скрыта ↔ в `hidden`).
        // Для новых колонок (которых в снимке не было) берём их дефолт из `_defaultHidden`:
        // так новая default-visible колонка показывается, а новая hidden:true — прячется.
        const savedHidden = new Set(data.hidden);
        const known = new Set(data.known);
        const hidden = new Set();
        for (const k of this._order) {
          if (known.has(k)) {
            if (savedHidden.has(k)) hidden.add(k);
          } else if (this._defaultHidden.has(k)) {
            hidden.add(k);
          }
        }
        this._hidden = hidden;
      }
      if (data.widths && typeof data.widths === 'object') this._widths = { ...data.widths };
      if (data.extra && typeof data.extra === 'object') this._extra = { ...data.extra };
    } catch {
      /* битое состояние — остаёмся на дефолте */
    }
  }

  _save() {
    if (!this._storage) return;
    const hidden = this._order.filter(k => this._hidden.has(k));
    try {
      this._storage.setItem(
        this._key,
        JSON.stringify({ v: 2, hidden, known: [...this._order], widths: this._widths, extra: this._extra || {} }),
      );
    } catch {
      /* переполнение квоты — игнорируем */
    }
  }

  getVisibleKeys() { return this._order.filter(k => !this._hidden.has(k)); }
  isVisible(key) { return !this._hidden.has(key); }

  setVisible(key, on) {
    if (on) {
      this._hidden.delete(key);
    } else {
      if (this.getVisibleKeys().length <= 1 && this.isVisible(key)) return; // нельзя скрыть последнюю
      this._hidden.add(key);
    }
    this._save();
  }

  setAllVisible(on) {
    if (on) {
      this._hidden = new Set();
    } else {
      // Оставляем первую ВИДИМУЮ-ПО-УМОЛЧАНИЮ колонку (не служебную hidden:true).
      const keep = this._order.find(k => !this._defaultHidden.has(k)) ?? this._order[0];
      this._hidden = new Set(this._order.filter(k => k !== keep));
    }
    this._save();
  }

  getWidth(key) { return this._widths[key] != null ? this._widths[key] : this._defaultWidth[key]; }
  setWidth(key, px) { this._widths[key] = Math.round(px); this._save(); }

  /** Произвольные доменные флаги представления (например, вид развертки ТБ). */
  getExtra(key, def) {
    return this._extra && key in this._extra ? this._extra[key] : def;
  }

  setExtra(key, value) {
    this._extra = { ...(this._extra || {}), [key]: value };
    this._save();
  }

  /** Полный сброс к дефолту: видимость, ширины И доменные extra-флаги —
   * иначе сброшенный вид после перезагрузки молча возвращался бы к
   * сохранённому extra-состоянию (например, режиму развертки ТБ). */
  resetToDefault() {
    this._hidden = new Set(this._defaultHidden);
    this._widths = {};
    this._extra = {};
    this._save();
  }
}

if (typeof window !== 'undefined') window.TableViewState = TableViewState;
