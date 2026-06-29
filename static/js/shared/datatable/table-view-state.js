/**
 * Состояние представления таблицы (видимость колонок + ширины) с persist в
 * localStorage. Доменно-агностично: ключ хранилища и набор колонок передаются
 * снаружи. Невалидное состояние молча откатывается к дефолту.
 */
export class TableViewState {
  /**
   * @param {Object} opts
   * @param {string} opts.storageKey ключ localStorage (включает версию схемы)
   * @param {Array} opts.columns массив колонок {key, width}
   * @param {Object} [opts.storage] хранилище (по умолчанию window.localStorage)
   */
  constructor({ storageKey, columns, storage }) {
    this._key = storageKey;
    this._order = columns.map(c => c.key);
    this._defaultWidth = Object.fromEntries(columns.map(c => [c.key, c.width]));
    this._storage = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    this._hidden = new Set();
    this._widths = {};
    this._load();
  }

  _load() {
    try {
      const raw = this._storage && this._storage.getItem(this._key);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1) return;
      if (Array.isArray(data.visible)) {
        const vis = new Set(data.visible);
        this._hidden = new Set(this._order.filter(k => !vis.has(k)));
      }
      if (data.widths && typeof data.widths === 'object') this._widths = { ...data.widths };
    } catch {
      /* битое состояние — остаёмся на дефолте */
    }
  }

  _save() {
    if (!this._storage) return;
    const visible = this._order.filter(k => !this._hidden.has(k));
    try {
      this._storage.setItem(this._key, JSON.stringify({ v: 1, visible, widths: this._widths }));
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
    if (on) this._hidden = new Set();
    else this._hidden = new Set(this._order.slice(1)); // оставить первую колонку
    this._save();
  }

  getWidth(key) { return this._widths[key] != null ? this._widths[key] : this._defaultWidth[key]; }
  setWidth(key, px) { this._widths[key] = Math.round(px); this._save(); }

  resetToDefault() { this._hidden = new Set(); this._widths = {}; this._save(); }
}

if (typeof window !== 'undefined') window.TableViewState = TableViewState;
