/**
 * Единый shared-центр уведомлений (колокольчик) для портала и конструктора.
 *
 * Показывает в одном выпадающем меню:
 *   - персистентные уведомления из домена notifications (GET/POST API);
 *   - живые источники (например, замечания по таблицам в конструкторе) —
 *     регистрируются через registerSource(), НЕ персистятся.
 *
 * НЕ путать с toast-системой `shared/notifications.js` (window.Notifications) —
 * это всплывашки, а не колокольчик.
 *
 * Биндится к существующей разметке по DOM-id:
 *   #notificationsBtn / #notificationsMenu / #notificationsBody /
 *   #notificationsBadge / #closeNotificationsBtn / #notificationsReadAllBtn (опц.).
 * Если обязательных элементов нет — init() тихо выходит (страница без колокольчика).
 */
import { EscapeStack } from '../escape-stack.js';
import { AppConfig } from '../app-config.js';
import {
  pickBadgeSeverity,
  computeBadge,
  mergeFeed,
  countPersistedUnread,
} from './notification-center-core.js';

/** Интервал поллинга персистентных уведомлений (мс). */
const POLL_INTERVAL_MS = 30000;

export class NotificationCenter {
  /**
   * @param {{enablePersisted?: boolean}} [options]
   *   enablePersisted — включить встроенный персистентный источник (API). По
   *   умолчанию true. На страницах без бэкенд-уведомлений можно передать false.
   */
  constructor(options = {}) {
    this.enablePersisted = options.enablePersisted !== false;

    this.btn = null;
    this.menu = null;
    this.body = null;
    this.badge = null;
    this.closeBtn = null;
    this.readAllBtn = null;

    this.isOpen = false;
    this._escapeUnsub = null;
    this._pollTimer = null;

    /** @type {Map<string, {collect: Function, onItemClick?: Function}>} */
    this._sources = new Map();
    /** Последний снимок персистентных уведомлений (форма NotificationOut). */
    this._persisted = [];

    // Стабильные ссылки на обработчики — нужны для destroy().
    this._onBtnClick = (e) => { e.stopPropagation(); this.toggle(); };
    this._onCloseClick = (e) => { e.stopPropagation(); this.close(); };
    this._onReadAllClick = (e) => { e.stopPropagation(); this._markAllRead(); };
    this._onDocClick = (e) => this._handleOutsideClick(e);
    this._onVisibilityChange = () => this._handleVisibilityChange();
    this._onRefreshEvent = () => this.refresh();
  }

  /**
   * Захватывает DOM, навешивает обработчики, запускает поллинг и первый refresh.
   * Если обязательных элементов нет — тихо выходит.
   */
  init() {
    this.btn = document.getElementById('notificationsBtn');
    this.menu = document.getElementById('notificationsMenu');
    this.body = document.getElementById('notificationsBody');
    this.badge = document.getElementById('notificationsBadge');
    this.closeBtn = document.getElementById('closeNotificationsBtn');
    this.readAllBtn = document.getElementById('notificationsReadAllBtn');

    if (!this.btn || !this.menu || !this.body || !this.badge) {
      return; // страница без колокольчика — ничего не делаем
    }

    this.btn.addEventListener('click', this._onBtnClick);
    if (this.closeBtn) this.closeBtn.addEventListener('click', this._onCloseClick);
    if (this.readAllBtn) this.readAllBtn.addEventListener('click', this._onReadAllClick);

    document.addEventListener('click', this._onDocClick);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    document.addEventListener('notifications:refresh', this._onRefreshEvent);

    if (this.enablePersisted) {
      this._startPolling();
    }

    this.refresh();
  }

  /**
   * Регистрирует живой источник уведомлений.
   * @param {string} key Уникальный ключ источника (например 'tables').
   * @param {{collect: () => Array, onItemClick?: (item:Object)=>void}} handlers
   *   collect — собирает живые элементы (форма {id,title,body,severity,source?});
   *   onItemClick — обработчик клика по живому элементу.
   */
  registerSource(key, handlers) {
    if (!key || !handlers || typeof handlers.collect !== 'function') return;
    this._sources.set(key, handlers);
    this.refresh();
  }

  /** Снимает живой источник. */
  unregisterSource(key) {
    this._sources.delete(key);
    this.refresh();
  }

  /**
   * Пересобирает данные и обновляет бейдж (и список, если меню открыто).
   *
   * Персистентные подтягиваются с API (если включены) только при открытии и по
   * поллингу/событию — здесь используется последний снимок. Бейдж считается по
   * живым (всегда свежие) + непрочитанным персистентным.
   */
  refresh() {
    if (!this.badge) return;
    const live = this._collectLive();
    this._renderBadge(live, this._persisted);
    if (this.isOpen) this._renderList(live, this._persisted);
  }

  /**
   * Собирает живые элементы из всех зарегистрированных источников.
   * Сбой одного источника не должен ломать колокольчик.
   * @private
   * @returns {Array<Object>}
   */
  _collectLive() {
    const items = [];
    for (const [key, handlers] of this._sources) {
      try {
        const collected = handlers.collect();
        if (Array.isArray(collected)) {
          for (const it of collected) {
            items.push({ ...it, source: it.source || key });
          }
        }
      } catch (e) {
        console.warn('[NotificationCenter] источник', key, 'упал при collect:', e);
      }
    }
    return items;
  }

  /**
   * Обновляет счётчик-бейдж: значение и цвет по максимальной критичности.
   * @private
   * @param {Array} live
   * @param {Array} persisted
   */
  _renderBadge(live, persisted) {
    const persistedUnread = countPersistedUnread(persisted);
    const { count, hidden } = computeBadge(persistedUnread, live.length);

    if (hidden) {
      this.badge.classList.add('hidden');
      this.badge.classList.remove('notif-badge--error', 'notif-badge--warning', 'notif-badge--info');
      return;
    }

    this.badge.classList.remove('hidden');
    this.badge.textContent = String(count);

    // Цвет — по непрочитанным персистентным + живым (прочитанные персистентные
    // в окраску бейджа не входят, они уже не «требуют внимания»).
    const unreadPersisted = persisted.filter((n) => n && n.is_read !== true);
    const sev = pickBadgeSeverity([...live, ...unreadPersisted]);
    this.badge.classList.toggle('notif-badge--error', sev === 'error');
    this.badge.classList.toggle('notif-badge--warning', sev === 'warning');
    this.badge.classList.toggle('notif-badge--info', sev === 'info');
  }

  /** Переключает видимость меню. */
  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Открывает меню, подтягивает свежие персистентные и рендерит список. */
  open() {
    this.menu.classList.remove('hidden');
    this.btn.classList.add('active');
    this.isOpen = true;
    this._escapeUnsub = EscapeStack.push(() => this.close());

    // Сначала рисуем по текущему снимку, затем дозагружаем персистентные.
    this._renderList(this._collectLive(), this._persisted);
    if (this.enablePersisted) {
      this._loadPersisted().then(() => {
        if (this.isOpen) this._renderList(this._collectLive(), this._persisted);
      });
    }
  }

  /** Закрывает меню. */
  close() {
    this.menu.classList.add('hidden');
    this.btn.classList.remove('active');
    this.isOpen = false;
    if (this._escapeUnsub) {
      this._escapeUnsub();
      this._escapeUnsub = null;
    }
  }

  /**
   * Снимает все обработчики и таймеры (для тестов / переинициализации).
   */
  destroy() {
    this._stopPolling();
    if (this.btn) this.btn.removeEventListener('click', this._onBtnClick);
    if (this.closeBtn) this.closeBtn.removeEventListener('click', this._onCloseClick);
    if (this.readAllBtn) this.readAllBtn.removeEventListener('click', this._onReadAllClick);
    document.removeEventListener('click', this._onDocClick);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    document.removeEventListener('notifications:refresh', this._onRefreshEvent);
    if (this._escapeUnsub) {
      this._escapeUnsub();
      this._escapeUnsub = null;
    }
  }

  // ── Персистентный источник (API) ────────────────────────────────────────

  /** @private Запускает фоновый поллинг (пауза при скрытой вкладке). */
  _startPolling() {
    this._stopPolling();
    this._pollTimer = setInterval(() => {
      if (document.hidden) return;
      this._loadPersisted().then(() => this.refresh());
    }, POLL_INTERVAL_MS);
  }

  /** @private */
  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /** @private При возврате на вкладку — освежаем данные. */
  _handleVisibilityChange() {
    if (!document.hidden && this.enablePersisted) {
      this._loadPersisted().then(() => this.refresh());
    }
  }

  /**
   * Загружает персистентные уведомления с API и сохраняет снимок.
   * Сетевой сбой не должен ломать колокольчик — снимок остаётся прежним.
   * @private
   * @returns {Promise<void>}
   */
  async _loadPersisted() {
    if (!this.enablePersisted) return;
    try {
      const resp = await fetch(AppConfig.api.getUrl('/api/v1/notifications?limit=50'), {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (Array.isArray(data)) this._persisted = data;
    } catch (e) {
      // тихо — оставляем прежний снимок
    }
  }

  /**
   * POST mark-read для персистентного уведомления + локальное обновление снимка.
   * @private
   * @param {string} id
   */
  async _markRead(id) {
    const item = this._persisted.find((n) => n && n.id === id);
    if (item) item.is_read = true; // оптимистично
    this.refresh();
    try {
      await fetch(AppConfig.api.getUrl(`/api/v1/notifications/${encodeURIComponent(id)}/read`), {
        method: 'POST',
      });
    } catch (e) {
      // не критично — снимок освежится поллингом
    }
  }

  /**
   * POST dismiss для персистентного уведомления + удаление из снимка.
   * @private
   * @param {string} id
   */
  async _dismiss(id) {
    this._persisted = this._persisted.filter((n) => !(n && n.id === id));
    this.refresh();
    try {
      await fetch(AppConfig.api.getUrl(`/api/v1/notifications/${encodeURIComponent(id)}/dismiss`), {
        method: 'POST',
      });
    } catch (e) {
      // не критично
    }
  }

  /** @private POST read-all + обновление. */
  async _markAllRead() {
    for (const n of this._persisted) {
      if (n) n.is_read = true;
    }
    this.refresh();
    try {
      await fetch(AppConfig.api.getUrl('/api/v1/notifications/read-all'), { method: 'POST' });
      await this._loadPersisted();
      this.refresh();
    } catch (e) {
      // не критично
    }
  }

  // ── Рендер ──────────────────────────────────────────────────────────────

  /**
   * Рендерит единый список (живые сверху, затем персистентные). XSS-safe.
   * @private
   * @param {Array} live
   * @param {Array} persisted
   */
  _renderList(live, persisted) {
    const feed = mergeFeed(live, persisted);
    this.body.innerHTML = '';

    if (!feed.length) {
      const empty = document.createElement('div');
      empty.className = 'notifications-empty';
      empty.textContent = 'Уведомлений нет';
      this.body.appendChild(empty);
      return;
    }

    for (const item of feed) {
      this.body.appendChild(this._buildItem(item));
    }
  }

  /**
   * Строит DOM одной записи списка.
   * @private
   * @param {Object} item Нормализованный элемент (см. core).
   * @returns {HTMLElement}
   */
  _buildItem(item) {
    const row = document.createElement('div');
    row.className = 'notification-item';
    if (item.kind === 'persisted' && item.is_read) {
      row.classList.add('notification-item--read');
    }

    const dot = document.createElement('span');
    dot.className = 'notif-dot notif-dot--' + item.severity;
    row.appendChild(dot);

    const textWrap = document.createElement('span');
    textWrap.className = 'notification-item-text';

    const title = document.createElement('span');
    title.className = 'notification-item-title';
    title.textContent = item.title || (item.kind === 'live' ? 'Замечание' : 'Уведомление');
    textWrap.appendChild(title);

    if (item.body) {
      const body = document.createElement('span');
      body.className = 'notification-item-body';
      body.textContent = item.body;
      textWrap.appendChild(body);
    }
    row.appendChild(textWrap);

    // Крестик dismiss — только у персистентных.
    if (item.kind === 'persisted') {
      const close = document.createElement('button');
      close.className = 'notification-item-dismiss';
      close.setAttribute('aria-label', 'Скрыть уведомление');
      close.textContent = '×'; // ×
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        this._dismiss(item.id);
      });
      row.appendChild(close);
    }

    row.addEventListener('click', () => this._handleItemClick(item));
    return row;
  }

  /**
   * Обработчик клика по записи.
   *   - живая → её onClick (например, переход к таблице);
   *   - персистентная → mark-read, затем переход по link (если задан).
   * @private
   * @param {Object} item
   */
  _handleItemClick(item) {
    if (item.kind === 'live') {
      if (typeof item.onClick === 'function') {
        try { item.onClick(); } catch (e) { console.warn('[NotificationCenter] onClick упал:', e); }
      }
      return;
    }

    // persisted
    this._markRead(item.id);
    if (item.link) {
      let url = AppConfig.api.getUrl(item.link);
      if (item.element_ref) {
        // best-effort: добавляем якорь на элемент.
        url += (url.includes('#') ? '' : '#') + encodeURIComponent(item.element_ref);
      }
      this.close();
      window.location.href = url;
    }
  }

  /**
   * Закрытие по клику вне меню/кнопки.
   * @private
   * @param {MouseEvent} e
   */
  _handleOutsideClick(e) {
    if (!this.isOpen) return;
    const container = this.btn.closest('.notifications-menu-container');
    const insideMenu = this.menu.contains(e.target);
    const insideContainer = container ? container.contains(e.target) : this.btn.contains(e.target);
    if (!insideMenu && !insideContainer) {
      this.close();
    }
  }
}

// Window-global для совместимости с inline-скриптами в шаблонах.
if (typeof window !== 'undefined') {
  window.NotificationCenter = NotificationCenter;
}
