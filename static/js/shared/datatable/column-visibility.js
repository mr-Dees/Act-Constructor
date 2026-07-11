/** Панель ⚙: опциональная доменная секция (preContent) над сеткой + чекбоксы
 * видимости колонок (сгруппированные подписями по col.group) + Выбрать/Снять все + Сброс. */
export class ColumnVisibility {
  /**
   * Строка-чекбокс панели (label.dt-colvis-item) — переиспользуется и самой
   * панелью, и доменными секциями (например, галочками ТБ), чтобы разметка
   * не расходилась с тулкитом.
   * @returns {{el: HTMLElement, checkbox: HTMLInputElement}}
   */
  static buildCheckboxRow({ label, checked = false, title = '', disabled = false, onChange }) {
    const wrap = document.createElement('label');
    wrap.className = 'dt-colvis-item';
    if (title) wrap.title = title;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.disabled = disabled;
    if (onChange) cb.addEventListener('change', () => onChange(cb.checked));
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(cb);
    wrap.appendChild(span);
    return { el: wrap, checkbox: cb };
  }

  /** Bulk-видимость СКОУПЛЕНА к переданным колонкам: ключи вне панели
   * (например, pivot-колонки доменной секции) не трогаем — страницам не
   * приходится «отматывать» лишнее после каждого клика. */
  static _setAll(columns, viewState, on) {
    if (on) {
      for (const col of columns) viewState.setVisible(col.key, true);
      return;
    }
    // «Снять все»: остаётся первая видимая-по-умолчанию колонка панели
    // (гард viewState «нельзя скрыть последнюю» — общая подстраховка).
    const keep = columns.find(c => !c.hidden) || columns[0];
    if (keep) viewState.setVisible(keep.key, true);
    for (const col of columns) {
      if (!keep || col.key !== keep.key) viewState.setVisible(col.key, false);
    }
  }

  static mount({ anchorEl, columns, viewState, onChange, preContent, onApi }) {
    const panel = document.createElement('div');
    panel.className = 'dt-colvis-panel';
    panel.hidden = true;
    if (preContent) panel.appendChild(preContent); // доменная секция над чекбоксами (например, вид развертки ТБ)

    const grid = document.createElement('div');
    grid.className = 'dt-colvis-grid';
    const boxByKey = new Map(); // key→checkbox для _sync — вставленные заголовки групп сдвигают позиции в grid
    let lastGroup = null;
    for (const col of columns) {
      const g = col.group || null;
      if (g && g !== lastGroup) {
        const head = document.createElement('div');
        head.className = 'dt-colvis-grouplabel';
        head.textContent = g;
        grid.appendChild(head);
      }
      lastGroup = g;

      const { el: label, checkbox: cb } = ColumnVisibility.buildCheckboxRow({
        label: col.label,
        checked: viewState.isVisible(col.key),
        onChange: (checked) => {
          viewState.setVisible(col.key, checked);
          cb.checked = viewState.isVisible(col.key); // откат, если скрыть последнюю запрещено
          onChange();
        },
      });
      cb.dataset.key = col.key;
      grid.appendChild(label);
      boxByKey.set(col.key, cb);
    }
    grid._dtBoxByKey = boxByKey;

    const actions = document.createElement('div');
    actions.className = 'dt-colvis-actions';
    const mk = (text, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary';
      b.textContent = text;
      b.addEventListener('click', () => {
        fn();
        ColumnVisibility._sync(grid, columns, viewState);
        onChange();
      });
      return b;
    };
    actions.appendChild(mk('Выбрать все', () => ColumnVisibility._setAll(columns, viewState, true)));
    actions.appendChild(mk('Снять все', () => ColumnVisibility._setAll(columns, viewState, false)));
    actions.appendChild(mk('Сбросить к умолчанию', () => viewState.resetToDefault()));

    panel.appendChild(grid);
    panel.appendChild(actions);
    document.body.appendChild(panel);

    const place = () => {
      const r = anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : { bottom: 0, left: 0 };
      panel.style.top = `${r.bottom + 4}px`;
      panel.style.left = `${r.left}px`;
    };

    anchorEl.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) { place(); ColumnVisibility._sync(grid, columns, viewState); }
    });
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== anchorEl) panel.hidden = true;
    }, true);

    if (typeof onApi === 'function') {
      onApi({ sync: () => ColumnVisibility._sync(grid, columns, viewState) });
    }

    return panel;
  }

  static _sync(grid, columns, viewState) {
    const byKey = grid._dtBoxByKey || new Map();
    for (const col of columns) {
      const cb = byKey.get(col.key);
      if (cb) cb.checked = viewState.isVisible(col.key);
    }
  }
}

if (typeof window !== 'undefined') window.ColumnVisibility = ColumnVisibility;
