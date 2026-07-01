/**
 * Оркестратор generic-таблицы: рендер только ВИДИМЫХ колонок, фильтр прямо в
 * заголовке-поле (имя колонки всплывает мини-меткой при вводе), НАКАПЛИВАЮЩАЯ
 * мультисортировка по клику (каждый клик добавляет колонку в набор; цикл колонки
 * возр. → убыв. → убрать; приоритет показан номером), подсветка колонки, ресайз,
 * обрезка+поповер, выделение строки, пагинация. Источник — DataSource (client/server).
 */
import { filterRows, sortRowsMulti, paginate } from './datatable-logic.js';
import { attachColumnResize } from './column-resize.js';
import { showCellPopover, isTruncated } from './cell-popover.js';

export class DataTable {
  /**
   * @param {Object} opts
   * @param {HTMLElement} opts.mountEl контейнер таблицы
   * @param {HTMLElement} [opts.footerEl] контейнер «Всего: N» + пагинация
   * @param {Array} opts.columns ВСЕ колонки (ColumnDef[])
   * @param {Object} opts.viewState TableViewState
   * @param {Object} opts.dataSource DataSource
   * @param {Object} [opts.dicts] справочники для format
   * @param {number} [opts.pageSize=50]
   * @param {Function} [opts.onRowSelect] callback(record)
   */
  constructor({ mountEl, footerEl, columns, viewState, dataSource, dicts, pageSize, onRowSelect }) {
    this._mount = mountEl;
    this._footer = footerEl || null;
    this._columns = columns;
    this._view = viewState;
    this._ds = dataSource;
    this._dicts = dicts || {};
    this._pageSize = pageSize || 50;
    this._onRowSelect = onRowSelect;
    this._filters = {};
    this._sort = []; // упорядоченный по приоритету список {key, dir} (мультисортировка)
    this._page = 1;
    this._selectedId = null;
    this._debounce = null;
    this._reqSeq = 0;
    this._tbody = null;
  }

  _visibleColumns() {
    const vis = new Set(this._view.getVisibleKeys());
    return this._columns.filter(c => vis.has(c.key));
  }

  getVisibleColumns() { return this._visibleColumns(); }

  /**
   * Ячейка заголовка = поле поиска по колонке + каретка 3-позиционной
   * сортировки + крестик очистки. Имя колонки видно как placeholder, пока
   * фильтр пуст; как только в нём есть текст — имя «всплывает» мини-меткой
   * над полем (`.dt-th-field--float`), а ячейка подсвечивается
   * (`.dt-th--filtered`). Активная сортировка помечается `aria-sort` на самой
   * `th` — с него же берётся CSS-подсветка отсортированной колонки.
   */
  _buildHeaderCell(col) {
    const th = document.createElement('th');
    th.dataset.key = col.key;
    th.style.width = `${this._view.getWidth(col.key)}px`;

    const cell = document.createElement('div');
    cell.className = 'dt-th-cell';

    // Поле фильтра + всплывающая мини-метка имени колонки.
    const field = document.createElement('div');
    field.className = 'dt-th-field';

    const floatLabel = document.createElement('span');
    floatLabel.className = 'dt-th-floatlabel';
    floatLabel.textContent = col.label;
    floatLabel.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dt-th-filter';
    input.placeholder = col.label; // имя колонки видно, пока поле пустое
    input.title = col.label;
    input.value = this._filters[col.key] || '';
    input.setAttribute('aria-label', `Фильтр по колонке: ${col.label}`);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'dt-th-clear';
    clearBtn.textContent = '✕';
    clearBtn.title = 'Очистить фильтр';
    clearBtn.setAttribute('aria-label', `Очистить фильтр: ${col.label}`);

    const sortBtn = document.createElement('button');
    sortBtn.type = 'button';
    sortBtn.className = 'dt-th-sort';
    sortBtn.title = 'Клик добавляет колонку к сортировке (клики накапливаются)';
    sortBtn.setAttribute('aria-label', `Сортировать по колонке: ${col.label}`);
    // Клик накапливает колонки в наборе сортировки (без модификаторов).
    sortBtn.addEventListener('click', () => this.setSort(col.key));

    // Позиция колонки в наборе сортировки (−1 — не участвует) и её направление.
    const si = this._sort.findIndex(s => s.key === col.key);
    const dir = si >= 0 ? this._sort[si].dir : null;
    if (dir) {
      th.classList.add('dt-th--sorted'); // подсветка всех колонок набора
      sortBtn.classList.add('active');
      // aria-sort — только на ВЕДУЩЕЙ колонке набора (по ARIA-спеке — одна).
      if (si === 0) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
    }
    sortBtn.textContent = dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕';

    // Номер приоритета показываем только при мультисортировке (≥2 колонок).
    let priorityEl = null;
    if (si >= 0 && this._sort.length >= 2) {
      priorityEl = document.createElement('span');
      priorityEl.className = 'dt-th-priority';
      priorityEl.textContent = String(si + 1);
      priorityEl.setAttribute('aria-hidden', 'true');
    }

    // Имя колонки «всплывает», как только в фильтре появляется текст.
    const syncFilter = () => {
      const filled = !!input.value.trim();
      field.classList.toggle('dt-th-field--float', filled);
      th.classList.toggle('dt-th--filtered', filled);
      clearBtn.style.display = filled ? '' : 'none';
    };

    input.addEventListener('input', () => {
      this.setFilter(col.key, input.value);
      syncFilter();
    });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      this.setFilter(col.key, '');
      syncFilter();
      input.focus();
    });

    field.appendChild(floatLabel);
    field.appendChild(input);
    cell.appendChild(field);
    cell.appendChild(clearBtn);
    cell.appendChild(sortBtn);
    if (priorityEl) cell.appendChild(priorityEl);
    th.appendChild(cell);

    syncFilter();
    return th;
  }

  async render() {
    const cols = this._visibleColumns();
    this._mount.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'dt-wrapper';
    const table = document.createElement('table');
    table.className = 'dt-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.className = 'dt-head-row';
    for (const col of cols) headRow.appendChild(this._buildHeaderCell(col));
    thead.appendChild(headRow);

    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.className = 'dt-body';
    table.appendChild(tbody);
    this._tbody = tbody;

    wrapper.appendChild(table);
    this._mount.appendChild(wrapper);

    attachColumnResize({ theadEl: thead, columns: cols, viewState: this._view });

    await this._renderBody();
  }

  refresh() { this._page = 1; this.render(); }

  setFilter(key, value) {
    this._filters[key] = value;
    this._page = 1;
    this._scheduleBody();
  }

  // Клик по сортировке НАКАПЛИВАЕТ колонки: новая колонка добавляется в конец
  // набора (её приоритет — порядок кликов), повторные клики по уже входящей
  // колонке крутят её цикл возр. → убыв. → убрать. Модификаторы не нужны —
  // «нажал одну, затем вторую» даёт составную сортировку (напр. по ID, затем по
  // дате). Полный сброс набора — через «Очистить фильтры» (clearFilters).
  setSort(key) {
    const i = this._sort.findIndex(s => s.key === key);
    if (i === -1) this._sort.push({ key, dir: 'asc' });              // добавить колонку в набор
    else if (this._sort[i].dir === 'asc') this._sort[i].dir = 'desc'; // возр. → убыв.
    else this._sort.splice(i, 1);                                     // убыв. → убрать из набора
    this._page = 1;
    this.render();
  }

  setPage(page) { this._page = page; this._renderBody(); }

  // Сброс фильтров обнуляет и сортировку (возврат к исходному порядку).
  clearFilters() {
    this._filters = {};
    this._sort = [];
    this._page = 1;
    this.render();
  }

  _scheduleBody() {
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this._renderBody(), 300);
  }

  async _renderBody() {
    const cols = this._visibleColumns();
    let rows;
    let total;
    let totalPages;

    if (this._ds.mode === 'client') {
      let data = filterRows(this._ds.getAllRows(), cols, this._filters, this._dicts);
      if (this._sort.length) {
        const specs = this._sort
          .map(s => ({ column: this._columns.find(c => c.key === s.key), dir: s.dir }))
          .filter(s => s.column);
        data = sortRowsMulti(data, specs);
      }
      total = data.length;
      const pg = paginate(data, this._page, this._pageSize);
      rows = pg.pageRows;
      totalPages = pg.totalPages;
    } else {
      // seq-guard: на гонке фильтров игнорируем устаревший ответ, чтобы он не
      // перезатёр результат более позднего запроса.
      const seq = ++this._reqSeq;
      try {
        const res = await this._ds.fetchServerPage({
          filters: this._filters,
          sort: this._sort,
          page: this._page,
        });
        if (seq !== this._reqSeq) return;
        rows = res.items;
        total = res.total;
        totalPages = Math.max(1, Math.ceil(total / this._pageSize));
      } catch (e) {
        if (seq !== this._reqSeq) return;
        rows = []; total = 0; totalPages = 1;
      }
    }

    this._paintRows(rows, cols);
    this._renderFooter(total, totalPages);
  }

  _paintRows(rows, cols) {
    if (!this._tbody) return;
    this._tbody.innerHTML = '';
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'dt-empty';
      td.colSpan = cols.length;
      td.textContent = 'Нет записей';
      tr.appendChild(td);
      this._tbody.appendChild(tr);
      return;
    }
    for (const record of rows) {
      const tr = document.createElement('tr');
      tr.dataset.id = record.id;
      if (record.id === this._selectedId) tr.classList.add('selected');
      for (const col of cols) {
        const td = document.createElement('td');
        const raw = record[col.key];
        const text = col.format ? col.format(raw, this._dicts) : (raw == null ? '' : String(raw));
        td.textContent = text;
        td.title = text;
        td.style.width = `${this._view.getWidth(col.key)}px`;
        if (col.align === 'right') td.classList.add('align-right');
        if (col.align === 'center') td.classList.add('align-center');
        if (col.longText) {
          td.classList.add('dt-clickable');
          td.addEventListener('click', (e) => {
            if (!isTruncated(td)) return; // не обрезан — пусть клик выделит строку
            e.stopPropagation();
            showCellPopover(td, text);
          });
        }
        tr.appendChild(td);
      }
      tr.addEventListener('click', () => {
        this._selectedId = record.id;
        this._updateSelection();
        if (this._onRowSelect) this._onRowSelect(record);
      });
      this._tbody.appendChild(tr);
    }
  }

  _updateSelection() {
    if (!this._tbody || !this._tbody.children) return;
    for (const row of this._tbody.children) {
      if (String(row.dataset.id) === String(this._selectedId)) row.classList.add('selected');
      else row.classList.remove('selected');
    }
  }

  selectRow(id) { this._selectedId = id; this._updateSelection(); }
  clearSelection() { this._selectedId = null; this._updateSelection(); }
  applyWidths() { this.render(); }

  _renderFooter(total, totalPages) {
    if (!this._footer) return;
    this._footer.innerHTML = '';
    const info = document.createElement('span');
    info.className = 'dt-total';
    info.innerHTML = `Всего: <b>${total}</b>`;
    this._footer.appendChild(info);
    if (totalPages > 1) {
      const nav = document.createElement('div');
      nav.className = 'dt-pagination';
      const mkBtn = (label, page, disabled, active) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dt-page-btn' + (active ? ' active' : '');
        b.textContent = label;
        if (disabled) b.disabled = true;
        else b.addEventListener('click', () => this.setPage(page));
        return b;
      };
      nav.appendChild(mkBtn('◀', this._page - 1, this._page <= 1, false));
      for (let i = 1; i <= totalPages && i <= 10; i++) nav.appendChild(mkBtn(String(i), i, false, i === this._page));
      nav.appendChild(mkBtn('▶', this._page + 1, this._page >= totalPages, false));
      this._footer.appendChild(nav);
    }
  }
}

if (typeof window !== 'undefined') window.DataTable = DataTable;
