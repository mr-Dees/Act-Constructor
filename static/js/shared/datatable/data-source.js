/**
 * Адаптивный источник данных таблицы.
 *
 * client-mode: на старте получен ВЕСЬ набор (items >= total) → фильтр/сорт/
 *   пагинация делаются в памяти вызывающим кодом.
 * server-mode: набор больше рабочего кэша → каждая страница тянется с бэка
 *   с фильтрами/сортировкой.
 */
export class DataSource {
  /**
   * @param {Object} opts
   * @param {function} opts.fetchPage async ({filters,sortBy,sortDir,limit,offset,signal}) => {items, total}
   * @param {number} opts.pageSize размер страницы
   * @param {number} opts.workingSetCap граница загрузки в client-mode
   */
  constructor({ fetchPage, pageSize, workingSetCap }) {
    this._fetchPage = fetchPage;
    this._pageSize = pageSize;
    this._cap = workingSetCap;
    this._mode = null;
    this._total = 0;
    this._all = [];
  }

  async init() {
    const { items, total } = await this._fetchPage({
      filters: {}, sortBy: null, sortDir: 'asc', limit: this._cap, offset: 0,
    });
    this._total = total;
    if (items.length >= total) {
      this._mode = 'client';
      this._all = items;
    } else {
      this._mode = 'server';
      this._all = [];
    }
  }

  get mode() { return this._mode; }
  get total() { return this._total; }
  getAllRows() { return this._all; }

  async fetchServerPage({ filters, sortBy, sortDir, page, signal }) {
    const offset = (Math.max(1, page) - 1) * this._pageSize;
    const res = await this._fetchPage({ filters, sortBy, sortDir, limit: this._pageSize, offset, signal });
    this._total = res.total;
    return res;
  }
}

if (typeof window !== 'undefined') window.DataSource = DataSource;
