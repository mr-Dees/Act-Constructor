/** Просмотр полного текста ячейки и проверка обрезки (доменно-агностично). */

export function isTruncated(cellEl) {
  return !!cellEl && cellEl.scrollWidth > cellEl.clientWidth;
}

let _open = null;

function onDocClick(e) {
  if (_open && !_open.contains(e.target)) close();
}

function close() {
  if (_open) {
    _open.remove();
    _open = null;
    document.removeEventListener('click', onDocClick, true);
  }
}

/** Показать read-only поповер с полным текстом у якорной ячейки. */
export function showCellPopover(anchorEl, text) {
  close();
  const pop = document.createElement('div');
  pop.className = 'dt-cell-popover';
  pop.setAttribute('role', 'tooltip');
  pop.textContent = text == null ? '' : String(text);
  const rect = anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : { left: 0, bottom: 0 };
  pop.style.left = `${rect.left}px`;
  pop.style.top = `${rect.bottom + 2}px`;
  document.body.appendChild(pop);
  _open = pop;
  // отложенная подписка, чтобы текущий клик не закрыл поповер сразу
  setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
  return pop;
}

if (typeof window !== 'undefined') {
  window.showCellPopover = showCellPopover;
  window.isTruncated = isTruncated;
}
