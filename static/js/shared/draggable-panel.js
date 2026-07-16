/**
 * Общее перетаскивание панели за ручку (заголовок/грип). Парная утилита к
 * `makeResizablePanel`: та меняет размер, эта — позицию (`left`/`top` у
 * `position:fixed` панели). Используется поповером корректора и строкой поиска,
 * чтобы у обеих была одинаковая логика перетаскивания.
 *
 * Решает те же классические грабли, что и resizable-panel, в одном месте:
 *   - кламп left/top к вьюпорту (панель не улетает за экран) при drag и resize окна;
 *   - «хвостовой» click после drag гасится в capture-фазе (иначе outside-click/blur
 *     закрыл бы панель сразу после перетаскивания);
 *   - потерянный mouseup (кнопку отпустили вне окна) — авто-стоп по `buttons`;
 *   - CSS-`transition` глушится на время drag (у строки поиска `transition:all` —
 *     иначе панель «лерпила» бы за курсором);
 *   - при переходе на left/top гасим `right`/`bottom` (иначе оба края конфликтуют);
 *   - позиция персистится в localStorage и восстанавливается (с клампом).
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.panel   Перетаскиваемая панель (`position:fixed`).
 * @param {HTMLElement} opts.handle  Ручка (заголовок/грип) — цель mousedown.
 * @param {string} [opts.storageKey] Ключ localStorage (без него позиция не персистится).
 * @param {number} [opts.margin=8]   Минимальный отступ от края вьюпорта.
 * @param {string} [opts.noDragSelector] Селектор интерактивных зон внутри ручки,
 *   по которым drag НЕ стартует (кнопки/инпуты). Дефолт покрывает обычный набор.
 * @returns {{destroy: () => void, reset: () => void}}
 */
export function makeDraggablePanel(opts) {
  const {
    panel,
    handle,
    storageKey,
    margin = 8,
    noDragSelector = 'button, input, textarea, select, a, [data-role="resize"], [data-no-drag]',
  } = opts || {};
  if (!panel || !handle) return { destroy() {}, reset() {} };

  let dragging = false;
  let start = { x: 0, y: 0, left: 0, top: 0 };
  let savedTransition = '';

  const clampLeft = (left) => {
    const w = panel.getBoundingClientRect().width;
    const maxLeft = Math.max(margin, window.innerWidth - w - margin);
    return Math.max(margin, Math.min(maxLeft, left));
  };
  const clampTop = (top) => {
    const h = panel.getBoundingClientRect().height;
    const maxTop = Math.max(margin, window.innerHeight - h - margin);
    return Math.max(margin, Math.min(maxTop, top));
  };

  // Перевод панели с CSS-якоря (right/bottom) на инлайновый left/top.
  const applyPos = (left, top) => {
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = clampLeft(left) + 'px';
    panel.style.top = clampTop(top) + 'px';
  };

  const savePos = () => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        left: panel.style.left,
        top: panel.style.top,
      }));
    } catch (e) {
      // приватный режим/квота — позиция останется только в DOM
    }
  };

  const restorePos = () => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) || {};
      const left = parseFloat(saved.left);
      const top = parseFloat(saved.top);
      if (Number.isFinite(left) && Number.isFinite(top)) applyPos(left, top);
    } catch (e) {
      // битый JSON / нет Storage — остаётся дефолт CSS
    }
  };

  const onMouseDown = (e) => {
    if (e.button !== 0) return;                       // только левая кнопка
    if (e.target.closest && e.target.closest(noDragSelector)) return;  // клик по контролу
    e.preventDefault();                               // не начинать выделение/не воровать фокус
    const rect = panel.getBoundingClientRect();
    dragging = true;
    start = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    savedTransition = panel.style.transition;
    panel.style.transition = 'none';                  // без лерпа за курсором
    document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
  };

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = savedTransition;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const swallow = (ev) => {
      ev.stopPropagation();
      document.removeEventListener('click', swallow, true);
    };
    document.addEventListener('click', swallow, true);
    setTimeout(() => document.removeEventListener('click', swallow, true), 0);
    savePos();
  };

  const onMouseMove = (e) => {
    if (!dragging) return;
    if ((e.buttons & 1) === 0) { onMouseUp(); return; }  // потерянный mouseup
    applyPos(start.left + (e.clientX - start.x), start.top + (e.clientY - start.y));
  };

  const onWinResize = () => {
    if (!panel.style.left) return;                    // ещё не перетаскивали — CSS-дефолт
    const left = parseFloat(panel.style.left);
    const top = parseFloat(panel.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) applyPos(left, top);
  };

  handle.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  window.addEventListener('resize', onWinResize);
  restorePos();

  return {
    destroy() {
      if (dragging) {
        dragging = false;
        panel.style.transition = savedTransition;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      handle.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('resize', onWinResize);
    },
    // Сброс к CSS-дефолту (снять инлайновую позицию).
    reset() {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '';
      panel.style.bottom = '';
      if (storageKey) {
        try { window.localStorage.removeItem(storageKey); } catch (e) { /* no-op */ }
      }
    },
  };
}

if (typeof window !== 'undefined') {
  window.makeDraggablePanel = makeDraggablePanel;
}
