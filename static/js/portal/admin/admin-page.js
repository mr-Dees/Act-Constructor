/**
 * Главный контроллер страницы администрирования ролей
 *
 * Загружает справочник пользователей и список ролей,
 * координирует поиск и управление ролями.
 */
class AdminPage {
    static _usersDirectory = [];
    static _allRoles = [];
    static _selectedUsers = new Map(); // username -> user data with roles

    /**
     * Инициализирует страницу администрирования
     */
    static async init() {
        try {
            const [directory, roles] = await Promise.all([
                APIClient.loadUserDirectory(),
                APIClient.loadAllRoles(),
            ]);
            this._usersDirectory = directory;
            this._allRoles = roles;

            AdminSearch.init(this._usersDirectory, (user) => this._onUserSelected(user));
            AdminRoles.init(this._allRoles);

            console.log('AdminPage: инициализация завершена');
        } catch (error) {
            console.error('AdminPage: ошибка инициализации:', error);
            Notifications.error('Не удалось загрузить данные администрирования');
        }
    }

    /**
     * Обработчик выбора пользователя из поиска
     * @param {Object} user - Данные пользователя
     * @private
     */
    static _onUserSelected(user) {
        if (this._selectedUsers.has(user.username)) {
            return; // Уже в таблице
        }
        this._selectedUsers.set(user.username, user);
        AdminRoles.addUser(user);
        document.getElementById('adminEmptyState')?.classList.add('hidden');
    }

    /**
     * Удаляет пользователя из таблицы ролей
     * @param {string} username - Имя пользователя
     */
    static removeUser(username) {
        this._selectedUsers.delete(username);
        AdminRoles.removeUser(username);
        if (this._selectedUsers.size === 0) {
            document.getElementById('adminEmptyState')?.classList.remove('hidden');
        }
    }

    /**
     * Обновляет роли пользователя в локальном состоянии
     * @param {string} username - Имя пользователя
     * @param {Array} roles - Массив ролей
     */
    static updateUserRoles(username, roles) {
        const user = this._selectedUsers.get(username);
        if (user) {
            user.roles = roles;
        }
    }
}

// Экспортируем в глобальную область видимости
window.AdminPage = AdminPage;
