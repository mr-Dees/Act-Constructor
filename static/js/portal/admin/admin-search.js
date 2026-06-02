/**
 * Поиск пользователей в админ-панели
 *
 * Делегирует поиск на сервер: после паузы в наборе вызывает переданный
 * колбэк, который запрашивает совпадения по всему справочнику (а не только
 * по уже загруженной странице).
 */
export class AdminSearch {
    static _input = null;
    static _debounceTimer = null;
    static _onSearch = null;

    /**
     * Инициализирует компонент поиска
     * @param {(query: string) => void} onSearch - колбэк поиска по строке
     */
    static init(onSearch) {
        this._input = document.getElementById('adminSearchInput');
        if (!this._input) return;

        this._onSearch = onSearch;
        this._input.addEventListener('input', () => this._onInput());
    }

    /**
     * Обработчик ввода — дебаунс 1.5с перед запросом к серверу,
     * чтобы не дёргать БД на каждый символ.
     * @private
     */
    static _onInput() {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            const query = this._input.value.trim();
            if (this._onSearch) this._onSearch(query);
        }, 1500);
    }
}

// Экспортируем в глобальную область видимости
window.AdminSearch = AdminSearch;
