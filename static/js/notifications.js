/**
 * Централизованная система уведомлений
 *
 * Управляет всплывающими сообщениями в приложении с поддержкой
 * группировки повторяющихся уведомлений и автоматического скрытия.
 */
class NotificationManager {
    constructor() {
        this.container = null;
        this.notifications = new Map();
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
        return container;
    }

    /**
     * Показывает уведомление
     *
     * @param {string} message - Текст уведомления
     * @param {string} type - Тип уведомления ('success', 'error', 'info')
     * @param {number} duration - Длительность отображения в миллисекундах (0 = не скрывать)
     * @returns {string} ID уведомления
     */
    show(message, type = 'info', duration = AppConfig.notifications.duration.info) {
        const cacheKey = `${type}:${message}`;

        // Проверяем наличие дубликата
        const existingId = this._handleDuplicate(cacheKey, duration);
        if (existingId) return existingId;

        // Создаем новое уведомление
        return this._createNotification(message, type, duration, cacheKey);
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
     * @param {string} cacheKey - Ключ кеша
     * @returns {string} ID уведомления
     */
    _createNotification(message, type, duration, cacheKey) {
        const id = this._generateId();
        const notification = this._buildNotificationElement(id, message, type);

        this.container.appendChild(notification);
        this.notifications.set(id, notification);

        // Настраиваем автоматическое скрытие
        const timer = this._setupAutoHide(id, duration, cacheKey);

        // Сохраняем в кеш
        this.messageCache.set(cacheKey, {id, count: 1, timer});

        return id;
    }

    /**
     * Генерирует уникальный ID
     * @private
     * @returns {string} Уникальный ID
     */
    _generateId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `notification_${timestamp}_${random}`;
    }

    /**
     * Создает DOM-элемент уведомления
     * @private
     * @param {string} id - ID уведомления
     * @param {string} message - Текст
     * @param {string} type - Тип
     * @returns {HTMLElement} Элемент уведомления
     */
    _buildNotificationElement(id, message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.dataset.notificationId = id;

        notification.appendChild(this._createIcon(type));
        notification.appendChild(this._createContent(message));
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
     * @returns {HTMLElement} Элемент контента
     */
    _createContent(message) {
        const content = document.createElement('div');
        content.className = 'notification-content';

        const messageElement = document.createElement('div');
        messageElement.className = 'notification-message';
        messageElement.textContent = message;

        content.appendChild(messageElement);
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
        if (duration <= 0) return null;

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
                notification.parentNode.removeChild(notification);
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
        return AppConfig.notifications.icons[type] ||
            AppConfig.notifications.icons.info;
    }

    /**
     * Показывает уведомление об успехе
     * @param {string} message - Текст уведомления
     * @param {number} duration - Длительность отображения
     * @returns {string} ID уведомления
     */
    success(message, duration = AppConfig.notifications.duration.success) {
        return this.show(message, 'success', duration);
    }

    /**
     * Показывает уведомление об ошибке
     * @param {string} message - Текст уведомления
     * @param {number} duration - Длительность отображения
     * @returns {string} ID уведомления
     */
    error(message, duration = AppConfig.notifications.duration.error) {
        return this.show(message, 'error', duration);
    }

    /**
     * Показывает информационное уведомление
     * @param {string} message - Текст уведомления
     * @param {number} duration - Длительность отображения
     * @returns {string} ID уведомления
     */
    info(message, duration = AppConfig.notifications.duration.info) {
        return this.show(message, 'info', duration);
    }
}

// Создаем глобальный экземпляр
const Notifications = new NotificationManager();
