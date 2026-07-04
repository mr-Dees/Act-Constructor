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
   * @param {function} opts.fetchPage async ({filters,sort,limit,offset,signal}) => {items, total}
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
      filters: {}, sort: [], limit: this._cap, offset: 0,
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

  async fetchServerPage({ filters, sort, page, pageSize }) {
    // Единый источник размера страницы — DataTable (передаёт свой pageSize).
    // Ctor-значение остаётся fallback'ом, чтобы offset/limit не расходились.
    const size = pageSize || this._pageSize || this._cap;
    const offset = (Math.max(1, page) - 1) * size;
    const res = await this._fetchPage({ filters, sort, limit: size, offset });
    this._total = res.total;
    return res;
  }
}

if (typeof window !== 'undefined') window.DataSource = DataSource;
