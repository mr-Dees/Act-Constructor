/**
 * Общий ресайз панели угловой ручкой (popup чата, меню уведомлений и т.п.).
 *
 * Единый корректный источник логики drag-resize: раньше она дублировалась в
 * chat-popup.js и notification-center.js, и каждая копия несла одни и те же
 * грабли. Теперь обе панели зовут эту утилиту.
 *
 * Геометрия: панель закреплена сверху, ручка в одном из НИЖНИХ углов; высота
 * всегда растёт вниз. По X направление задаётся `growX`:
 *   - 'right' — панель прижата слева (popup чата), ручка справа-снизу;
 *   - 'left'  — панель прижата справа (меню уведомлений), ручка слева-снизу.
 *
 * Решает классические грабли drag-resize в одном месте:
 *   - кламп к [min; min(px-cap, vw/vh-cap)] ТЕКУЩЕГО вьюпорта при ресайзе,
 *     restore И ресайзе окна (inline maxHeight перебивает CSS max-height, поэтому
 *     без re-clamp при сужении окна панель вылезла бы за экран);
 *   - «хвостовой» click после drag'а вне панели гасится в capture-фазе — иначе
 *     outside-click-обработчик панели закрыл бы её сразу после ресайза;
 *   - потерянный mouseup (кнопку отпустили вне окна) — авто-стоп по `buttons`;
 *   - body cursor/user-select сбрасываются и при mouseup, и при destroy();
 *   - размер персистится в localStorage и восстанавливается (с клампом).
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.panel   Изменяемая по размеру панель.
 * @param {HTMLElement} opts.handle  Угловая ручка (цель mousedown).
 * @param {'left'|'right'} [opts.growX='right'] Направление роста ширины.
 * @param {number} opts.minWidth
 * @param {number} [opts.maxWidthPx=Infinity]
 * @param {number} [opts.maxWidthVw=100]
 * @param {number} opts.minHeight
 * @param {number} [opts.maxHeightVh=100]
 * @param {string} [opts.storageKey] Ключ localStorage (без него размер не персистится).
 * @param {string} [opts.cursor='nwse-resize'] Курсор во время drag'а.
 * @returns {{destroy: () => void}} teardown — снимает слушатели и сбрасывает залипшее состояние.
 */
export function makeResizablePanel(opts) {
  const {
    panel,
    handle,
    growX = 'right',
    minWidth,
    maxWidthPx = Infinity,
    maxWidthVw = 100,
    minHeight,
    maxHeightVh = 100,
    storageKey,
    cursor = 'nwse-resize',
  } = opts || {};
  if (!panel || !handle) return { destroy() {} };

  const dirX = growX === 'left' ? -1 : 1;
  let resizing = false;
  let start = { x: 0, y: 0, w: 0, h: 0 };

  const clampW = (w) => {
    const maxW = Math.min(maxWidthPx, window.innerWidth * maxWidthVw / 100);
    return Math.max(minWidth, Math.min(maxW, w));
  };
  const clampH = (h) => {
    const maxH = window.innerHeight * maxHeightVh / 100;
    return Math.max(minHeight, Math.min(maxH, h));
  };
  // Высоту задаём И как height, И как maxHeight: inline maxHeight перебивает
  // адаптивный CSS max-height (50vh/70vh), иначе он обрезал бы увеличенную панель.
  const applyHeight = (h) => {
    panel.style.height = h + 'px';
    panel.style.maxHeight = h + 'px';
  };

  const saveSize = () => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        width: panel.style.width,
        height: panel.style.height,
      }));
    } catch (e) {
      // приватный режим/квота — не критично, размер останется в памяти DOM
    }
  };

  const restoreSize = () => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) || {};
      const w = parseFloat(saved.width);
      const h = parseFloat(saved.height);
      if (Number.isFinite(w)) panel.style.width = clampW(w) + 'px';
      if (Number.isFinite(h)) applyHeight(clampH(h));
    } catch (e) {
      // битый JSON / нет Storage — оставляем дефолтный размер
    }
  };

  const onMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = panel.getBoundingClientRect();
    resizing = true;
    start = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
  };

  const onMouseUp = () => {
    if (!resizing) return;
    resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Браузер синтезирует «хвостовой» click после drag'а; если он пришёлся вне
    // панели, её outside-click-обработчик закрыл бы панель сразу после ресайза.
    // Гасим один следующий click в capture-фазе (до bubble-обработчиков document).
    const swallow = (ev) => {
      ev.stopPropagation();
      document.removeEventListener('click', swallow, true);
    };
    document.addEventListener('click', swallow, true);
    setTimeout(() => document.removeEventListener('click', swallow, true), 0);
    saveSize();
  };

  const onMouseMove = (e) => {
    if (!resizing) return;
    // Кнопка отпущена вне окна (mouseup потерян) — завершаем, иначе следующий
    // mousemove без зажатой кнопки продолжал бы тянуть панель.
    if ((e.buttons & 1) === 0) { onMouseUp(); return; }
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    panel.style.width = clampW(start.w + dirX * dx) + 'px';
    applyHeight(clampH(start.h + dy));
  };

  // Пере-клампит явно заданный размер при сужении окна (см. applyHeight).
  const onWinResize = () => {
    const w = parseFloat(panel.style.width);
    const h = parseFloat(panel.style.height);
    if (Number.isFinite(w)) panel.style.width = clampW(w) + 'px';
    if (Number.isFinite(h)) applyHeight(clampH(h));
  };

  handle.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  window.addEventListener('resize', onWinResize);
  restoreSize();

  return {
    destroy() {
      if (resizing) {
        resizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      handle.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('resize', onWinResize);
    },
  };
}

// Window-global для совместимости с inline-скриптами в шаблонах (как прочие shared-модули).
if (typeof window !== 'undefined') {
  window.makeResizablePanel = makeResizablePanel;
}
