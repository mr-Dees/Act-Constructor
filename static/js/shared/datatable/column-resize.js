/** Ресайз-хендлы на правой границе заголовков; ширина пишется в viewState. */
export function attachColumnResize({ theadEl, columns, viewState, onResize }) {
  const ths = theadEl.querySelectorAll ? theadEl.querySelectorAll('tr.dt-head-row th') : [];
  ths.forEach((th, i) => {
    const col = columns[i];
    if (!col) return;
    const handle = document.createElement('span');
    handle.className = 'dt-resize-handle';

    let startX = 0;
    let startW = 0;
    let active = false;

    const onMove = (e) => {
      if (!active) return;
      const px = Math.max(40, startW + (e.clientX - startX));
      th.style.width = `${px}px`;
      viewState.setWidth(col.key, px);
      if (onResize) onResize(col.key, px);
    };
    const onUp = () => {
      active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    handle.addEventListener('mousedown', (e) => {
      active = true;
      startX = e.clientX;
      startW = viewState.getWidth(col.key) || th.offsetWidth || 100;
      e.preventDefault();
      e.stopPropagation();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    th.appendChild(handle);
  });
}

if (typeof window !== 'undefined') window.attachColumnResize = attachColumnResize;
