/**
 * Оркестратор generic-таблицы: рендер только ВИДИМЫХ колонок, фильтр прямо в
 * заголовке-поле (имя колонки всплывает мини-меткой при вводе), НАКАПЛИВАЮЩАЯ
 * мультисортировка по клику (каждый клик добавляет колонку в набор; цикл колонки
 * возр. → убыв. → убрать; приоритет показан номером), подсветка колонки, ресайз,
 * обрезка+поповер, выделение строки, пагинация. Источник — DataSource (client/server).
 *
 * Фильтр — типизированный по колонке (FilterSpec, канон — СЫРЬЁ): текст/число →
 * contains, словарь → in (имя разрешается в id через col.filterResolve), дата →
 * range (от/до), checkbox → eq. Одна и та же семантика в client- и server-mode.
 */
import { filterRows, sortRowsMulti, paginate } from './datatable-logic.js';
import { attachColumnResize } from './column-resize.js';
import { showCellPopover, isTruncated } from './cell-popover.js';

/** Нормализация числового ввода: убрать пробелы, запятую → точку. */
function normNumeric(s) {
  return String(s).replace(/\s+/g, '').replace(',', '.');
}

export class DataTable {
  /**
   * @param {Object} opts
   * @param {HTMLElement} opts.mountEl контейнер таблицы
   * @param {HTMLElement} [opts.footerEl] контейнер «Всего: N» + пагинация
   * @param {Array} opts.columns ВСЕ колонки (ColumnDef[])
   * @param {Object} opts.viewState TableViewState
   * @param {Object} opts.dataSource DataSource
   * @param {Object} [opts.dicts] справочники для format/filterResolve
   * @param {number} [opts.pageSize=50] ЕДИНЫЙ источник размера страницы (передаётся и в DataSource)
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
    this._filters = {};      // dict[colKey → FilterSpec] — для логики и wire
    this._filterText = {};   // dict[colKey → строка | {from,to}] — состояние UI-контрола
    this._sort = [];         // упорядоченный по приоритету список {key, dir}
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

  // #6: фильтры скрытых колонок сбрасываются (спрятал — значит не нужно; иначе
  // фильтр действовал бы «вслепую» без видимого контрола).
  _pruneHiddenFilters(visibleKeys) {
    const vis = new Set(visibleKeys);
    for (const k of Object.keys(this._filters)) if (!vis.has(k)) delete this._filters[k];
    for (const k of Object.keys(this._filterText)) if (!vis.has(k)) delete this._filterText[k];
  }

  /** Построить FilterSpec из типизированного текстового ввода. null → нет фильтра. */
  _specFromText(col, text) {
    const t = String(text ?? '');
    if (!t.trim()) return null;
    if (col.type === 'dictionary' && typeof col.filterResolve === 'function') {
      const ids = (col.filterResolve(t, this._dicts) || []).map(String);
      return { op: 'in', values: ids }; // пустой массив → «совпадений нет»
    }
    if (col.type === 'number') return { op: 'contains', value: normNumeric(t) };
    return { op: 'contains', value: t };
  }

  /** FilterSpec диапазона по датам (от/до). null → нет фильтра. */
  _specFromRange(from, to) {
    const f = (from || '').trim();
    const t = (to || '').trim();
    if (!f && !t) return null;
    return { op: 'range', cast: 'date', from: f || null, to: t || null };
  }

  _setFilterSpec(key, spec) {
    if (spec == null) delete this._filters[key];
    else this._filters[key] = spec;
    this._page = 1;
    this._scheduleBody();
  }

  /**
   * Ячейка заголовка = поле поиска по колонке (тип контрола зависит от типа
   * колонки) + каретка 3-позиционной сортировки + крестик очистки. Имя колонки
   * видно как placeholder/мини-метка; активный фильтр подсвечивает `.dt-th--filtered`.
   * Активная сортировка помечается `aria-sort` только на ВЕДУЩЕЙ колонке набора.
   */
  _buildHeaderCell(col) {
    const th = document.createElement('th');
    th.dataset.key = col.key;
    th.style.width = `${this._view.getWidth(col.key)}px`;

    const cell = document.createElement('div');
    cell.className = 'dt-th-cell';

    const field = document.createElement('div');
    field.className = 'dt-th-field';

    const floatLabel = document.createElement('span');
    floatLabel.className = 'dt-th-floatlabel';
    floatLabel.textContent = col.label;
    floatLabel.title = col.description || col.label;
    floatLabel.setAttribute('aria-hidden', 'true');

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'dt-th-clear';
    clearBtn.textContent = '✕';
    clearBtn.title = 'Очистить фильтр';
    clearBtn.setAttribute('aria-label', `Очистить фильтр: ${col.label}`);

    // Контрол фильтра по типу колонки. Каждый вариант отдаёт control-элемент,
    // isFilled() и clearControl().
    const built = this._buildFilterControl(col);
    const { control } = built;

    // date/checkbox не имеют внятного placeholder — имя колонки показываем всегда.
    const floatAlways = col.type === 'date' || col.type === 'checkbox';
    const syncFilter = () => {
      const filled = built.isFilled();
      field.classList.toggle('dt-th-field--float', filled || floatAlways);
      th.classList.toggle('dt-th--filtered', filled);
      clearBtn.style.display = filled ? '' : 'none';
    };
    built.onChange = syncFilter;

    clearBtn.addEventListener('click', () => {
      built.clearControl();
      this._setFilterSpec(col.key, null);
      syncFilter();
    });

    const sortBtn = document.createElement('button');
    sortBtn.type = 'button';
    sortBtn.className = 'dt-th-sort';
    sortBtn.title = 'Клик добавляет колонку к сортировке (клики накапливаются)';
    sortBtn.setAttribute('aria-label', `Сортировать по колонке: ${col.label}`);
    sortBtn.addEventListener('click', () => this.setSort(col.key));

    const si = this._sort.findIndex(s => s.key === col.key);
    const dir = si >= 0 ? this._sort[si].dir : null;
    if (dir) {
      th.classList.add('dt-th--sorted');
      sortBtn.classList.add('active');
      if (si === 0) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
    }
    sortBtn.textContent = dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕';

    let priorityEl = null;
    if (si >= 0 && this._sort.length >= 2) {
      priorityEl = document.createElement('span');
      priorityEl.className = 'dt-th-priority';
      priorityEl.textContent = String(si + 1);
      priorityEl.setAttribute('aria-hidden', 'true');
    }

    field.appendChild(floatLabel);
    field.appendChild(control);
    cell.appendChild(field);
    cell.appendChild(clearBtn);
    cell.appendChild(sortBtn);
    if (priorityEl) cell.appendChild(priorityEl);
    th.appendChild(cell);

    syncFilter();
    return th;
  }

  /**
   * Контрол фильтра под тип колонки. Возвращает {control, isFilled, clearControl}.
   * onChange проставляется вызывающим (syncFilter) и дёргается на каждое изменение.
   */
  _buildFilterControl(col) {
    const box = { onChange: () => {} };

    if (col.type === 'date') {
      const wrap = document.createElement('div');
      wrap.className = 'dt-th-range';
      const from = document.createElement('input');
      from.type = 'date';
      from.className = 'dt-th-filter dt-th-range-from';
      from.setAttribute('aria-label', `Фильтр от: ${col.label}`);
      const to = document.createElement('input');
      to.type = 'date';
      to.className = 'dt-th-filter dt-th-range-to';
      to.setAttribute('aria-label', `Фильтр до: ${col.label}`);
      const st = this._filterText[col.key] || {};
      from.value = st.from || '';
      to.value = st.to || '';
      const onInput = () => {
        this._filterText[col.key] = { from: from.value, to: to.value };
        this._setFilterSpec(col.key, this._specFromRange(from.value, to.value));
        box.onChange();
      };
      from.addEventListener('input', onInput);
      to.addEventListener('input', onInput);
      wrap.appendChild(from);
      wrap.appendChild(to);
      box.control = wrap;
      box.isFilled = () => { const s = this._filterText[col.key] || {}; return !!(s.from || s.to); };
      box.clearControl = () => { from.value = ''; to.value = ''; this._filterText[col.key] = { from: '', to: '' }; };
      return box;
    }

    if (col.type === 'checkbox') {
      const sel = document.createElement('select');
      sel.className = 'dt-th-filter dt-th-select';
      sel.setAttribute('aria-label', `Фильтр по колонке: ${col.label}`);
      for (const [v, label] of [['', 'Все'], ['true', 'Да'], ['false', 'Нет']]) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = label;
        sel.appendChild(o);
      }
      sel.value = typeof this._filterText[col.key] === 'string' ? this._filterText[col.key] : '';
      sel.addEventListener('change', () => {
        this._filterText[col.key] = sel.value;
        this._setFilterSpec(col.key, sel.value ? { op: 'eq', value: sel.value } : null);
        box.onChange();
      });
      box.control = sel;
      box.isFilled = () => !!(this._filterText[col.key] && String(this._filterText[col.key]));
      box.clearControl = () => { sel.value = ''; this._filterText[col.key] = ''; };
      return box;
    }

    // text / textarea / id / number / dictionary — один текст-инпут.
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dt-th-filter';
    input.placeholder = col.label;
    input.title = col.description || col.label;
    input.value = typeof this._filterText[col.key] === 'string' ? this._filterText[col.key] : '';
    input.setAttribute('aria-label', `Фильтр по колонке: ${col.label}`);
    input.addEventListener('input', () => {
      this._filterText[col.key] = input.value;
      this._setFilterSpec(col.key, this._specFromText(col, input.value));
      box.onChange();
    });
    box.control = input;
    box.isFilled = () => !!(this._filterText[col.key] && String(this._filterText[col.key]).trim());
    box.clearControl = () => { input.value = ''; this._filterText[col.key] = ''; };
    return box;
  }

  async render() {
    clearTimeout(this._debounce); // #14: снять отложенный _renderBody, чтобы он не выстрелил после
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

  /** Публичный простой сеттер (contains). Для типизированных фильтров UI строит спек сам. */
  setFilter(key, value) {
    this._filterText[key] = value;
    this._setFilterSpec(key, value ? { op: 'contains', value: String(value) } : null);
  }

  // Клик по сортировке НАКАПЛИВАЕТ колонки: новая добавляется в конец набора,
  // повторные клики по уже входящей крутят цикл возр. → убыв. → убрать.
  setSort(key) {
    const i = this._sort.findIndex(s => s.key === key);
    if (i === -1) this._sort.push({ key, dir: 'asc' });
    else if (this._sort[i].dir === 'asc') this._sort[i].dir = 'desc';
    else this._sort.splice(i, 1);
    this._page = 1;
    this.render();
  }

  setPage(page) { clearTimeout(this._debounce); this._page = page; this._renderBody(); }

  // Сброс фильтров обнуляет и сортировку (возврат к исходному порядку).
  clearFilters() {
    this._filters = {};
    this._filterText = {};
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
    this._pruneHiddenFilters(cols.map(c => c.key)); // #6
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
      totalPages = Math.max(1, Math.ceil(total / this._pageSize));
      this._page = Math.min(Math.max(1, this._page), totalPages); // #7: кламп страницы
      const pg = paginate(data, this._page, this._pageSize);
      rows = pg.pageRows;
    } else {
      // seq-guard: на гонке фильтров игнорируем устаревший ответ.
      const seq = ++this._reqSeq;
      try {
        const res = await this._ds.fetchServerPage({
          filters: this._filters,
          sort: this._sort,
          page: this._page,
          pageSize: this._pageSize, // #12: единый размер страницы
        });
        if (seq !== this._reqSeq) return;
        total = res.total;
        totalPages = Math.max(1, Math.ceil(total / this._pageSize));
        if (this._page > totalPages) { // #7: страница уехала за диапазон (напр. после удаления)
          this._page = totalPages;
          return this._renderBody();
        }
        rows = res.items;
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

  // Окно номеров страниц вокруг текущей (со «сжатием» краёв через первую/последнюю
  // + «…»), чтобы текущая страница всегда была достижима по номеру (#8).
  _pageWindow(current, totalPages) {
    const span = 2;
    let start = Math.max(1, current - span);
    let end = Math.min(totalPages, current + span);
    const width = Math.min(2 * span, totalPages - 1);
    while (end - start < width) {
      if (start > 1) start--;
      else if (end < totalPages) end++;
      else break;
    }
    const pages = [];
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

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
      const mkGap = () => {
        const s = document.createElement('span');
        s.className = 'dt-page-gap';
        s.textContent = '…';
        return s;
      };
      nav.appendChild(mkBtn('◀', this._page - 1, this._page <= 1, false));
      const win = this._pageWindow(this._page, totalPages);
      if (win[0] > 1) {
        nav.appendChild(mkBtn('1', 1, false, this._page === 1));
        if (win[0] > 2) nav.appendChild(mkGap());
      }
      for (const i of win) nav.appendChild(mkBtn(String(i), i, false, i === this._page));
      const last = win[win.length - 1];
      if (last < totalPages) {
        if (last < totalPages - 1) nav.appendChild(mkGap());
        nav.appendChild(mkBtn(String(totalPages), totalPages, false, this._page === totalPages));
      }
      nav.appendChild(mkBtn('▶', this._page + 1, this._page >= totalPages, false));
      this._footer.appendChild(nav);
    }
  }
}

if (typeof window !== 'undefined') window.DataTable = DataTable;
