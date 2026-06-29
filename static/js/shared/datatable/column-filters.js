/** Строка инпутов-фильтров под заголовками (по одному на видимую колонку). */
export function renderFilterRow({ theadEl, columns, getValue, onInput }) {
  const tr = document.createElement('tr');
  tr.className = 'dt-filter-row';
  for (const col of columns) {
    const th = document.createElement('th');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dt-filter-input';
    input.dataset.key = col.key;
    input.setAttribute('aria-label', `Фильтр: ${col.label}`);
    input.value = getValue ? (getValue(col.key) || '') : '';
    input.addEventListener('input', () => onInput(col.key, input.value));
    th.appendChild(input);
    tr.appendChild(th);
  }
  theadEl.appendChild(tr);
  return tr;
}

if (typeof window !== 'undefined') window.renderFilterRow = renderFilterRow;
