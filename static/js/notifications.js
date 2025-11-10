/**
 * Централизованная система уведомлений
 * Управляет всплывающими сообщениями в приложении с поддержкой группировки повторяющихся
 */

class NotificationManager {
    constructor() {
        this.container = null;
        this.notifications = new Map();
        this.messageCache = new Map(); // Кеш для отслеживания повторяющихся сообщений
        this.init();
    }

    /**
     * Инициализирует контейнер для уведомлений
     */
    init() {
        this.container = document.querySelector('.notification-container');

        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'notification-container';
            document.body.appendChild(this.container);
        }
    }

    /**
     * Показывает уведомление
     * @param {string} message - Текст уведомления
     * @param {string} type - Тип уведомления ('success', 'error', 'info')
     * @param {number} duration - Длительность отображения в миллисекундах (0 = не скрывать автоматически)
     * @returns {string} ID уведомления
     */
    show(message, type = 'info', duration = 2500) {
        const cacheKey = `${type}:${message}`;

        // Проверяем, есть ли уже такое же уведомление
        if (this.messageCache.has(cacheKey)) {
            const existingData = this.messageCache.get(cacheKey);
            const existingNotification = this.notifications.get(existingData.id);

            if (existingNotification) {
                // Увеличиваем счетчик
                existingData.count++;

                // Обновляем бейдж со счетчиком
                this.updateCounter(existingNotification, existingData.count);

                // Продлеваем время жизни уведомления
                clearTimeout(existingData.timer);
                const extendedDuration = duration + (existingData.count * 400); // +400мс за каждое повторение

                existingData.timer = setTimeout(() => {
                    this.hide(existingData.id);
                    this.messageCache.delete(cacheKey);
                }, extendedDuration);

                return existingData.id;
            } else {
                // Кеш устарел, очищаем
                this.messageCache.delete(cacheKey);
            }
        }

        // Создаем новое уведомление
        const id = `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.dataset.notificationId = id;

        // Иконка
        const icon = document.createElement('div');
        icon.className = 'notification-icon';
        icon.textContent = this.getIcon(type);
        notification.appendChild(icon);

        // Контент
        const content = document.createElement('div');
        content.className = 'notification-content';

        const messageElement = document.createElement('div');
        messageElement.className = 'notification-message';
        messageElement.textContent = message;
        content.appendChild(messageElement);

        notification.appendChild(content);

        // Счетчик повторений (изначально скрыт)
        const counter = document.createElement('span');
        counter.className = 'notification-counter';
        counter.style.display = 'none';
        counter.textContent = '2';
        notification.appendChild(counter);

        // Кнопка закрытия
        const closeButton = document.createElement('button');
        closeButton.className = 'notification-close';
        closeButton.textContent = '×';
        closeButton.setAttribute('aria-label', 'Закрыть уведомление');
        closeButton.addEventListener('click', () => {
            this.hide(id);
            this.messageCache.delete(cacheKey);
        });
        notification.appendChild(closeButton);

        // Добавляем в контейнер
        this.container.appendChild(notification);
        this.notifications.set(id, notification);

        // Автоматическое удаление
        let timer = null;
        if (duration > 0) {
            timer = setTimeout(() => {
                this.hide(id);
                this.messageCache.delete(cacheKey);
            }, duration);
        }

        // Сохраняем в кеш для отслеживания повторений
        this.messageCache.set(cacheKey, {
            id: id,
            count: 1,
            timer: timer
        });

        return id;
    }

    /**
     * Обновляет счетчик повторений в уведомлении
     * @param {HTMLElement} notification - Элемент уведомления
     * @param {number} count - Количество повторений
     */
    updateCounter(notification, count) {
        const counter = notification.querySelector('.notification-counter');
        if (counter) {
            counter.textContent = count;
            if (count > 1) {
                counter.style.display = 'flex';

                // Небольшая анимация при обновлении
                counter.style.transform = 'scale(1.3)';
                setTimeout(() => {
                    counter.style.transform = 'scale(1)';
                }, 150);
            }
        }
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
        }, 250);
    }

    /**
     * Скрывает все уведомления
     */
    hideAll() {
        this.notifications.forEach((_, id) => {
            this.hide(id);
        });
        this.messageCache.clear();
    }

    /**
     * Возвращает иконку для типа уведомления
     * @param {string} type - Тип уведомления
     * @returns {string} Иконка
     */
    getIcon(type) {
        const icons = {
            success: '✓',
            error: '✗',
            info: 'ℹ'
        };
        return icons[type] || icons.info;
    }

    /**
     * Показывает уведомление об успехе
     * @param {string} message - Текст уведомления
     * @param {number} duration - Длительность отображения
     * @returns {string} ID уведомления
     */
    success(message, duration = 2500) {
        return this.show(message, 'success', duration);
    }

    /**
     * Показывает уведомление об ошибке
     * @param {string} message - Текст уведомления
     * @param {number} duration - Длительность отображения
     * @returns {string} ID уведомления
     */
    error(message, duration = 3000) {
        return this.show(message, 'error', duration);
    }

    /**
     * Показывает информационное уведомление
     * @param {string} message - Текст уведомления
     * @param {number} duration - Длительность отображения
     * @returns {string} ID уведомления
     */
    info(message, duration = 2500) {
        return this.show(message, 'info', duration);
    }
}

// Создаем глобальный экземпляр
const Notifications = new NotificationManager();
