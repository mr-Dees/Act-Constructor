/** Панель ⚙: чекбоксы видимости колонок + Выбрать/Снять все + Сброс. */
export class ColumnVisibility {
  static mount({ anchorEl, columns, viewState, onChange }) {
    const panel = document.createElement('div');
    panel.className = 'dt-colvis-panel';
    panel.hidden = true;

    const grid = document.createElement('div');
    grid.className = 'dt-colvis-grid';
    for (const col of columns) {
      const label = document.createElement('label');
      label.className = 'dt-colvis-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
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
    }

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

    return panel;
  }

  static _sync(grid, columns, viewState) {
    const boxes = grid.querySelectorAll ? grid.querySelectorAll('input[type=checkbox]') : [];
    boxes.forEach((cb, i) => { if (columns[i]) cb.checked = viewState.isVisible(columns[i].key); });
  }
}

if (typeof window !== 'undefined') window.ColumnVisibility = ColumnVisibility;
