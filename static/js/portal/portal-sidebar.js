/**
 * Общий менеджер sidebar для landing и acts-manager страниц
 *
 * Управляет сворачиванием/разворачиванием sidebar,
 * навигацией между страницами и загрузкой информации о пользователе.
 */
class LandingSidebar {
    static _storageKey = 'sidebar_collapsed';

    /**
     * Инициализирует sidebar
     */
    static init() {
        this._restoreState();
        this._setupToggle();
        this._setupNavigation();
        this._setupChatButton();
        this._loadUserInfo();
        this._setupAdminButton();
        this._filterNavByRoles();

        console.log('LandingSidebar: инициализация завершена');
    }

    /**
     * Восстанавливает состояние сворачивания из localStorage
     * @private
     */
    static _restoreState() {
        const sidebar = document.getElementById('landingSidebar');
        if (!sidebar) return;

        const collapsed = localStorage.getItem(this._storageKey) === 'true';
        if (collapsed) {
            sidebar.classList.add('collapsed');
        }
    }

    /**
     * Настраивает кнопку сворачивания/разворачивания
     * @private
     */
    static _setupToggle() {
        const toggleBtn = document.getElementById('sidebarToggleBtn');
        const sidebar = document.getElementById('landingSidebar');
        if (!toggleBtn || !sidebar) return;

        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const isCollapsed = sidebar.classList.contains('collapsed');
            localStorage.setItem(this._storageKey, isCollapsed.toString());
        });
    }

    /**
     * Настраивает навигацию по ссылкам sidebar
     * @private
     */
    static _setupNavigation() {
        // Навигация по активным ссылкам
        const navLinks = document.querySelectorAll('.sidebar-nav a.sidebar-nav-item');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const href = link.getAttribute('href');
                if (href) {
                    window.location.href = AppConfig.api.getUrl(href);
                }
            });
        });

        // Обработчики для disabled кнопок
        const disabledButtons = document.querySelectorAll('.sidebar-nav-item[disabled]');
        disabledButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const toolName = button.querySelector('.sidebar-nav-label')?.textContent;
                console.log(`Инструмент "${toolName}" пока недоступен`);
            });
        });
    }

    /**
     * Обработчик кнопки чата в footer сайдбара
     * @private
     */
    static _setupChatButton() {
        const chatBtn = document.getElementById('sidebarChatBtn');
        if (!chatBtn) return;

        chatBtn.addEventListener('click', () => {
            // На landing page: разворачиваем встроенный чат
            const chatPanel = document.getElementById('chatPanel');
            if (chatPanel && typeof LandingPage !== 'undefined') {
                LandingPage.expandChat();
                return;
            }

            // На других страницах: открываем модальный чат
            if (typeof ChatModalManager !== 'undefined') {
                ChatModalManager.open();
            }
        });
    }

    /**
     * Загружает информацию о текущем пользователе в topbar
     * @private
     */
    static _loadUserInfo() {
        try {
            const username = AuthManager.getCurrentUser();
            const userNameElement = document.getElementById('currentUserName');

            if (userNameElement && username) {
                userNameElement.textContent = username;
            }
        } catch (error) {
            console.error('LandingSidebar: ошибка загрузки информации о пользователе:', error);
        }
    }

    /**
     * Настраивает кнопку администрирования в footer
     * Показывает кнопку только для пользователей с ролью admin
     * @private
     */
    static async _setupAdminButton() {
        const btn = document.getElementById('sidebarAdminBtn');
        if (!btn) return;

        try {
            const rolesData = await this._loadRolesData();

            if (rolesData.is_admin) {
                btn.classList.remove('hidden');
                btn.addEventListener('click', () => {
                    window.location.href = AppConfig.api.getUrl('/admin');
                });
            }
        } catch (error) {
            console.error('LandingSidebar: ошибка проверки роли админа:', error);
        }
    }

    /**
     * Фильтрует элементы навигации по ролям пользователя
     * Скрывает доменные ссылки, к которым нет доступа
     * @private
     */
    static async _filterNavByRoles() {
        const navItems = document.querySelectorAll('.sidebar-nav-item[data-domain]');

        try {
            const rolesData = await this._loadRolesData();

            // Определяем разрешённые домены
            const allowAll = rolesData.is_admin;
            const userDomains = new Set(rolesData.roles.map(r => r.domain_name).filter(Boolean));

            // Показываем разрешённые пункты через класс role-visible
            navItems.forEach(item => {
                const domain = item.dataset.domain;
                if (allowAll || !domain || userDomains.has(domain)) {
                    item.classList.add('role-visible');
                }
            });

            // Скрываем группы без видимых пунктов
            document.querySelectorAll('.sidebar-nav-group').forEach(group => {
                let nextEl = group.nextElementSibling;
                let hasVisible = false;
                while (nextEl && !nextEl.classList.contains('sidebar-nav-group')) {
                    if (nextEl.classList.contains('sidebar-nav-item') && nextEl.classList.contains('role-visible')) {
                        hasVisible = true;
                        break;
                    }
                    nextEl = nextEl.nextElementSibling;
                }
                if (!hasVisible) {
                    group.classList.add('role-hidden');
                }
            });
        } catch (error) {
            console.error('LandingSidebar: ошибка фильтрации по ролям:', error);
            // Fallback: показать все пункты
            navItems.forEach(item => item.classList.add('role-visible'));
        }
    }

    /**
     * Загружает данные о ролях пользователя с кэшированием в sessionStorage
     * @returns {Promise<Object>} Данные о ролях {is_admin, roles}
     * @private
     */
    static async _loadRolesData() {
        const cached = sessionStorage.getItem('user_roles_data');
        if (cached) {
            return JSON.parse(cached);
        }

        const rolesData = await APIClient.loadMyRoles();
        sessionStorage.setItem('user_roles_data', JSON.stringify(rolesData));
        return rolesData;
    }
}

// Экспортируем в глобальную область видимости
window.LandingSidebar = LandingSidebar;
