/**
 * Главный контроллер страницы администрирования.
 *
 * Управляет тремя разделами:
 *   - "roles"       — управление ролями пользователей (исходный функционал);
 *   - "diagnostics" — observability батчеров и фоновых задач (lazy);
 *   - "audit-log"   — журнал админ-операций (lazy).
 *
 * Lazy-инициализация: тяжёлые tabs подгружают данные только при первом
 * переключении, чтобы не нагружать страницу при открытии "Роли".
 */
import { AdminAddUserDialog } from './admin-add-user-dialog.js';
import { AdminAuditLog } from './admin-audit-log.js';
import { AdminDiagnostics } from './admin-diagnostics.js';
import { AdminRoles } from './admin-roles.js';
import { AdminSearch } from './admin-search.js';
import { APIClient } from '../../shared/api.js';
import { Notifications } from '../../shared/notifications.js';

export class AdminPage {
    static _usersDirectory = [];
    static _allRoles = [];
    static _initializedTabs = new Set();

    static async init() {
        try {
            const [directory, roles] = await Promise.all([
                APIClient.loadUserDirectory(),
                APIClient.loadAllRoles(),
            ]);
            this._usersDirectory = directory;
            this._allRoles = roles;

            AdminSearch.init();
            AdminRoles.init(this._allRoles);
            AdminRoles.setUsers(this._usersDirectory);
            this._initAddUserButton();
            this._initTabs();
            this._initializedTabs.add('roles');

            console.log('AdminPage: инициализация завершена');
        } catch (error) {
            console.error('AdminPage: ошибка инициализации:', error);
            Notifications.error('Не удалось загрузить данные администрирования');
        }
    }

    static updateUserRoles(username, roles) {
        const user = this._usersDirectory.find(u => u.username === username);
        if (user) {
            user.roles = roles;
        } else {
            this._usersDirectory.push({ username, roles });
        }
    }

    /**
     * Инициализирует кнопку добавления пользователя.
     * @private
     */
    static _initAddUserButton() {
        const btn = document.getElementById('adminAddUserBtn');
        if (btn) {
            btn.addEventListener('click', () => {
                AdminAddUserDialog.show(this._allRoles);
            });
        }
    }

    /**
     * Привязывает обработчики переключения tabs.
     * @private
     */
    static _initTabs() {
        const tabs = document.querySelectorAll('.admin-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const name = tab.dataset.tab;
                this._switchTab(name);
            });
        });
    }

    /**
     * Активирует указанный таб и при первом открытии инициализирует
     * соответствующий модуль.
     * @private
     */
    static _switchTab(name) {
        document.querySelectorAll('.admin-tab').forEach(t => {
            const active = t.dataset.tab === name;
            t.classList.toggle('admin-tab--active', active);
            t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('.admin-tab-panel').forEach(p => {
            const active = p.dataset.tabPanel === name;
            p.classList.toggle('admin-tab-panel--active', active);
            if (active) {
                p.removeAttribute('hidden');
            } else {
                p.setAttribute('hidden', '');
            }
        });

        if (this._initializedTabs.has(name)) {
            return;
        }
        this._initializedTabs.add(name);

        if (name === 'diagnostics' && typeof AdminDiagnostics !== 'undefined') {
            AdminDiagnostics.init();
        } else if (name === 'audit-log' && typeof AdminAuditLog !== 'undefined') {
            AdminAuditLog.init();
        }
    }
}

window.AdminPage = AdminPage;
