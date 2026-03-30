/**
 * Главный контроллер страницы администрирования ролей
 */
class AdminPage {
    static _usersDirectory = [];
    static _allRoles = [];

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
     * Инициализирует кнопку добавления пользователя
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
}

window.AdminPage = AdminPage;
