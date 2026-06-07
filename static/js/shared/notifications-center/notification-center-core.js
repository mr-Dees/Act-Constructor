/**
 * Чистое ядро центра уведомлений (без DOM/window/fetch).
 *
 * Вынесено для покрытия node:test: выбор цвета бейджа по критичности, подсчёт
 * самого бейджа и мердж живых + персистентных уведомлений в единый список для
 * рендера. Guard `window` в конце — модуль также импортируется в браузере.
 *
 * Нормализованная форма элемента списка:
 *   {
 *     id: string,
 *     kind: 'live' | 'persisted',
 *     source: string,
 *     severity: 'error' | 'warning' | 'info',
 *     title: string,
 *     body: string,
 *     link?: string,           // только у персистентных
 *     element_ref?: string,    // только у персистентных
 *     is_read?: boolean,       // только у персистентных
 *     onClick?: () => void,    // только у живых
 *   }
 */

/** Порядок критичности: чем больше число — тем важнее. */
const SEVERITY_RANK = { error: 3, warning: 2, info: 1 };

/**
 * Нормализует произвольную строку severity к одному из трёх уровней.
 *
 * Серверный домен допускает 'success' — он трактуется как 'info' (нейтральная
 * критичность для цвета бейджа). Всё неизвестное → 'info'.
 *
 * @param {string} [severity]
 * @returns {'error'|'warning'|'info'}
 */
export function normalizeSeverity(severity) {
  if (severity === 'error' || severity === 'warning' || severity === 'info') {
    return severity;
  }
  return 'info';
}

/**
 * Выбирает цвет бейджа по максимальной критичности среди элементов.
 *
 * Учитывает и живые, и персистентные (вход — единый список нормализованных или
 * сырых элементов с полем `severity`). error важнее warning важнее info.
 * Пустой вход → 'info'.
 *
 * @param {Array<{severity?: string}>} items
 * @returns {'error'|'warning'|'info'}
 */
export function pickBadgeSeverity(items) {
  if (!Array.isArray(items) || items.length === 0) return 'info';

  let best = 'info';
  let bestRank = SEVERITY_RANK.info;
  for (const item of items) {
    const sev = normalizeSeverity(item && item.severity);
    const rank = SEVERITY_RANK[sev];
    if (rank > bestRank) {
      best = sev;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Считает значение и видимость бейджа.
 *
 * Бейдж = непрочитанные персистентные + число живых. Скрыт, когда сумма 0.
 *
 * @param {number} persistedUnread Число непрочитанных персистентных.
 * @param {number} liveCount Число живых элементов.
 * @returns {{count: number, hidden: boolean}}
 */
export function computeBadge(persistedUnread, liveCount) {
  const a = Number.isFinite(persistedUnread) ? Math.max(0, persistedUnread) : 0;
  const b = Number.isFinite(liveCount) ? Math.max(0, liveCount) : 0;
  const count = a + b;
  return { count, hidden: count === 0 };
}

/**
 * Сливает живые и персистентные уведомления в единый упорядоченный список.
 *
 * Решение по порядку: ЖИВЫЕ идут сверху. Это замечания, которые пользователь
 * должен исправить прямо сейчас (в конструкторе — проблемные таблицы); они
 * актуальны «здесь и сейчас», в отличие от персистентных (исторические события,
 * ответы агента и т.п.). Внутри каждой группы сохраняется порядок входных
 * массивов. Каждый элемент помечается `kind` ('live'/'persisted') и приводится
 * к нормализованной severity.
 *
 * @param {Array<Object>} liveItems Живые элементы (уже с onClick).
 * @param {Array<Object>} persistedItems Персистентные элементы (форма NotificationOut).
 * @returns {Array<Object>} Нормализованный список для рендера.
 */
export function mergeFeed(liveItems, persistedItems) {
  const result = [];

  if (Array.isArray(liveItems)) {
    for (const item of liveItems) {
      if (!item) continue;
      result.push({
        id: item.id,
        kind: 'live',
        source: item.source || 'tables',
        severity: normalizeSeverity(item.severity),
        title: item.title || '',
        body: item.body || '',
        onClick: item.onClick,
      });
    }
  }

  if (Array.isArray(persistedItems)) {
    for (const item of persistedItems) {
      if (!item) continue;
      result.push({
        id: item.id,
        kind: 'persisted',
        source: item.source || '',
        severity: normalizeSeverity(item.severity),
        title: item.title || '',
        body: item.body || '',
        link: item.link || null,
        element_ref: item.element_ref || null,
        is_read: item.is_read === true,
      });
    }
  }

  return result;
}

/**
 * Считает число непрочитанных среди персистентных элементов.
 *
 * Удобный хелпер: бейдж считается по unread-count из API, но при локальном
 * mark-read (без перезапроса) центр пересчитывает по списку.
 *
 * @param {Array<{is_read?: boolean}>} persistedItems
 * @returns {number}
 */
export function countPersistedUnread(persistedItems) {
  if (!Array.isArray(persistedItems)) return 0;
  let n = 0;
  for (const item of persistedItems) {
    if (item && item.is_read !== true) n += 1;
  }
  return n;
}

// Дублируем в window ради inline-скриптов; guard — модуль импортируется в node:test.
if (typeof window !== 'undefined') {
  window.NotificationCenterCore = {
    normalizeSeverity,
    pickBadgeSeverity,
    computeBadge,
    mergeFeed,
    countPersistedUnread,
  };
}
