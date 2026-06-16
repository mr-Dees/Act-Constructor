/**
 * Живой источник «validation» для shared-центра уведомлений (только конструктор).
 *
 * Показывает конкретные замечания структурной валидации акта (#8), которые
 * бэк вернул на последнем сохранении (window.AppState.validationIssues). Это
 * источник истины статуса акта (вычислен сервером), поэтому колокольчик внутри
 * акта показывает ровно то, по чему акт помечен «требует проверки».
 *
 * Замечания НЕ персистятся отдельно — снимок последнего ответа сохранения;
 * рефреш центра — по событию `act:validation-updated` (диспатчит api.js).
 */

/**
 * Собирает элементы уведомлений из validation_issues последнего сохранения.
 * @returns {Array<{id:string,title:string,body:string,severity:string}>}
 */
export function collectValidationItems() {
  const state = (typeof window !== 'undefined' && window.AppState) || {};
  const issues = Array.isArray(state.validationIssues) ? state.validationIssues : [];
  return issues.map((issue, i) => ({
    id: `validation:${issue.code || 'issue'}:${issue.ref || i}`,
    title: 'Структура акта',
    body: issue.message || '',
    severity: issue.severity === 'error' ? 'error' : 'warning',
  }));
}

/**
 * Регистрирует источник «validation» и подписывает рефреш на событие
 * обновления статуса валидации (после сохранения).
 * @param {Object} center NotificationCenter.
 */
export function registerValidationSource(center) {
  if (!center) return;

  center.registerSource('validation', {
    collect: () => collectValidationItems(),
  });

  document.addEventListener('act:validation-updated', () => center.refresh());
}

// Window-global для совместимости с inline-скриптами в шаблонах.
if (typeof window !== 'undefined') {
  window.registerValidationSource = registerValidationSource;
}
