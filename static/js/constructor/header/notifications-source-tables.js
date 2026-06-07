/**
 * Живой источник «tables» для shared-центра уведомлений (только конструктор).
 *
 * Регистрирует в общий NotificationCenter живой источник, который отдаёт
 * контентные/структурные замечания по таблицам (ValidationTable.collectContentWarnings()).
 * Замечания НЕ персистятся — это снимок текущего состояния документа.
 *
 * Клик по замечанию переводит к проблемной таблице в предпросмотре (inline-панель
 * #preview или модальное меню previewMenuManager) и кратко подсвечивает её рамкой.
 *
 * Рефреш центра — по событию `preview:content-changed` (живое обновление).
 */
import { ValidationTable } from '../validation/validation-table.js';

/**
 * Скроллит к элементу предпросмотра и кратко подсвечивает его рамкой.
 * @param {HTMLElement} el
 */
function scrollAndFlash(el) {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('preview-table-wrapper--flash');
  setTimeout(() => el.classList.remove('preview-table-wrapper--flash'), 1300);
}

/**
 * Переходит к таблице в предпросмотре и подсвечивает её.
 *
 * Если inline-панель #preview видима — скроллит к таблице в ней. Иначе открывает
 * модальное меню предпросмотра (previewMenuManager) и подсвечивает таблицу там.
 *
 * @param {string} tableId
 * @param {NotificationCenter} center Центр — чтобы закрыть колокольчик перед переходом.
 */
function navigateToTable(tableId, center) {
  if (tableId == null) return;
  const sel = `.preview-table-wrapper[data-table-id="${CSS.escape(String(tableId))}"]`;

  const inline = document.querySelector('#preview ' + sel);
  if (inline && inline.offsetParent !== null) {
    // inline-панель видима — скроллим прямо в ней.
    if (center) center.close();
    scrollAndFlash(inline);
    return;
  }

  // Иначе открываем модальное меню предпросмотра и подсвечиваем там.
  if (window.previewMenuManager) {
    if (center) center.close();
    window.previewMenuManager.open();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const inModal = document.querySelector('#previewMenuBody ' + sel);
      if (inModal) scrollAndFlash(inModal);
    }));
  }
}

/**
 * Собирает живые замечания по таблицам в нормализованной форме источника.
 *
 * Форма элемента: {id, title, body, severity, onClick}. title — имя таблицы,
 * body — текст замечания. id уникален в пределах снимка (привязан к tableId+issue).
 *
 * @param {NotificationCenter} center
 * @returns {Array<{id:string,title:string,body:string,severity:string,onClick:Function}>}
 */
function collectTableItems(center) {
  let warnings = [];
  try {
    warnings = ValidationTable.collectContentWarnings();
  } catch (e) {
    return [];
  }

  return warnings.map((w, i) => ({
    id: `tables:${w.tableId}:${i}`,
    title: w.tableName,
    body: w.issue,
    severity: w.severity,
    onClick: () => navigateToTable(w.tableId, center),
  }));
}

/**
 * Регистрирует источник «tables» в переданном центре и подписывает рефреш.
 * @param {NotificationCenter} center
 */
export function registerTablesSource(center) {
  if (!center) return;

  center.registerSource('tables', {
    collect: () => collectTableItems(center),
  });

  // Живое обновление при изменении содержимого предпросмотра.
  document.addEventListener('preview:content-changed', () => center.refresh());
}

// Window-global для совместимости с inline-скриптами в шаблонах.
if (typeof window !== 'undefined') {
  window.registerTablesSource = registerTablesSource;
}
