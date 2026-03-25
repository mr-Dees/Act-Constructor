/**
 * Диалог добавления внешнего пользователя
 *
 * Поиск по справочнику → выбор пользователя → выбор роли → добавление.
 * Наследует базовый функционал от DialogBase.
 */
class AdminAddUserDialog extends DialogBase {
    static _currentDialog = null;
    static _allRoles = [];
    static _debounceTimer = null;

    /**
     * Показывает диалог добавления пользователя
     * @param {Array} allRoles - Все доступные роли
     */
    static show(allRoles) {
        this._allRoles = allRoles;
        this._showDialog(this._createDialog());
    }

    /**
     * Создаёт DOM диалога
     * @private
     * @returns {HTMLElement}
     */
    static _createDialog() {
        const overlay = this._createOverlay();
        this._currentDialog = overlay;

        const roleOptions = this._allRoles
            .map(r => `<option value="${r.id}">${r.name}</option>`)
            .join('');

        overlay.innerHTML = `
            <div class="custom-dialog admin-add-user-dialog">
                <div class="dialog-header">
                    <h3 class="dialog-title">Добавить пользователя</h3>
                </div>
                <div class="dialog-body">
                    <div class="admin-add-search-section">
                        <input type="text" class="admin-add-search-input"
                               placeholder="Поиск по ФИО или логину (мин. 2 символа)"
                               autocomplete="off">
                    </div>
                    <div class="admin-add-results"></div>
                    <div class="admin-add-selected" style="display:none">
                        <div class="admin-add-selected-user"></div>
                        <div class="admin-add-role-section">
                            <label>Назначить роль:</label>
                            <select class="admin-add-role-select">
                                ${roleOptions}
                            </select>
                        </div>
                    </div>
                </div>
                <div class="dialog-footer">
                    <button class="dialog-btn dialog-btn-cancel">Отмена</button>
                    <button class="dialog-btn dialog-btn-confirm" disabled>Добавить</button>
                </div>
            </div>
        `;

        this._bindEvents(overlay);
        return overlay;
    }

    /**
     * Привязывает обработчики событий
     * @private
     * @param {HTMLElement} overlay
     */
    static _bindEvents(overlay) {
        const input = overlay.querySelector('.admin-add-search-input');
        const cancelBtn = overlay.querySelector('.dialog-btn-cancel');
        const confirmBtn = overlay.querySelector('.dialog-btn-confirm');

        input.addEventListener('input', () => this._onSearchInput(overlay));
        cancelBtn.addEventListener('click', () => this._close());
        confirmBtn.addEventListener('click', () => this._onConfirm(overlay));

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this._close();
        });

        setTimeout(() => input.focus(), 100);
    }

    /**
     * Обработчик ввода в поле поиска (debounce 300мс)
     * @private
     * @param {HTMLElement} overlay
     */
    static _onSearchInput(overlay) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(async () => {
            const input = overlay.querySelector('.admin-add-search-input');
            const query = input.value.trim();
            const resultsEl = overlay.querySelector('.admin-add-results');
            const selectedEl = overlay.querySelector('.admin-add-selected');

            selectedEl.style.display = 'none';
            overlay.querySelector('.dialog-btn-confirm').disabled = true;

            if (query.length < 2) {
                resultsEl.innerHTML = '';
                return;
            }

            try {
                resultsEl.innerHTML = '<div class="admin-add-loading">Поиск...</div>';
                const users = await APIClient.searchUsers(query);

                if (users.length === 0) {
                    resultsEl.innerHTML = '<div class="admin-add-empty">Пользователи не найдены</div>';
                    return;
                }

                resultsEl.innerHTML = users.map(u => `
                    <div class="admin-add-result-item" data-username="${u.username}">
                        <div class="admin-add-result-name">${this._escapeHtml(u.fullname || u.username)}</div>
                        <div class="admin-add-result-details">
                            ${this._escapeHtml(u.job || '')}
                            ${u.email ? ' · ' + this._escapeHtml(u.email) : ''}
                        </div>
                    </div>
                `).join('');

                resultsEl.querySelectorAll('.admin-add-result-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const user = users.find(u => u.username === item.dataset.username);
                        if (user) this._selectUser(overlay, user);
                    });
                });
            } catch (error) {
                resultsEl.innerHTML = '<div class="admin-add-empty">Ошибка поиска</div>';
                console.error('AdminAddUserDialog: ошибка поиска:', error);
            }
        }, 300);
    }

    /**
     * Выбор пользователя из результатов
     * @private
     */
    static _selectUser(overlay, user) {
        const resultsEl = overlay.querySelector('.admin-add-results');
        const selectedEl = overlay.querySelector('.admin-add-selected');
        const selectedUserEl = overlay.querySelector('.admin-add-selected-user');
        const confirmBtn = overlay.querySelector('.dialog-btn-confirm');

        resultsEl.innerHTML = '';
        selectedEl.style.display = 'block';
        selectedUserEl.innerHTML = `
            <strong>${this._escapeHtml(user.fullname || user.username)}</strong>
            <span class="admin-add-selected-details">${this._escapeHtml(user.job || '')} · ${this._escapeHtml(user.username)}</span>
        `;
        selectedEl.dataset.username = user.username;
        selectedEl.dataset.fullname = user.fullname || '';
        selectedEl.dataset.job = user.job || '';
        selectedEl.dataset.email = user.email || '';
        confirmBtn.disabled = false;
    }

    /**
     * Подтверждение добавления
     * @private
     */
    static async _onConfirm(overlay) {
        const selectedEl = overlay.querySelector('.admin-add-selected');
        const username = selectedEl.dataset.username;
        const roleSelect = overlay.querySelector('.admin-add-role-select');
        const roleId = parseInt(roleSelect.value);
        const confirmBtn = overlay.querySelector('.dialog-btn-confirm');

        confirmBtn.disabled = true;

        try {
            await APIClient.assignRole(username, roleId);

            const role = this._allRoles.find(r => r.id === roleId);
            AdminRoles.addUser({
                username,
                fullname: selectedEl.dataset.fullname,
                job: selectedEl.dataset.job,
                tn: '',
                email: selectedEl.dataset.email,
                is_department: false,
                roles: role ? [role] : [],
            });
            AdminPage.updateUserRoles(username, role ? [role] : []);

            Notifications.success('Пользователь добавлен');
            this._close();
        } catch (error) {
            Notifications.error(`Ошибка: ${error.message}`);
            confirmBtn.disabled = false;
        }
    }

    /**
     * Закрывает диалог
     * @private
     */
    static _close() {
        clearTimeout(this._debounceTimer);
        if (this._currentDialog) {
            this._hideDialog(this._currentDialog);
            this._currentDialog = null;
        }
    }

    /** @private */
    static _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

window.AdminAddUserDialog = AdminAddUserDialog;
