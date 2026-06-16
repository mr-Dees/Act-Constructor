/**
 * Централизованная система уведомлений
 *
 * Управляет всплывающими сообщениями в приложении с поддержкой
 * группировки повторяющихся уведомлений и автоматического скрытия.
 */
import { AppConfig } from './app-config.js';

export class NotificationManager {
    constructor() {
        /** @type {HTMLElement|null} Контейнер для уведомлений */
        this.container = null;

        /** @type {Map<string, HTMLElement>} Активные уведомления */
        this.notifications = new Map();

        /** @type {Map<string, Object>} Кеш сообщений для группировки */
        this.messageCache = new Map();

        this.init();
    }

    /**
     * Инициализирует контейнер для уведомлений
     */
    init() {
        this.container = document.querySelector('.notification-container');

        if (!this.container) {
            this.container = this._createContainer();
            document.body.appendChild(this.container);
        }
    }

    /**
     * Создает контейнер для уведомлений
     * @private
     * @returns {HTMLElement} Контейнер для уведомлений
     */
    _createContainer() {
        const container = document.createElement('div');
        container.className = 'notification-container';
        // Контейнер озвучивается screen reader'ами как ARIA live region.
        // Per-notification роль (alert/status) ставится в _buildNotificationElement.
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', 'Уведомления');
        return container;
    }

    /**
     * Показывает уведомление
     *
     * @param {string} message - Текст уведомления
     * @param {'success'|'error'|'info'|'warning'} type - Тип уведомления
     * @param {number} [duration] - Длительность отображения в миллисекундах (0 = не скрывать)
     * @param {Object} [options] - Дополнительные опции
     * @param {{label: string, onClick: Function}} [options.action] - Action-кнопка
     *        внутри уведомления (например «Отменить» у toast'а удаления).
     *        Клик скрывает уведомление и вызывает onClick.
     * @returns {string} ID уведомления
     */
    show(message, type = 'info', duration = AppConfig.notifications.duration.info, options = {}) {
        const action = options.action || null;

        // Уведомления с action-кнопкой не группируются: каждое удаление —
        // отдельный toast со своим обработчиком (cacheKey не используется).
        const cacheKey = action ? null : `${type}:${message}`;

        if (cacheKey) {
            // Проверяем наличие дубликата
            const existingId = this._handleDuplicate(cacheKey, duration);
            if (existingId) return existingId;
        }

        // Создаем новое уведомление
        return this._createNotification(message, type, duration, cacheKey, action);
    }

    /**
     * Обрабатывает дублирующееся уведомление
     * @private
     * @param {string} cacheKey - Ключ кеша
     * @param {number} duration - Длительность
     * @returns {string|null} ID существующего уведомления или null
     */
    _handleDuplicate(cacheKey, duration) {
        if (!this.messageCache.has(cacheKey)) return null;

        const existingData = this.messageCache.get(cacheKey);
        const existingNotification = this.notifications.get(existingData.id);

        if (!existingNotification) {
            this.messageCache.delete(cacheKey);
            return null;
        }

        // Увеличиваем счетчик
        existingData.count++;
        this._updateCounter(existingNotification, existingData.count);

        // Продлеваем время жизни
        clearTimeout(existingData.timer);
        const extendedDuration = this._calculateExtendedDuration(
            duration,
            existingData.count
        );

        existingData.timer = setTimeout(() => {
            this.hide(existingData.id);
            this.messageCache.delete(cacheKey);
        }, extendedDuration);

        return existingData.id;
    }

    /**
     * Вычисляет продленную длительность показа
     * @private
     * @param {number} baseDuration - Базовая длительность
     * @param {number} count - Количество повторений
     * @returns {number} Продленная длительность
     */
    _calculateExtendedDuration(baseDuration, count) {
        if (!AppConfig.notifications.grouping.enabled) {
            return baseDuration;
        }

        const extension = AppConfig.notifications.grouping.extensionPerRepeat;
        return baseDuration + (count * extension);
    }

    /**
     * Создает новое уведомление
     * @private
     * @param {string} message - Текст уведомления
     * @param {string} type - Тип уведомления
     * @param {number} duration - Длительность
     * @param {string|null} cacheKey - Ключ кеша (null — без группировки)
     * @param {{label: string, onClick: Function}|null} [action] - Action-кнопка
     * @returns {string} ID уведомления
     */
    _createNotification(message, type, duration, cacheKey, action = null) {
        // H-N8-UX: глобальный cap. При переполнении вытесняем самый старый
        // (Map хранит порядок вставки, keys().next() → oldest) синхронно,
        // без hide()-анимации — иначе DOM-узел висит ещё ~250 мс и cap течёт.
        const cap = AppConfig.notifications.maxConcurrent;
        while (this.notifications.size >= cap) {
            const oldestId = this.notifications.keys().next().value;
            if (!oldestId) break;
            this._evictImmediate(oldestId);
        }

        const id = this._generateId();
        const notification = this._buildNotificationElement(id, message, type, action);

        this.container.appendChild(notification);
        this.notifications.set(id, notification);

        // Настраиваем автоматическое скрытие
        const timer = this._setupAutoHide(id, duration, cacheKey);

        // Сохраняем в кеш (только для группируемых уведомлений)
        if (cacheKey) {
            this.messageCache.set(cacheKey, {id, count: 1, timer});
        }

        return id;
    }

    /**
     * Синхронно удаляет уведомление и чистит кеш (без hide-анимации).
     * Используется для FIFO-вытеснения при переполнении cap.
     * @private
     * @param {string} id - ID уведомления
     */
    _evictImmediate(id) {
        const notification = this.notifications.get(id);
        if (notification && notification.parentNode) {
            notification.remove();
        }
        this.notifications.delete(id);
        // Чистим cache-entry и его pending-таймер, чтобы не выстрелил hide()
        // на уже удалённый id.
        for (const [key, value] of this.messageCache.entries()) {
            if (value.id === id) {
                if (value.timer) clearTimeout(value.timer);
                this.messageCache.delete(key);
                break;
            }
        }
    }

    /**
     * Генерирует уникальный ID
     * @private
     * @returns {string} Уникальный ID
     */
    _generateId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 9);
        return `notification_${timestamp}_${random}`;
    }

    /**
     * Создает DOM-элемент уведомления
     * @private
     * @param {string} id - ID уведомления
     * @param {string} message - Текст
     * @param {string} type - Тип
     * @param {{label: string, onClick: Function}|null} [action] - Action-кнопка
     * @returns {HTMLElement} Элемент уведомления
     */
    _buildNotificationElement(id, message, type, action = null) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.dataset.notificationId = id;

        // Error → assertive (role=alert), остальные — polite (role=status).
        // Screen reader дочитает текущую реплику, потом озвучит уведомление.
        if (type === 'error') {
            notification.setAttribute('role', 'alert');
            notification.setAttribute('aria-live', 'assertive');
        } else {
            notification.setAttribute('role', 'status');
            notification.setAttribute('aria-live', 'polite');
        }
        notification.setAttribute('aria-atomic', 'true');

        notification.appendChild(this._createIcon(type));
        notification.appendChild(this._createContent(message, id, action));
        notification.appendChild(this._createCounter());
        notification.appendChild(this._createCloseButton(id));

        return notification;
    }

    /**
     * Создает иконку уведомления
     * @private
     * @param {string} type - Тип уведомления
     * @returns {HTMLElement} Элемент иконки
     */
    _createIcon(type) {
        const icon = document.createElement('div');
        icon.className = 'notification-icon';
        icon.textContent = this._getIcon(type);
        return icon;
    }

    /**
     * Создает контент уведомления
     * @private
     * @param {string} message - Текст сообщения
     * @param {string} id - ID уведомления (для скрытия по клику на action)
     * @param {{label: string, onClick: Function}|null} [action] - Action-кнопка
     * @returns {HTMLElement} Элемент контента
     */
    _createContent(message, id, action = null) {
        const content = document.createElement('div');
        content.className = 'notification-content';

        const messageElement = document.createElement('div');
        messageElement.className = 'notification-message';
        messageElement.textContent = message;

        content.appendChild(messageElement);

        if (action && action.label) {
            const actions = document.createElement('div');
            actions.className = 'notification-actions';

            const actionButton = document.createElement('button');
            actionButton.className = 'notification-action';
            actionButton.type = 'button';
            actionButton.textContent = action.label;
            actionButton.addEventListener('click', () => {
                this.hide(id);
                if (typeof action.onClick === 'function') {
                    action.onClick();
                }
            });

            actions.appendChild(actionButton);
            content.appendChild(actions);
        }

        return content;
    }

    /**
     * Создает счетчик повторений
     * @private
     * @returns {HTMLElement} Элемент счетчика
     */
    _createCounter() {
        const counter = document.createElement('span');
        counter.className = 'notification-counter';
        counter.style.display = 'none';
        counter.textContent = '2';
        return counter;
    }

    /**
     * Создает кнопку закрытия
     * @private
     * @param {string} id - ID уведомления
     * @returns {HTMLElement} Кнопка закрытия
     */
    _createCloseButton(id) {
        const closeButton = document.createElement('button');
        closeButton.className = 'notification-close';
        closeButton.textContent = '×';
        closeButton.setAttribute('aria-label', 'Закрыть уведомление');

        closeButton.addEventListener('click', () => {
            this.hide(id);
            this._clearCache(id);
        });

        return closeButton;
    }

    /**
     * Настраивает автоматическое скрытие
     * @private
     * @param {string} id - ID уведомления
     * @param {number} duration - Длительность
     * @param {string} cacheKey - Ключ кеша
     * @returns {number|null} ID таймера или null
     */
    _setupAutoHide(id, duration, cacheKey) {
        if (duration <= 0) {
            // Sticky-уведомление: само не скрывается, но без TTL на messageCache
            // запись остаётся навсегда, пока юзер не нажмёт крестик. При частых
            // sticky-сообщениях с уникальным текстом cache растёт без границ.
            // Дедуп нужен только в коротком окне — после 60 сек считаем дубль
            // отдельным уведомлением (юзер вряд ли заметит «склейку» через минуту).
            const STICKY_DEDUP_TTL_MS = 60_000;
            return setTimeout(() => {
                this.messageCache.delete(cacheKey);
            }, STICKY_DEDUP_TTL_MS);
        }

        return setTimeout(() => {
            this.hide(id);
            this.messageCache.delete(cacheKey);
        }, duration);
    }

    /**
     * Очищает кеш для уведомления
     * @private
     * @param {string} id - ID уведомления
     */
    _clearCache(id) {
        for (const [key, value] of this.messageCache.entries()) {
            if (value.id === id) {
                this.messageCache.delete(key);
                break;
            }
        }
    }

    /**
     * Обновляет счетчик повторений
     * @private
     * @param {HTMLElement} notification - Элемент уведомления
     * @param {number} count - Количество повторений
     */
    _updateCounter(notification, count) {
        const counter = notification.querySelector('.notification-counter');
        if (!counter) return;

        counter.textContent = count;

        if (count > 1) {
            counter.style.display = 'flex';
            this._animateCounter(counter);
        }
    }

    /**
     * Анимирует счетчик при обновлении
     * @private
     * @param {HTMLElement} counter - Элемент счетчика
     */
    _animateCounter(counter) {
        counter.style.transform = 'scale(1.3)';
        setTimeout(() => {
            counter.style.transform = 'scale(1)';
        }, AppConfig.notifications.animation.counterScaleDuration);
    }

    /**
     * Скрывает уведомление
     * @param {string} id - ID уведомления
     */
    hide(id) {
        const notification = this.notifications.get(id);
        if (!notification) return;

        notification.classList.add('hiding');

        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
            this.notifications.delete(id);
        }, AppConfig.notifications.animation.hidingDuration);
    }

    /**
     * Скрывает все уведомления
     */
    hideAll() {
        this.notifications.forEach((_, id) => this.hide(id));
        this.messageCache.clear();
    }

    /**
     * Возвращает иконку для типа уведомления
     * @private
     * @param {string} type - Тип уведомления
     * @returns {string} Иконка
     */
    _getIcon(type) {
        return AppConfig.notifications.icons[type] || AppConfig.notifications.icons.info;
    }

    /**
     * Показывает уведомление об успехе
     * @param {string} message - Текст уведомления
     * @param {number} [duration] - Длительность отображения
     * @returns {string} ID уведомления
     */
    success(message, duration = AppConfig.notifications.duration.success) {
        return this.show(message, 'success', duration);
    }

    /**
     * Показывает уведомление об ошибке
     * @param {string} message - Текст уведомления
     * @param {number} [duration] - Длительность отображения
     * @returns {string} ID уведомления
     */
    error(message, duration = AppConfig.notifications.duration.error) {
        return this.show(message, 'error', duration);
    }

    /**
     * Показывает информационное уведомление
     * @param {string} message - Текст уведомления
     * @param {number} [duration] - Длительность отображения
     * @returns {string} ID уведомления
     */
    info(message, duration = AppConfig.notifications.duration.info) {
        return this.show(message, 'info', duration);
    }

    /**
     * Показывает предупреждение
     * @param {string} message - Текст уведомления
     * @param {number} [duration] - Длительность отображения
     * @returns {string} ID уведомления
     */
    warning(message, duration = AppConfig.notifications.duration.warning) {
        return this.show(message, 'warning', duration);
    }
}

// Создаём глобальный экземпляр. ESM-экспорт + window.* для совместимости с
// inline-скриптами в шаблонах.
export const Notifications = new NotificationManager();
window.Notifications = Notifications;
window.NotificationManager = NotificationManager;
