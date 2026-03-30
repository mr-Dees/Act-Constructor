/**
 * Фильтр пользователей по тексту
 *
 * Фильтрует видимые строки таблицы ролей по ФИО, логину и email.
 */
class AdminSearch {
    static _input = null;
    static _debounceTimer = null;

    /**
     * Инициализирует компонент поиска-фильтра
     */
    static init() {
        this._input = document.getElementById('adminSearchInput');
        if (!this._input) return;

        this._input.addEventListener('input', () => this._onInput());
    }

    /**
     * Обработчик ввода — дебаунс 250мс
     * @private
     */
    static _onInput() {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            const query = this._input.value.trim();
            AdminRoles.filterByText(query);
        }, 250);
    }
}

// Экспортируем в глобальную область видимости
window.AdminSearch = AdminSearch;
