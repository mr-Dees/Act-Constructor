/**
 * Управление таблицей ролей пользователей
 *
 * Отображает строки пользователей с чипсами ролей,
 * обеспечивает назначение/снятие ролей через API.
 */
class AdminRoles {
    static _allRoles = [];
    static _tableEl = null;

    /**
     * Инициализирует компонент таблицы ролей
     * @param {Array} allRoles - Список всех доступных ролей
     */
    static init(allRoles) {
        this._allRoles = allRoles;
        this._tableEl = document.getElementById('adminRolesTable');
    }

    /**
     * Добавляет пользователя в таблицу ролей
     * @param {Object} user - Данные пользователя
     */
    static addUser(user) {
        if (!this._tableEl) return;

        const row = document.createElement('div');
        row.className = 'admin-roles-row';
        row.dataset.username = user.username;
        row.innerHTML = this._renderRow(user);

        row.querySelectorAll('.admin-role-chip').forEach(chip => {
            chip.addEventListener('click', () => this._toggleRole(user.username, chip));
        });

        const removeBtn = row.querySelector('.admin-remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => AdminPage.removeUser(user.username));
        }

        this._tableEl.appendChild(row);
    }

    /**
     * Удаляет пользователя из таблицы ролей
     * @param {string} username - Имя пользователя
     */
    static removeUser(username) {
        const row = this._tableEl?.querySelector(`[data-username="${username}"]`);
        if (row) row.remove();
    }

    /**
     * Генерирует HTML содержимого строки пользователя
     * @param {Object} user - Данные пользователя
     * @returns {string} HTML строки
     * @private
     */
    static _renderRow(user) {
        const userRoleIds = new Set(user.roles.map(r => r.id));
        const chips = this._allRoles.map(role => {
            const active = userRoleIds.has(role.id);
            return `<button class="admin-role-chip ${active ? 'active' : ''}"
                            data-role-id="${role.id}"
                            title="${this._escapeAttr(role.description)}">
                        ${this._escapeHtml(role.name)}
                    </button>`;
        }).join('');

        return `
            <div class="admin-roles-row-info">
                <div class="admin-roles-row-name">${this._escapeHtml(user.fullname)}</div>
                <div class="admin-roles-row-details">${this._escapeHtml(user.username)} | ${this._escapeHtml(user.job || '')}</div>
            </div>
            <div class="admin-roles-row-chips">${chips}</div>
            <button class="admin-remove-btn" title="Убрать из списка">&times;</button>
        `;
    }

    /**
     * Переключает роль пользователя (назначение/снятие)
     * @param {string} username - Имя пользователя
     * @param {HTMLElement} chip - DOM-элемент чипса роли
     * @private
     */
    static async _toggleRole(username, chip) {
        const roleId = parseInt(chip.dataset.roleId);
        const isActive = chip.classList.contains('active');

        // Оптимистичное обновление UI
        chip.classList.toggle('active');
        chip.disabled = true;

        try {
            if (isActive) {
                await APIClient.removeRole(username, roleId);
            } else {
                await APIClient.assignRole(username, roleId);
            }

            // Обновляем локальное состояние
            const user = AdminPage._selectedUsers.get(username);
            if (user) {
                if (isActive) {
                    user.roles = user.roles.filter(r => r.id !== roleId);
                } else {
                    const role = this._allRoles.find(r => r.id === roleId);
                    if (role) user.roles.push(role);
                }
            }
        } catch (error) {
            // Откат при ошибке
            chip.classList.toggle('active');
            Notifications.error(`Ошибка: ${error.message}`);
        } finally {
            chip.disabled = false;
        }
    }

    /**
     * Экранирует HTML-символы
     * @param {string} str - Исходная строка
     * @returns {string} Экранированная строка
     * @private
     */
    static _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Экранирует символы для HTML-атрибутов
     * @param {string} str - Исходная строка
     * @returns {string} Экранированная строка
     * @private
     */
    static _escapeAttr(str) {
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}

// Экспортируем в глобальную область видимости
window.AdminRoles = AdminRoles;
