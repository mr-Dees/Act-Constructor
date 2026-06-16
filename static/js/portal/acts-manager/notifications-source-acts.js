/**
 * Живой источник «acts» для shared-центра уведомлений (страница списка актов).
 *
 * Источник данных — серверная сводка GET /api/v1/acts/attention-summary: ВСЕ
 * акты пользователя, требующие внимания (незакрытые требования фактура/СЗ/дата/
 * поручения + структурная валидация содержимого), посчитанные на сервере. Раньше
 * пересчёт шёл на клиенте по загруженной странице this._acts — это было неполно
 * (видны только подгруженные акты) и не масштабировалось на сотни актов.
 *
 * Поведение записей:
 *   - error (фактура/структурная ошибка) — критично, «вечно горит»: без
 *     прочтения/удаления (как замечания внутри акта). Клик ведёт к акту.
 *   - warning (работа не закончена) — некритично: можно прочитать/вернуть в
 *     непрочитанное/удалить. Состояние хранится на клиенте (localStorage) по
 *     ключу акта + сигнатуре замечания и АВТОМАТИЧЕСКИ сбрасывается, когда акт
 *     исправлен (выпал из сводки) или замечание изменилось.
 *
 * Флаги needs_* поддерживаются ETL (фактура может появиться спустя месяцы),
 * поэтому сводка опрашивается редко (раз в 5 минут) + при загрузке страницы и
 * возврате на вкладку — чаще нет смысла, данные не меняются быстрее.
 */

/** Интервал опроса серверной сводки (мс). Флаги меняются редко (ETL). */
const ATTENTION_POLL_INTERVAL_MS = 5 * 60 * 1000;
/** Ключ localStorage для клиентского состояния прочтения/удаления warning'ов. */
const STATE_STORAGE_KEY = 'notif:acts:state';

/**
 * Строит элементы уведомлений из массива актов (чистая функция — для тестов).
 *
 * Берёт только акты с незакрытыми требованиями; заблокированные и «готовые»
 * пропускает (сервер уже отфильтровал заблокированные, но проверка сохранена —
 * функция переиспользуется и для сырых ActListItem). severity = 'error' если
 * нужна проверка фактуры ИЛИ есть структурная ошибка (validation_status='error')
 * — критично, как красная карточка; иначе 'warning' (в т.ч. агрегат «работа не
 * закончена»).
 *
 * @param {Array<Object>} acts Акты (ActAttentionItem или ActListItem-совместимые).
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
 * Сигнатура замечания акта — severity + текст. Меняется, когда меняется суть
 * замечания; используется, чтобы клиентское состояние «прочитано/удалено»
 * сбрасывалось при изменении замечания. (Чистая функция — для тестов.)
 *
 * @param {{severity?:string, body?:string}} item
 * @returns {string}
 */
export function actItemSignature(item) {
  return `${item ? item.severity : ''}|${(item && item.body) || ''}`;
}

/**
 * Сводит отформатированные элементы с клиентским состоянием прочтения/удаления.
 * Чистая функция (без DOM/Storage) — для node:test.
 *
 * Правила:
 *   - error («вечно горит»): состояние НЕ применяется (всегда видно, непрочитано);
 *   - warning: применяем сохранённое состояние только если сигнатура совпадает
 *     с сохранённой (иначе замечание изменилось → состояние сбрасывается);
 *     удалённые (dismissed) в выдачу не попадают.
 *
 * Возвращаемый `store` содержит записи ТОЛЬКО для текущих элементов → состояние
 * исправленных/исчезнувших актов автоматически вычищается.
 *
 * @param {Array<Object>} items Отформатированные элементы (см. buildActsNotificationItems).
 * @param {Object<string,{sig:string,read:boolean,dismissed:boolean}>} store Прежнее состояние.
 * @returns {{visible: Array<Object>, store: Object}}
 */
export function reconcileActsItemsState(items, store = {}) {
  const next = {};
  const visible = [];

  for (const item of (Array.isArray(items) ? items : [])) {
    if (!item) continue;
    if (item.severity === 'error') {
      // Критичное — без состояния и без действий.
      visible.push({ ...item, is_read: false });
      continue;
    }
    const sig = actItemSignature(item);
    const prev = store && store[item.id];
    const matches = prev && prev.sig === sig;
    const read = matches ? !!prev.read : false;
    const dismissed = matches ? !!prev.dismissed : false;
    next[item.id] = { sig, read, dismissed };
    if (dismissed) continue; // удалённое не показываем
    visible.push({ ...item, is_read: read });
  }

  return { visible, store: next };
}

// ── Браузерная обвязка (вне node:test через guard window) ────────────────────

/** @private Читает клиентское состояние из localStorage (fail-safe → {}). */
function _loadState() {
  try {
    const raw = window.localStorage.getItem(STATE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

/** @private Сохраняет клиентское состояние (fail-safe). */
function _saveState(state) {
  try {
    window.localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state || {}));
  } catch (e) {
    // приватный режим/квота — не критично, состояние останется в памяти
  }
}

/** @private Резолвит proxy-safe URL через AppConfig (фолбэк — относительный). */
function _apiUrl(path) {
  const cfg = (typeof window !== 'undefined') ? window.AppConfig : null;
  return (cfg && cfg.api && typeof cfg.api.getUrl === 'function') ? cfg.api.getUrl(path) : path;
}

/**
 * Регистрирует источник «acts» в переданном центре.
 *
 * collect — синхронный: возвращает элементы из последней загруженной сводки,
 * сведённые с клиентским состоянием. Саму сводку источник тянет сам: при
 * регистрации, по таймеру (5 мин) и при возврате на вкладку.
 *
 * @param {Object} center NotificationCenter.
 * @param {{onOpen?: (actId:(number|string))=>void}} [handlers]
 * @returns {(() => void)|undefined} teardown — снимает таймер/слушатель и источник
 *   (на портале не нужен — страница перезагружается целиком; undefined без center).
 */
export function registerActsSource(center, handlers = {}) {
  if (!center) return;
  const { onOpen } = handlers;

  const ctrl = {
    rawActs: [],
    store: _loadState(),
    persistedJson: '',
    // Загружена ли серверная сводка хоть раз. ДО первой загрузки rawActs пуст —
    // это «ещё не знаем», а НЕ «всё исправлено». Без этого флага первый
    // синхронный collect() (его дёргает registerSource ниже) сводил бы стор к {}
    // и затирал localStorage (прочитано/удалено) пустотой ещё до прихода сводки.
    loaded: false,
  };

  // Применяет патч состояния к записи (id+sig), сохраняет и обновляет центр.
  const setState = (id, sig, patch) => {
    const prev = ctrl.store[id] || { sig, read: false, dismissed: false };
    ctrl.store[id] = { sig, read: !!prev.read, dismissed: !!prev.dismissed, ...patch };
    _saveState(ctrl.store);
    ctrl.persistedJson = JSON.stringify(ctrl.store);
    center.refresh();
  };

  const collect = () => {
    // Пока сводка не загружена — НЕ трогаем сохранённое состояние (см. ctrl.loaded):
    // reconcile с пустым rawActs вычистил бы стор и затёр localStorage.
    if (!ctrl.loaded) return [];
    const formatted = buildActsNotificationItems(ctrl.rawActs, { onOpen });
    const { visible, store } = reconcileActsItemsState(formatted, ctrl.store);
    ctrl.store = store;
    // Персистим только при изменении (collect зовётся часто, в т.ч. при опросе
    // персистентных уведомлений) — не дёргаем localStorage на каждый refresh.
    const json = JSON.stringify(store);
    if (json !== ctrl.persistedJson) {
      _saveState(store);
      ctrl.persistedJson = json;
    }
    // warning'и (не error) получают клиентские действия read/unread/delete.
    return visible.map((item) => {
      if (item.severity === 'error') return item;
      const sig = actItemSignature(item);
      return {
        ...item,
        onMarkRead: () => setState(item.id, sig, { read: true }),
        onMarkUnread: () => setState(item.id, sig, { read: false }),
        onDelete: () => setState(item.id, sig, { dismissed: true }),
      };
    });
  };

  center.registerSource('acts', { collect });

  const fetchSummary = async () => {
    try {
      const resp = await fetch(_apiUrl('/api/v1/acts/attention-summary'), {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (Array.isArray(data)) {
        ctrl.rawActs = data;
        ctrl.loaded = true; // с этого момента пустой rawActs = «всё исправлено»
        center.refresh();
      }
    } catch (e) {
      // сеть упала — оставляем прежнюю сводку
    }
  };

  // Старт: тянем сводку сразу, затем редкий поллинг + рефреш при возврате.
  fetchSummary();
  const timer = setInterval(() => {
    if (document.hidden) return;
    fetchSummary();
  }, ATTENTION_POLL_INTERVAL_MS);
  const onVisibility = () => {
    if (!document.hidden) fetchSummary();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // Teardown (на портале страница перезагружается целиком, поэтому штатно не
  // зовётся, но источник остаётся снимаемым — без осиротевших таймера/слушателя).
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    center.unregisterSource('acts');
  };
}

// Window-global для совместимости с inline-скриптами в шаблонах.
if (typeof window !== 'undefined') {
  window.registerActsSource = registerActsSource;
}
