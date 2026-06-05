/**
 * Менеджер колокольчика «Замечания по таблицам».
 *
 * Считывает контентные/структурные замечания (ValidationTable.collectContentWarnings),
 * показывает счётчик-бейдж по критичности и выпадающий список. Клик по записи
 * переводит к проблемной таблице в предпросмотре и подсвечивает её рамкой.
 *
 * Источник истины — те же замечания, что красят рамки таблиц в preview.js.
 * Живое обновление — по событию `preview:content-changed`.
 */
import { EscapeStack } from '../../shared/escape-stack.js';
import { ValidationTable } from '../validation/validation-table.js';

export class NotificationsManager {
    constructor() {
        this.btn = null;
        this.menu = null;
        this.body = null;
        this.badge = null;
        this.closeBtn = null;
        this.isOpen = false;
        this._escapeUnsub = null;

        this.init();
    }

    /**
     * Инициализация: захват элементов, подписка на события, начальный бейдж.
     */
    init() {
        this.btn = document.getElementById('notificationsBtn');
        this.menu = document.getElementById('notificationsMenu');
        this.body = document.getElementById('notificationsBody');
        this.badge = document.getElementById('notificationsBadge');
        this.closeBtn = document.getElementById('closeNotificationsBtn');

        if (!this.btn || !this.menu || !this.body || !this.badge) {
            console.warn('Notifications: не найдены необходимые элементы');
            return;
        }

        this.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.close();
            });
        }

        // Закрытие при клике вне колокольчика.
        document.addEventListener('click', (e) => {
            if (this.isOpen &&
                !this.menu.contains(e.target) &&
                !this.btn.closest('.notifications-menu-container').contains(e.target)) {
                this.close();
            }
        });

        // Живое обновление бейджа/списка при изменении содержимого предпросмотра.
        document.addEventListener('preview:content-changed', () => this.refresh());

        // Начальное состояние бейджа.
        this.refresh();
    }

    /**
     * Пересобирает замечания и обновляет бейдж (и список, если меню открыто).
     */
    refresh() {
        const warnings = this._collect();
        this._renderBadge(warnings);
        if (this.isOpen) this._renderList(warnings);
    }

    /**
     * Собирает текущие замечания (сбой сбора не должен ломать колокольчик).
     * @private
     * @returns {Array<{tableId:string, tableName:string, issue:string, severity:string}>}
     */
    _collect() {
        try {
            return ValidationTable.collectContentWarnings();
        } catch (e) {
            return [];
        }
    }

    /**
     * Обновляет счётчик-бейдж. Цвет error важнее warning.
     * @private
     * @param {Array} warnings
     */
    _renderBadge(warnings) {
        if (warnings.length === 0) {
            this.badge.classList.add('hidden');
            return;
        }
        this.badge.classList.remove('hidden');
        this.badge.textContent = String(warnings.length);

        const hasError = warnings.some((w) => w.severity === 'error');
        this.badge.classList.toggle('notif-badge--error', hasError);
        this.badge.classList.toggle('notif-badge--warning', !hasError);
    }

    /**
     * Переключает видимость меню.
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Открывает меню и рендерит актуальный список.
     */
    open() {
        this.menu.classList.remove('hidden');
        this.btn.classList.add('active');
        this.isOpen = true;
        this._escapeUnsub = EscapeStack.push(() => this.close());
        this._renderList(this._collect());
    }

    /**
     * Закрывает меню.
     */
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
     * Рендерит список замечаний (XSS-safe, через textContent).
     * @private
     * @param {Array} warnings
     */
    _renderList(warnings) {
        this.body.innerHTML = '';

        if (!warnings.length) {
            const empty = document.createElement('div');
            empty.className = 'notifications-empty';
            empty.textContent = 'Замечаний нет';
            this.body.appendChild(empty);
            return;
        }

        warnings.forEach((w) => {
            const item = document.createElement('div');
            item.className = 'notification-item';

            const dot = document.createElement('span');
            dot.className = 'notif-dot ' + (w.severity === 'error' ? 'notif-dot--error' : 'notif-dot--warning');
            item.appendChild(dot);

            const text = document.createElement('span');
            text.className = 'notification-item-text';
            text.textContent = `${w.tableName}: ${w.issue}`;
            item.appendChild(text);

            item.addEventListener('click', () => this._navigateToTable(w.tableId));
            this.body.appendChild(item);
        });
    }

    /**
     * Переходит к таблице в предпросмотре и подсвечивает её.
     *
     * Если inline-панель видима — скроллит к таблице в ней. Иначе открывает
     * модальное меню предпросмотра и подсвечивает таблицу там.
     * @private
     * @param {string} tableId
     */
    _navigateToTable(tableId) {
        if (tableId == null) return;
        const sel = `.preview-table-wrapper[data-table-id="${CSS.escape(String(tableId))}"]`;
        const inline = document.querySelector('#preview ' + sel);
        if (inline && inline.offsetParent !== null) {           // inline-панель видима (шаг 1)
            this.close();
            this._scrollAndFlash(inline);
            return;
        }
        // иначе открываем модальное меню (шаг 2) и подсвечиваем там
        if (window.previewMenuManager) {
            this.close();
            window.previewMenuManager.open();
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const inModal = document.querySelector('#previewMenuBody ' + sel);
                if (inModal) this._scrollAndFlash(inModal);
            }));
        }
    }

    /**
     * Скроллит к элементу и кратко подсвечивает его рамкой.
     * @private
     * @param {HTMLElement} el
     */
    _scrollAndFlash(el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('preview-table-wrapper--flash');
        setTimeout(() => el.classList.remove('preview-table-wrapper--flash'), 1300);
    }
}

// Инициализация при загрузке страницы.
document.addEventListener('DOMContentLoaded', () => {
    window.notificationsManager = new NotificationsManager();
});

// Window-global для совместимости с inline-скриптами в шаблонах.
window.NotificationsManager = NotificationsManager;
