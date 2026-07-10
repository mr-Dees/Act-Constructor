/** Панель ⚙: опциональная доменная секция (preContent) над сеткой + чекбоксы
 * видимости колонок (сгруппированные подписями по col.group) + Выбрать/Снять все + Сброс. */
export class ColumnVisibility {
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

      const label = document.createElement('label');
      label.className = 'dt-colvis-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.key = col.key;
      cb.checked = viewState.isVisible(col.key);
      cb.addEventListener('change', () => {
        viewState.setVisible(col.key, cb.checked);
        cb.checked = viewState.isVisible(col.key); // откат, если скрыть последнюю запрещено
        onChange();
      });
      const span = document.createElement('span');
      span.textContent = col.label;
      label.appendChild(cb);
      label.appendChild(span);
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
    actions.appendChild(mk('Выбрать все', () => viewState.setAllVisible(true)));
    actions.appendChild(mk('Снять все', () => viewState.setAllVisible(false)));
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
