/**
 * Поиск пользователей в справочнике с dropdown
 *
 * Обеспечивает поиск по ФИО, табельному номеру и email
 * с отображением результатов в выпадающем списке.
 */
class AdminSearch {
    static _directory = [];
    static _onSelect = null;
    static _input = null;
    static _dropdown = null;

    /**
     * Инициализирует компонент поиска
     * @param {Array} directory - Справочник пользователей
     * @param {Function} onSelect - Callback при выборе пользователя
     */
    static init(directory, onSelect) {
        this._directory = directory;
        this._onSelect = onSelect;
        this._input = document.getElementById('adminSearchInput');
        this._dropdown = document.getElementById('adminSearchDropdown');

        if (!this._input || !this._dropdown) return;

        this._input.addEventListener('input', () => this._onInput());
        this._input.addEventListener('focus', () => {
            if (this._input.value.trim().length >= 2) this._onInput();
        });
        document.addEventListener('click', (e) => {
            if (!this._input.contains(e.target) && !this._dropdown.contains(e.target)) {
                this._hideDropdown();
            }
        });
    }

    /**
     * Обработчик ввода в поле поиска
     * @private
     */
    static _onInput() {
        const query = this._input.value.trim().toLowerCase();
        if (query.length < 2) {
            this._hideDropdown();
            return;
        }

        const results = this._directory.filter(u =>
            u.fullname.toLowerCase().includes(query) ||
            u.username.toLowerCase().includes(query) ||
            (u.email && u.email.toLowerCase().includes(query))
        ).slice(0, 50);

        this._renderDropdown(results);
    }

    /**
     * Отрисовывает выпадающий список результатов
     * @param {Array} results - Найденные пользователи
     * @private
     */
    static _renderDropdown(results) {
        if (results.length === 0) {
            this._dropdown.innerHTML = '<div class="admin-search-no-results">Ничего не найдено</div>';
        } else {
            this._dropdown.innerHTML = results.map(u => `
                <div class="admin-search-item" data-username="${this._escapeAttr(u.username)}">
                    <div class="admin-search-item-name">${this._escapeHtml(u.fullname)}</div>
                    <div class="admin-search-item-info">${this._escapeHtml(u.username)} | ${this._escapeHtml(u.job || '')}</div>
                </div>
            `).join('');

            this._dropdown.querySelectorAll('.admin-search-item').forEach(el => {
                el.addEventListener('click', () => {
                    const username = el.dataset.username;
                    const user = this._directory.find(u => u.username === username);
                    if (user && this._onSelect) {
                        this._onSelect(user);
                    }
                    this._hideDropdown();
                    this._input.value = '';
                });
            });
        }
        this._dropdown.classList.remove('hidden');
    }

    /**
     * Скрывает выпадающий список
     * @private
     */
    static _hideDropdown() {
        this._dropdown.classList.add('hidden');
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
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}

// Экспортируем в глобальную область видимости
window.AdminSearch = AdminSearch;
