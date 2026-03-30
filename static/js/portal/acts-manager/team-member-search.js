/**
 * Autocomplete-поиск пользователей для строки участника команды аудита.
 *
 * Привязывается к полю ФИО в строке .team-member-row.
 * При вводе текста (debounce 300мс, мин. 2 символа) запрашивает
 * APIClient.searchTeamUsers(), отображает выпадающий список.
 * При выборе заполняет ФИО (title case), должность и логин,
 * переводит поля в readonly.
 */
class TeamMemberSearch {
    /**
     * @param {HTMLElement} rowElement - DOM-элемент .team-member-row
     */
    constructor(rowElement) {
        this._row = rowElement;
        this._nameInput = rowElement.querySelector('input[name="full_name"]');
        this._positionInput = rowElement.querySelector('input[name="position"]');
        this._usernameInput = rowElement.querySelector('input[name="username"]');
        this._clearBtn = rowElement.querySelector('.clear-member-btn');
        this._wrapper = rowElement.querySelector('.team-member-name-wrapper');
        this._debounceTimer = null;
        this._dropdown = null;
        this._isSelected = false;

        if (!this._nameInput || !this._wrapper) return;

        this._createDropdown();
        this._bindEvents();
    }

    /**
     * Создает DOM-элемент выпадающего списка
     * @private
     */
    _createDropdown() {
        this._dropdown = document.createElement('div');
        this._dropdown.className = 'team-member-search-dropdown';
        this._wrapper.appendChild(this._dropdown);
    }

    /**
     * Привязывает обработчики событий
     * @private
     */
    _bindEvents() {
        this._nameInput.addEventListener('input', () => this._onInput());
        this._nameInput.addEventListener('focus', () => {
            if (this._dropdown.innerHTML && !this._isSelected) {
                this._showDropdown();
            }
        });

        if (this._clearBtn) {
            this._clearBtn.addEventListener('click', () => this._onClear());
        }

        this._onDocumentClick = (e) => {
            if (!this._wrapper.contains(e.target)) {
                this._hideDropdown();
            }
        };
        document.addEventListener('click', this._onDocumentClick);

        this._nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this._hideDropdown();
            }
        });
    }

    /**
     * Обработчик ввода — debounce 300мс
     * @private
     */
    _onInput() {
        if (this._isSelected) return;

        clearTimeout(this._debounceTimer);
        const query = this._nameInput.value.trim();

        if (query.length < 2) {
            this._hideDropdown();
            return;
        }

        this._debounceTimer = setTimeout(async () => {
            this._showLoading();
            try {
                const users = await APIClient.searchTeamUsers(query);
                const filtered = this._excludeAlreadyAdded(users);
                this._renderResults(filtered);
            } catch (error) {
                this._renderError();
                console.error('TeamMemberSearch: ошибка поиска:', error);
            }
        }, 300);
    }

    /**
     * Исключает пользователей, уже добавленных в другие строки
     * @private
     * @param {Array} users
     * @returns {Array}
     */
    _excludeAlreadyAdded(users) {
        const container = document.getElementById('auditTeamContainer');
        if (!container) return users;

        const existingUsernames = new Set();
        container.querySelectorAll('.team-member-row').forEach(row => {
            if (row === this._row) return;
            const usernameInput = row.querySelector('input[name="username"]');
            if (usernameInput && usernameInput.value.trim()) {
                existingUsernames.add(usernameInput.value.trim());
            }
        });

        return users.filter(u => !existingUsernames.has(u.username));
    }

    /**
     * Отображает результаты поиска
     * @private
     * @param {Array} users
     */
    _renderResults(users) {
        if (users.length === 0) {
            this._dropdown.innerHTML = '<div class="team-member-search-empty">Не найдено</div>';
            this._showDropdown();
            return;
        }

        this._dropdown.innerHTML = users.map(u => {
            const name = this._escapeHtml(u.fullname || u.username);
            const details = [u.job, u.username].filter(Boolean).map(s => this._escapeHtml(s)).join(' \u00b7 ');
            return `
                <div class="team-member-search-item"
                     data-username="${this._escapeHtml(u.username || '')}"
                     data-fullname="${this._escapeHtml(u.fullname || '')}"
                     data-job="${this._escapeHtml(u.job || '')}">
                    <div class="team-member-search-item-name">${name}</div>
                    <div class="team-member-search-item-details">${details}</div>
                </div>
            `;
        }).join('');

        this._dropdown.querySelectorAll('.team-member-search-item').forEach(item => {
            item.addEventListener('click', () => this._onSelect(item));
        });

        this._showDropdown();
    }

    /**
     * Обработчик выбора пользователя из списка
     * @private
     * @param {HTMLElement} item
     */
    _onSelect(item) {
        const fullname = item.dataset.fullname || '';
        const job = item.dataset.job || '';
        const username = item.dataset.username || '';

        this._nameInput.value = this._toTitleCase(fullname);
        this._positionInput.value = job;
        this._usernameInput.value = username;

        this._nameInput.readOnly = true;
        this._positionInput.readOnly = true;
        this._usernameInput.readOnly = true;

        this._isSelected = true;
        this._hideDropdown();

        if (this._clearBtn) {
            this._clearBtn.classList.add('visible');
        }
    }

    /**
     * Сброс выбранного пользователя
     * @private
     */
    _onClear() {
        this._nameInput.value = '';
        this._positionInput.value = '';
        this._usernameInput.value = '';

        this._nameInput.readOnly = false;
        this._positionInput.readOnly = false;
        this._usernameInput.readOnly = false;

        this._isSelected = false;

        if (this._clearBtn) {
            this._clearBtn.classList.remove('visible');
        }

        this._nameInput.focus();
    }

    /**
     * Устанавливает состояние "уже выбран" (для режима редактирования)
     */
    setSelected() {
        this._isSelected = true;
        this._nameInput.readOnly = true;
        this._positionInput.readOnly = true;
        this._usernameInput.readOnly = true;
        if (this._clearBtn) {
            this._clearBtn.classList.add('visible');
        }
    }

    /**
     * Удаляет глобальные обработчики событий при удалении строки
     */
    destroy() {
        if (this._onDocumentClick) {
            document.removeEventListener('click', this._onDocumentClick);
        }
        clearTimeout(this._debounceTimer);
    }

    /**
     * Нормализует ФИО: "ИВАНОВ ИВАН ПЕТРОВИЧ" → "Иванов Иван Петрович"
     * @private
     * @param {string} str
     * @returns {string}
     */
    _toTitleCase(str) {
        return str
            .toLowerCase()
            .replace(/(?:^|\s|-)\S/g, char => char.toUpperCase());
    }

    /** @private */
    _showLoading() {
        this._dropdown.innerHTML = '<div class="team-member-search-loading">Поиск...</div>';
        this._showDropdown();
    }

    /** @private */
    _renderError() {
        this._dropdown.innerHTML = '<div class="team-member-search-empty">Ошибка поиска</div>';
        this._showDropdown();
    }

    /** @private */
    _showDropdown() {
        this._dropdown.classList.add('visible');
    }

    /** @private */
    _hideDropdown() {
        this._dropdown.classList.remove('visible');
    }

    /**
     * @private
     * @param {string} str
     * @returns {string}
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

window.TeamMemberSearch = TeamMemberSearch;
