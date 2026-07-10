/**
 * Оркестратор generic-таблицы: рендер только ВИДИМЫХ колонок, фильтр прямо в
 * заголовке-поле (имя колонки всплывает мини-меткой при вводе), НАКАПЛИВАЮЩАЯ
 * мультисортировка по клику (каждый клик добавляет колонку в набор; цикл колонки
 * возр. → убыв. → убрать; приоритет показан номером), подсветка колонки, ресайз,
 * обрезка+поповер, выделение строки, пагинация. Источник — DataSource (client/server).
 *
 * Фильтр — типизированный по колонке (FilterSpec, канон — СЫРЬЁ): текст →
 * чипы-фразы (contains/contains_any), число → диапазон (range), словарь → in
 * (имя разрешается в id через col.filterResolve), дата → range (от/до),
 * checkbox → eq. Одна и та же семантика в client- и server-mode.
 */
import { filterRows, sortRowsMulti, paginate } from './datatable-logic.js';
import { attachColumnResize } from './column-resize.js';
import { showCellPopover, isTruncated } from './cell-popover.js';

/** ISO 'YYYY-MM-DD' → 'DD.MM.YYYY' (без Date — без TZ-сюрпризов). */
function fmtDate(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : String(iso);
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
    this._wrapper = null;    // текущий .dt-wrapper — для переноса scrollLeft/Top при перерисовке
    this._popover = null;    // единственный открытый попап таблицы (оверлей на body)
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
    return { op: 'contains', value: t };
  }

  /** FilterSpec текстового фильтра с чипами: 0 чипов → contains по живому вводу
   * (или null), ≥1 чипа → contains_any по чипам + живому вводу. */
  _specFromTextChips(col, state) {
    const chips = (state.chips || []).filter(c => String(c).trim() !== '');
    if (!chips.length) return this._specFromText(col, state.text);
    const live = String(state.text ?? '').trim();
    return { op: 'contains_any', values: live ? [...chips, live] : [...chips] };
  }

  /** FilterSpec диапазона по датам (от/до). null → нет фильтра. */
  _specFromRange(from, to) {
    const f = (from || '').trim();
    const t = (to || '').trim();
    if (!f && !t) return null;
    return { op: 'range', cast: 'date', from: f || null, to: t || null };
  }

  /** FilterSpec точной даты (Дата СЗ). null → нет фильтра. */
  _specFromSingleDate(v) {
    const s = (v || '').trim();
    return s ? { op: 'eq', value: s } : null;
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
   * Колонка с `noFilter: true` — только подпись и сортировка, без фильтр-контрола.
   * Колонка с `noSort: true` — без кнопки/обработчика сортировки и индикаторов
   * (ключ колонки неизвестен бэкенду, например pivot-колонки ТБ и чипы tb_breakdown).
   */
  _buildHeaderCell(col) {
    const th = document.createElement('th');
    th.dataset.key = col.key;
    th.style.width = `${this._view.getWidth(col.key)}px`;

    const cell = document.createElement('div');
    cell.className = 'dt-th-cell';

    // Сортировка строится ДО ветки noFilter — она нужна и обычным, и
    // noFilter-колонкам (блок зависит только от col и this._sort). Колонка с
    // noSort: true сортировку не получает вовсе — кнопка/обработчик/индикаторы
    // (dt-th--sorted, aria-sort) остаются null/не проставляются.
    let sortBtn = null;
    let priorityEl = null;
    if (!col.noSort) {
      sortBtn = document.createElement('button');
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

      if (si >= 0 && this._sort.length >= 2) {
        priorityEl = document.createElement('span');
        priorityEl.className = 'dt-th-priority';
        priorityEl.textContent = String(si + 1);
        priorityEl.setAttribute('aria-hidden', 'true');
      }
    }

    // Колонки без серверного смысла фильтра (например, pivot-колонки ТБ)
    // получают шапку без фильтр-контрола — только подпись и сортировку.
    if (col.noFilter) {
      const span = document.createElement('span');
      span.className = 'dt-th-label';
      span.textContent = col.label;
      span.title = col.description || col.label;
      cell.appendChild(span);
      if (sortBtn) cell.appendChild(sortBtn);
      if (priorityEl) cell.appendChild(priorityEl);
      th.appendChild(cell);
      return th;
    }

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

    // checkbox не имеет внятного placeholder — имя колонки показываем всегда.
    // date показывает имя прямо в триггере, пока фильтр пуст (floatAlways не нужен).
    // filterPicker=checkbox — по той же причине, что и type checkbox: триггер
    // при пустом выборе показывает «—», а не имя колонки.
    const floatAlways = col.type === 'checkbox' || col.filterPicker === 'checkbox';
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

    field.appendChild(floatLabel);
    field.appendChild(control);
    cell.appendChild(field);
    cell.appendChild(clearBtn);
    if (sortBtn) cell.appendChild(sortBtn);
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

    // Опт-ин попап-фильтры (не зависят от col.type — колонка без filterPicker
    // не задета, падает в ветки ниже как раньше).
    if (col.filterPicker === 'checkbox') return this._buildCheckboxFilter(col, box);
    // number без явного filterPicker тоже получает диапазон по умолчанию (id
    // числовым не считается — остаётся текстовым фильтром).
    if (col.filterPicker === 'numrange' || (!col.filterPicker && col.type === 'number')) return this._buildNumRangeFilter(col, box);

    if (col.type === 'date') {
      // Компактный триггер в одну строку (шапка не растягивается); клик открывает
      // маленький попап-оверлей. Одно поле «Дата» для dateFilter:'single' (Дата СЗ)
      // либо «С»/«По» для диапазона. Активный фильтр показан фразой в триггере.
      const single = col.dateFilter === 'single';
      const container = document.createElement('div');
      container.className = 'dt-th-datewrap';

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'dt-th-filter dt-th-datebtn';
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-label', `Фильтр по дате: ${col.label}`);

      const updateTrigger = () => {
        const st = this._filterText[col.key];
        let phrase = '';
        if (single) {
          phrase = typeof st === 'string' && st ? fmtDate(st) : '';
        } else if (st && (st.from || st.to)) {
          if (st.from && st.to) phrase = `${fmtDate(st.from)} – ${fmtDate(st.to)}`;
          else if (st.from) phrase = `от ${fmtDate(st.from)}`;
          else phrase = `до ${fmtDate(st.to)}`;
        }
        trigger.textContent = phrase || col.label;
        trigger.classList.toggle('dt-th-datebtn--empty', !phrase);
      };
      updateTrigger();

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openDateFilter(col, trigger, box, updateTrigger, single);
      });

      container.appendChild(trigger);
      box.control = container;
      box.isFilled = () => {
        const st = this._filterText[col.key];
        return single ? !!(typeof st === 'string' && st) : !!(st && (st.from || st.to));
      };
      box.clearControl = () => {
        this._filterText[col.key] = single ? '' : { from: '', to: '' };
        updateTrigger();
        this._closePopover();
      };
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

    // Словарь с filterResolve — один текст-инпут, имя резолвится в id (как раньше).
    if (col.type === 'dictionary' && typeof col.filterResolve === 'function') {
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

    // Текстовые колонки накапливают фразы-чипы (Enter добавляет, × и Backspace на
    // пустом поле удаляют); фильтр — «содержит любую из фраз» (contains_any).
    const wrap = document.createElement('div');
    wrap.className = 'dt-th-chipswrap';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dt-th-filter';
    input.placeholder = col.label;
    input.title = col.description || col.label;
    input.setAttribute('aria-label', `Фильтр по колонке: ${col.label}`);
    const chipsBox = document.createElement('div');
    chipsBox.className = 'dt-th-chips';
    // Состояние {text, chips}; строка из прежних версий мигрирует лениво.
    const state = () => {
      const st = this._filterText[col.key];
      if (st && typeof st === 'object' && !Array.isArray(st)) return st;
      const next = { text: typeof st === 'string' ? st : '', chips: [] };
      this._filterText[col.key] = next;
      return next;
    };
    const renderChips = () => {
      chipsBox.innerHTML = '';
      const st = state();
      chipsBox.hidden = !st.chips.length;
      st.chips.forEach((phrase, i) => {
        const chip = document.createElement('span');
        chip.className = 'dt-th-chip';
        const txt = document.createElement('span');
        txt.className = 'dt-th-chip-text';
        txt.textContent = phrase;
        txt.title = phrase;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'dt-th-chip-x';
        x.textContent = '×';
        x.setAttribute('aria-label', `Убрать фразу: ${phrase}`);
        x.addEventListener('click', () => { st.chips.splice(i, 1); apply(); });
        chip.appendChild(txt);
        chip.appendChild(x);
        chipsBox.appendChild(chip);
      });
    };
    const apply = () => {
      this._setFilterSpec(col.key, this._specFromTextChips(col, state()));
      renderChips();
      box.onChange();
    };
    input.addEventListener('input', () => { state().text = input.value; apply(); });
    input.addEventListener('keydown', (e) => {
      const st = state();
      if (e.key === 'Enter') {
        const phrase = String(input.value || '').trim();
        if (!phrase) return;
        e.preventDefault();
        if (!st.chips.some(c => c.toLowerCase() === phrase.toLowerCase())) st.chips.push(phrase);
        st.text = '';
        input.value = '';
        apply();
      } else if (e.key === 'Backspace' && !input.value && st.chips.length) {
        st.chips.pop();
        apply();
      }
    });
    const st0 = state();
    input.value = st0.text;
    renderChips();
    wrap.appendChild(input);
    wrap.appendChild(chipsBox);
    box.control = wrap;
    box.isFilled = () => { const st = state(); return !!(st.chips.length || String(st.text).trim()); };
    box.clearControl = () => { const st = state(); st.chips = []; st.text = ''; input.value = ''; renderChips(); };
    return box;
  }

  /**
   * Открывает попап фильтра даты под триггером через общую оболочку (_openPopover).
   * single → одно поле «Дата» (eq), иначе «С»/«По» (range). Применение — по вводу.
   */
  _openDateFilter(col, anchor, box, updateTrigger, single) {
    this._openPopover(anchor, 'dt-date-popover', (pop) => {
      const st = this._filterText[col.key];
      const mkRow = (labelText, value) => {
        const row = document.createElement('div');
        row.className = 'dt-date-row';
        const lab = document.createElement('label');
        lab.textContent = labelText;
        const inp = document.createElement('input');
        inp.type = 'date';
        inp.className = 'dt-date-input';
        inp.value = value || '';
        row.appendChild(lab);
        row.appendChild(inp);
        pop.appendChild(row);
        return inp;
      };

      let firstInput;
      if (single) {
        const inp = mkRow('Дата', typeof st === 'string' ? st : '');
        firstInput = inp;
        const apply = () => {
          this._filterText[col.key] = inp.value;
          this._setFilterSpec(col.key, this._specFromSingleDate(inp.value));
          updateTrigger();
          box.onChange();
        };
        inp.addEventListener('input', apply);
        inp.addEventListener('change', apply);
      } else {
        const s = st || {};
        const fromInp = mkRow('С', s.from);
        const toInp = mkRow('По', s.to);
        firstInput = fromInp;
        const apply = () => {
          this._filterText[col.key] = { from: fromInp.value, to: toInp.value };
          this._setFilterSpec(col.key, this._specFromRange(fromInp.value, toInp.value));
          updateTrigger();
          box.onChange();
        };
        for (const el of [fromInp, toInp]) {
          el.addEventListener('input', apply);
          el.addEventListener('change', apply);
        }
      }

      const actions = document.createElement('div');
      actions.className = 'dt-date-actions';
      const clr = document.createElement('button');
      clr.type = 'button';
      clr.className = 'dt-date-clear';
      clr.textContent = 'Очистить';
      clr.addEventListener('click', () => {
        this._filterText[col.key] = single ? '' : { from: '', to: '' };
        this._setFilterSpec(col.key, null);
        updateTrigger();
        box.onChange();
        this._closePopover();
      });
      actions.appendChild(clr);
      pop.appendChild(actions);

      return firstInput;
    });
  }

  /**
   * filterPicker: 'checkbox' — мультивыбор по col.filterOptions ({value, label,
   * short?}). Триггер: пусто → «—» (+ класс --empty), 1–3 значения → short||label
   * через запятую, больше → «N выбрано». Пустой набор галочек снимает фильтр
   * (null), а не {op:'in', values:[]} — иначе таблица показала бы «ничего не
   * найдено» вместо «фильтр не применён».
   */
  _buildCheckboxFilter(col, box) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dt-th-filter dt-th-popbtn';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-label', `Фильтр по колонке: ${col.label}`);

    const optByValue = new Map((col.filterOptions || []).map((o) => [String(o.value), o]));
    const currentValues = () => {
      const spec = this._filters[col.key];
      return spec && spec.op === 'in' ? spec.values : [];
    };
    const updateTrigger = () => {
      const values = currentValues();
      if (!values.length) {
        btn.textContent = '—';
      } else if (values.length <= 3) {
        btn.textContent = values
          .map((v) => { const opt = optByValue.get(String(v)); return opt ? (opt.short || opt.label) : v; })
          .join(', ');
      } else {
        btn.textContent = `${values.length} выбрано`;
      }
      btn.classList.toggle('dt-th-popbtn--empty', !values.length);
    };
    updateTrigger();

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      let checkboxes = [];
      this._openPopover(btn, 'dt-check-popover', (pop) => {
        const current = new Set(currentValues().map(String));
        checkboxes = [];
        let first = null;
        const onCheckChange = () => {
          const values = checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
          this._setFilterSpec(col.key, values.length ? { op: 'in', values } : null);
          updateTrigger();
          box.onChange();
        };
        for (const opt of (col.filterOptions || [])) {
          const row = document.createElement('label');
          row.className = 'dt-check-row';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = String(opt.value);
          cb.checked = current.has(String(opt.value));
          cb.addEventListener('change', onCheckChange);
          row.appendChild(cb);
          const span = document.createElement('span');
          span.textContent = opt.label;
          row.appendChild(span);
          pop.appendChild(row);
          checkboxes.push(cb);
          if (!first) first = cb;
        }

        const actions = document.createElement('div');
        actions.className = 'dt-date-actions';
        const clr = document.createElement('button');
        clr.type = 'button';
        clr.className = 'dt-date-clear';
        clr.textContent = 'Сбросить';
        clr.addEventListener('click', () => {
          for (const cb of checkboxes) cb.checked = false;
          this._setFilterSpec(col.key, null);
          updateTrigger();
          box.onChange();
          this._closePopover();
        });
        actions.appendChild(clr);
        pop.appendChild(actions);

        return first;
      });
    });

    box.control = btn;
    box.isFilled = () => currentValues().length > 0;
    box.clearControl = () => { this._setFilterSpec(col.key, null); updateTrigger(); };
    return box;
  }

  /**
   * filterPicker: 'numrange' — диапазон по числу («от»/«до», step 0.01). Пустые
   * оба поля снимают фильтр (null). Триггер: «от X» / «до Y» / «X – Y»
   * (Intl.NumberFormat('ru-RU')), пусто → имя колонки (как у дат).
   */
  _buildNumRangeFilter(col, box) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dt-th-filter dt-th-popbtn';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-label', `Фильтр по колонке: ${col.label}`);

    const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
    const fmtNum = (v) => { const n = Number(v); return Number.isNaN(n) ? String(v) : fmt.format(n); };
    const updateTrigger = () => {
      const spec = this._filters[col.key];
      let phrase = '';
      if (spec && spec.op === 'range') {
        const hasFrom = spec.from != null && spec.from !== '';
        const hasTo = spec.to != null && spec.to !== '';
        if (hasFrom && hasTo) phrase = `${fmtNum(spec.from)} – ${fmtNum(spec.to)}`;
        else if (hasFrom) phrase = `от ${fmtNum(spec.from)}`;
        else if (hasTo) phrase = `до ${fmtNum(spec.to)}`;
      }
      btn.textContent = phrase || col.label;
      btn.classList.toggle('dt-th-popbtn--empty', !phrase);
    };
    updateTrigger();

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openPopover(btn, 'dt-num-popover', (pop) => {
        const spec = this._filters[col.key];
        const mkRow = (labelText, value) => {
          const row = document.createElement('div');
          row.className = 'dt-date-row';
          const lab = document.createElement('label');
          lab.textContent = labelText;
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.step = '0.01';
          inp.className = 'dt-date-input';
          inp.value = value != null ? value : '';
          row.appendChild(lab);
          row.appendChild(inp);
          pop.appendChild(row);
          return inp;
        };
        const fromEl = mkRow('от', spec && spec.op === 'range' ? spec.from : '');
        const toEl = mkRow('до', spec && spec.op === 'range' ? spec.to : '');
        const apply = () => {
          const f = String(fromEl.value ?? '').trim();
          const t = String(toEl.value ?? '').trim();
          const newSpec = (!f && !t) ? null : { op: 'range', cast: 'numeric', ...(f && { from: f }), ...(t && { to: t }) };
          this._setFilterSpec(col.key, newSpec);
          updateTrigger();
          box.onChange();
        };
        fromEl.addEventListener('input', apply);
        toEl.addEventListener('input', apply);

        const actions = document.createElement('div');
        actions.className = 'dt-date-actions';
        const clr = document.createElement('button');
        clr.type = 'button';
        clr.className = 'dt-date-clear';
        clr.textContent = 'Очистить';
        clr.addEventListener('click', () => {
          fromEl.value = '';
          toEl.value = '';
          this._setFilterSpec(col.key, null);
          updateTrigger();
          box.onChange();
          this._closePopover();
        });
        actions.appendChild(clr);
        pop.appendChild(actions);

        return fromEl;
      });
    });

    box.control = btn;
    box.isFilled = () => { const spec = this._filters[col.key]; return !!(spec && spec.op === 'range'); };
    box.clearControl = () => { this._setFilterSpec(col.key, null); updateTrigger(); };
    return box;
  }

  /**
   * Единственный попап таблицы: позиционирование от якоря (fixed, зажат в
   * вьюпорт, флип вверх при нехватке места снизу), закрытие по клику вне /
   * Escape / scroll / resize (отложенная подписка — иначе клик по триггеру,
   * который и открыл попап, тут же его и закрыл бы). `buildBody(pop)` наполняет
   * содержимое и возвращает элемент для автофокуса (может вернуть null/undefined).
   */
  _openPopover(anchor, className, buildBody) {
    this._closePopover();
    const pop = document.createElement('div');
    pop.className = className;
    pop.setAttribute('role', 'dialog');

    const firstFocusable = buildBody(pop);

    document.body.appendChild(pop);
    // Позиционирование под триггером (fixed — без учёта скролла) с зажатием в вьюпорт.
    const rect = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top = `${rect.bottom + 2}px`;
    pop.style.left = `${rect.left}px`;
    const margin = 8;
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - margin) { // не вылезать за правый край
      pop.style.left = `${Math.max(margin, window.innerWidth - margin - pr.width)}px`;
    }
    if (pr.bottom > window.innerHeight - margin && rect.top - pr.height - 2 > 0) {
      pop.style.top = `${rect.top - pr.height - 2}px`; // не помещается снизу — флип вверх
    }

    const onDocMouseDown = (e) => {
      if (pop.contains(e.target) || anchor.contains(e.target)) return;
      this._closePopover();
    };
    const onKeydown = (e) => { if (e.key === 'Escape') this._closePopover(); };
    // Скролл/ресайз уводят триггер от fixed-попапа — просто закрываем (надёжнее
    // репозиционирования). Capture:true ловит скролл и внутренних контейнеров (.dt-wrapper).
    const onScrollResize = () => this._closePopover();
    // Отложенная подписка, чтобы текущий клик по триггеру не закрыл попап сразу.
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('keydown', onKeydown, true);
      window.addEventListener('scroll', onScrollResize, true);
      window.addEventListener('resize', onScrollResize, true);
      if (firstFocusable && firstFocusable.focus) firstFocusable.focus();
    }, 0);

    this._popover = { el: pop, onDocMouseDown, onKeydown, onScrollResize, timer };
  }

  _closePopover() {
    const p = this._popover;
    if (!p) return;
    clearTimeout(p.timer); // снять отложенную подписку, если закрылись до её срабатывания
    document.removeEventListener('mousedown', p.onDocMouseDown, true);
    document.removeEventListener('keydown', p.onKeydown, true);
    window.removeEventListener('scroll', p.onScrollResize, true);
    window.removeEventListener('resize', p.onScrollResize, true);
    if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
    this._popover = null;
  }

  async render() {
    clearTimeout(this._debounce); // #14: снять отложенный _renderBody, чтобы он не выстрелил после
    this._closePopover();         // перестройка шапки осиротила бы открытый попап (дата/чекбокс/диапазон)
    const cols = this._visibleColumns();
    // Позиция скролла живёт на старом wrapper'е, который сейчас будет уничтожен
    // пересборкой — переносим её на новый (иначе любая перерисовка: фильтр,
    // сортировка, смена видимости колонок — сбрасывает скролл в ноль).
    const prevScroll = this._wrapper ? { left: this._wrapper.scrollLeft, top: this._wrapper.scrollTop } : null;
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
    this._wrapper = wrapper;

    attachColumnResize({ theadEl: thead, columns: cols, viewState: this._view });

    await this._renderBody();
    // scrollTop восстанавливаем ПОСЛЕ наполнения тела: до этого tbody пуст,
    // scrollHeight ≈ высоте шапки, и запись клэмпится браузером к 0 без
    // повторной попытки. scrollLeft сюда же для симметрии (обе оси одного wrapper'а).
    if (prevScroll) {
      wrapper.scrollLeft = prevScroll.left;
      wrapper.scrollTop = prevScroll.top;
    }
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
        let text = '';
        if (col.render) {
          // Кастомный DOM-рендер ячейки (сумма с мини-баром, чипы ТБ и т.п.)
          const node = col.render(raw, record, this._dicts);
          if (node) td.appendChild(node);
        } else {
          text = col.format ? col.format(raw, this._dicts) : (raw == null ? '' : String(raw));
          td.textContent = text;
          td.title = text;
        }
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
