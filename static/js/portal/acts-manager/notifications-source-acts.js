/**
 * Живой источник «acts» для shared-центра уведомлений (страница списка актов).
 *
 * При загрузке списка актов карточки получают статусы валидации
 * (needs_invoice_check / needs_created_date / needs_directive_number /
 * needs_service_note). Этот источник превращает акты с незакрытыми требованиями
 * в живые уведомления колокольчика: видно, по каким актам нужна фактура, СЗ,
 * дата составления или номера поручений. Клик ведёт к акту.
 *
 * Замечания НЕ персистятся — это снимок текущего списка (как источник «tables»
 * в конструкторе). Обновляются при каждой перезагрузке списка актов.
 */

/**
 * Строит элементы уведомлений из массива актов (чистая функция — для тестов).
 *
 * Берёт только акты с незакрытыми требованиями; заблокированные и «готовые»
 * пропускает. severity = 'error' если нужна проверка фактуры ИЛИ есть
 * структурная ошибка (validation_status='error') — критично, как красная
 * карточка; иначе 'warning' (в т.ч. агрегат «работа не закончена»).
 *
 * @param {Array<Object>} acts Акты из /api/v1/acts/list (ActListItem).
 * @param {{onOpen?: (actId:(number|string)) => void}} [opts]
 *   onOpen — обработчик перехода к акту (если не задан — onClick не ставится).
 * @returns {Array<{id:string,title:string,body:string,severity:string,onClick?:Function}>}
 */
export function buildActsNotificationItems(acts, opts = {}) {
  if (!Array.isArray(acts)) return [];
  const { onOpen } = opts;
  const items = [];

  for (const act of acts) {
    if (!act || act.is_locked) continue;

    const needsInvoice = !!act.needs_invoice_check;
    const otherNeeds = [];
    if (act.needs_created_date) otherNeeds.push('дата составления');
    if (act.needs_directive_number) otherNeeds.push('номера поручений');
    if (act.needs_service_note) otherNeeds.push('служебная записка');

    // Структурная валидация содержимого (#8):
    //   error   → конкретные ошибки «Проверить: …», severity error (как фактура);
    //   warning → один агрегат «Работа не закончена» (без перечисления),
    //             severity warning. Конкретику warning'ов (пустые таблицы и пр.)
    //             на лендинг не выносим — она видна полным списком внутри акта.
    const isValidationError = act.validation_status === 'error';
    const isValidationWarning = act.validation_status === 'warning';
    const errorIssues = isValidationError && Array.isArray(act.validation_issues)
      ? act.validation_issues
          .filter((i) => i && i.severity === 'error')
          .map((i) => i.message)
          .filter(Boolean)
      : [];

    if (!needsInvoice && otherNeeds.length === 0 && !isValidationError && !isValidationWarning) continue;

    const lines = [];
    const parts = [];
    if (needsInvoice) parts.push('проверка фактуры');
    parts.push(...otherNeeds);
    if (parts.length) lines.push(`Требуется: ${parts.join(', ')}`);
    if (errorIssues.length) lines.push(`Проверить: ${errorIssues.join('; ')}`);
    else if (isValidationError) lines.push('Требуется проверка структуры акта');
    else if (isValidationWarning) lines.push('Работа не закончена: остались незаполненные данные');

    items.push({
      id: `acts:${act.id}`,
      title: act.inspection_name || `Акт ${act.id}`,
      body: lines.join('\n'),
      severity: (needsInvoice || isValidationError) ? 'error' : 'warning',
      onClick: typeof onOpen === 'function' ? () => onOpen(act.id) : undefined,
    });
  }

  return items;
}

/**
 * Регистрирует источник «acts» в переданном центре.
 *
 * collect — pull-based: на каждый refresh читает актуальный список через
 * getActs() (страница хранит последний загруженный список и дёргает refresh).
 *
 * @param {Object} center NotificationCenter.
 * @param {{getActs: () => Array<Object>, onOpen?: (actId:(number|string))=>void}} handlers
 */
export function registerActsSource(center, handlers = {}) {
  if (!center) return;
  const { getActs, onOpen } = handlers;
  if (typeof getActs !== 'function') return;

  center.registerSource('acts', {
    collect: () => buildActsNotificationItems(getActs() || [], { onOpen }),
  });
}

// Window-global для совместимости с inline-скриптами в шаблонах.
if (typeof window !== 'undefined') {
  window.registerActsSource = registerActsSource;
}
