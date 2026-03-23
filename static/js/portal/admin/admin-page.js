/**
 * Главный контроллер страницы администрирования ролей
 *
 * Загружает справочник пользователей и список ролей,
 * координирует поиск и управление ролями.
 */
class AdminPage {
    static _usersDirectory = [];
    static _allRoles = [];

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

            AdminSearch.init();
            AdminRoles.init(this._allRoles);
            AdminRoles.setUsers(this._usersDirectory);

            console.log('AdminPage: инициализация завершена');
        } catch (error) {
            console.error('AdminPage: ошибка инициализации:', error);
            Notifications.error('Не удалось загрузить данные администрирования');
        }
    }

    /**
     * Обновляет роли пользователя в локальном состоянии
     * @param {string} username - Имя пользователя
     * @param {Array} roles - Массив ролей
     */
    static updateUserRoles(username, roles) {
        const user = this._usersDirectory.find(u => u.username === username);
        if (user) {
            user.roles = roles;
        }
    }
}

// Экспортируем в глобальную область видимости
window.AdminPage = AdminPage;
