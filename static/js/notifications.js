/**
 * Централизованная система уведомлений
 * Управляет всплывающими сообщениями в приложении
 */

class NotificationManager {
    constructor() {
        this.container = null;
        this.notifications = new Map();
        this.init();
    }

    /**
     * Инициализирует контейнер для уведомлений
     */
    init() {
        // Проверяем, есть ли уже контейнер
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
        const id = `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Создаем элемент уведомления
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

        // Кнопка закрытия
        const closeButton = document.createElement('button');
        closeButton.className = 'notification-close';
        closeButton.textContent = '×';
        closeButton.setAttribute('aria-label', 'Закрыть уведомление');
        closeButton.addEventListener('click', () => {
            this.hide(id);
        });
        notification.appendChild(closeButton);

        // Добавляем в контейнер
        this.container.appendChild(notification);
        this.notifications.set(id, notification);

        // Автоматическое удаление
        if (duration > 0) {
            setTimeout(() => {
                this.hide(id);
            }, duration);
        }

        return id;
    }

    /**
     * Скрывает уведомление
     * @param {string} id - ID уведомления
     */
    hide(id) {
        const notification = this.notifications.get(id);
        if (!notification) return;

        // Добавляем класс для анимации исчезновения
        notification.classList.add('hiding');

        // Удаляем элемент после завершения анимации
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
            this.notifications.delete(id);
        }, 250); // Длительность анимации из CSS
    }

    /**
     * Скрывает все уведомления
     */
    hideAll() {
        this.notifications.forEach((_, id) => {
            this.hide(id);
        });
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
