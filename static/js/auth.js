/**
 * Менеджер авторизации
 *
 * Проверяет авторизацию пользователя при открытии страницы.
 * Использует localStorage для кеширования username на 24 часа.
 * Обрабатывает ошибки Kerberos токена.
 */
class AuthManager {
    /**
     * Ключ для хранения username в localStorage
     * @private
     */
    static _storageKey = 'auth_username';

    /**
     * Ключ для хранения timestamp последней проверки
     * @private
     */
    static _timestampKey = 'auth_timestamp';

    /**
     * Текущий пользователь (кеш в памяти)
     * @private
     */
    static _currentUser = null;

    /**
     * Флаг авторизации
     * @private
     */
    static _isAuthenticated = false;

    /**
     * Время жизни сессии в localStorage (24 часа)
     * @private
     */
    static _sessionExpiry = 24 * 60 * 60 * 1000;

    /**
     * Инициализирует AuthManager
     * Проверяет наличие сохраненного username в localStorage
     */
    static init() {
        // Пытаемся загрузить из localStorage
        const savedUser = this._loadFromStorage();
        if (savedUser && this._isSessionActive()) {
            this._currentUser = savedUser;
            this._isAuthenticated = true;
            console.log('Username загружен из localStorage:', savedUser);
        } else {
            // Сессия истекла или username отсутствует
            this._clearStorage();
        }
    }

    /**
     * Проверяет, активна ли сессия (не истекла ли)
     * @private
     * @returns {boolean}
     */
    static _isSessionActive() {
        try {
            const timestamp = localStorage.getItem(this._timestampKey);
            if (!timestamp) return false;

            const now = Date.now();
            const savedTime = parseInt(timestamp, 10);

            return (now - savedTime) < this._sessionExpiry;
        } catch (error) {
            console.error('Ошибка проверки timestamp:', error);
            return false;
        }
    }

    /**
     * Загружает username из localStorage
     * @private
     * @returns {string|null}
     */
    static _loadFromStorage() {
        try {
            return localStorage.getItem(this._storageKey);
        } catch (error) {
            console.error('Ошибка чтения username из localStorage:', error);
            return null;
        }
    }

    /**
     * Сохраняет username и timestamp в localStorage
     * @private
     * @param {string} username
     */
    static _saveToStorage(username) {
        try {
            localStorage.setItem(this._storageKey, username);
            localStorage.setItem(this._timestampKey, Date.now().toString());
        } catch (error) {
            console.error('Ошибка сохранения username в localStorage:', error);
        }
    }

    /**
     * Очищает сохраненный username из localStorage
     * @private
     */
    static _clearStorage() {
        try {
            localStorage.removeItem(this._storageKey);
            localStorage.removeItem(this._timestampKey);
        } catch (error) {
            console.error('Ошибка очистки username из localStorage:', error);
        }
    }

    /**
     * Показывает ошибку Kerberos с инструкциями
     * @private
     * @param {Object} errorData - данные об ошибке от API
     */
    static _showKerberosError(errorData) {
        const message = errorData.message || 'Токен авторизации Kerberos истек';
        const instructions = errorData.instructions || [
            'Откройте терминал JupyterHub',
            'Выполните команду: kinit',
            'Введите ваш пароль',
            'Обновите страницу приложения'
        ];

        // Создаем красивое модальное окно с инструкциями
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white;
            padding: 2rem;
            border-radius: 8px;
            max-width: 500px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        const title = document.createElement('h2');
        title.textContent = '⚠️ Требуется обновление токена Kerberos';
        title.style.cssText = 'margin: 0 0 1rem 0; color: #d32f2f;';

        const description = document.createElement('p');
        description.textContent = message;
        description.style.cssText = 'margin: 0 0 1rem 0; line-height: 1.5;';

        const instructionsList = document.createElement('ol');
        instructionsList.style.cssText = 'margin: 1rem 0; padding-left: 1.5rem;';
        instructions.forEach(instruction => {
            const li = document.createElement('li');
            li.textContent = instruction;
            li.style.cssText = 'margin: 0.5rem 0;';
            instructionsList.appendChild(li);
        });

        const refreshButton = document.createElement('button');
        refreshButton.textContent = 'Обновить страницу';
        refreshButton.style.cssText = `
            background: #1976d2;
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 4px;
            cursor: pointer;
            font-size: 1rem;
            margin-top: 1rem;
        `;
        refreshButton.onclick = () => window.location.reload();

        modal.appendChild(title);
        modal.appendChild(description);
        modal.appendChild(instructionsList);
        modal.appendChild(refreshButton);
        overlay.appendChild(modal);

        document.body.innerHTML = '';
        document.body.appendChild(overlay);
    }

    /**
     * Проверяет авторизацию через API (берёт из переменной окружения)
     * Используется при открытии любой страницы
     * @returns {Promise<{authenticated: boolean, username: string|null}>}
     */
    static async checkAuth() {
        try {
            const response = await fetch(AppConfig.api.getUrl('/api/v1/auth/me'));

            // Проверяем на ошибку Kerberos токена
            if (response.status === 401) {
                const errorData = await response.json();

                if (errorData.error === 'kerberos_token_expired') {
                    console.error('Kerberos токен истек');
                    this._showKerberosError(errorData);
                    return {authenticated: false, username: null};
                }
            }

            if (!response.ok) {
                throw new Error('Ошибка проверки авторизации');
            }

            const data = await response.json();

            this._isAuthenticated = data.authenticated;
            this._currentUser = data.username;

            // Сохраняем в localStorage для последующих операций
            if (data.authenticated && data.username) {
                this._saveToStorage(data.username);
                console.log('Username сохранён в localStorage:', data.username);
            } else {
                this._clearStorage();
            }

            // Устанавливаем в глобальный объект для совместимости
            window.env = window.env || {};
            window.env.JUPYTERHUB_USER = data.username;

            return data;

        } catch (error) {
            console.error('Ошибка проверки авторизации:', error);
            this._isAuthenticated = false;
            this._currentUser = null;
            this._clearStorage();
            return {authenticated: false, username: null};
        }
    }

    /**
     * Требует авторизации для открытия страницы
     * Показывает сообщение об ошибке если не авторизован
     * @returns {Promise<boolean>}
     */
    static async requireAuth() {
        const authData = await this.checkAuth();

        if (!authData.authenticated) {
            this._showAuthError();
            return false;
        }

        console.log(`Авторизован как: ${authData.username}`);
        return true;
    }

    /**
     * Показывает ошибку авторизации
     * @private
     */
    static _showAuthError() {
        const tmpl = document.getElementById('authErrorTemplate');
        if (!tmpl) {
            console.error('authErrorTemplate не найден');
            return;
        }

        const fragment = tmpl.content.cloneNode(true);

        // Полностью очищаем body и вставляем только overlay из шаблона
        document.body.innerHTML = '';
        document.body.appendChild(fragment);
    }

    /**
     * Возвращает текущего пользователя
     * Сначала проверяет кеш в памяти, затем localStorage
     * @returns {string|null}
     */
    static getCurrentUser() {
        // Если есть в памяти — возвращаем
        if (this._currentUser) {
            return this._currentUser;
        }

        // Иначе пытаемся загрузить из localStorage
        if (this._isSessionActive()) {
            const savedUser = this._loadFromStorage();
            if (savedUser) {
                this._currentUser = savedUser;
                this._isAuthenticated = true;
                return savedUser;
            }
        }

        console.warn('Username не найден или сессия истекла');
        return null;
    }

    /**
     * Проверяет, авторизован ли пользователь (в памяти или localStorage)
     * @returns {boolean}
     */
    static isAuthenticated() {
        // Проверяем кеш в памяти
        if (this._isAuthenticated) {
            return true;
        }

        // Проверяем localStorage и активность сессии
        if (this._isSessionActive()) {
            const savedUser = this._loadFromStorage();
            if (savedUser) {
                this._currentUser = savedUser;
                this._isAuthenticated = true;
                return true;
            }
        }

        return false;
    }

    /**
     * Возвращает заголовки для API-запросов
     * @returns {Object}
     */
    static getAuthHeaders() {
        const username = this.getCurrentUser();
        return {
            'X-JupyterHub-User': username || ''
        };
    }

    /**
     * Очищает авторизацию (для logout)
     */
    static logout() {
        this._currentUser = null;
        this._isAuthenticated = false;
        this._clearStorage();

        if (window.env) {
            window.env.JUPYTERHUB_USER = null;
        }

        console.log('Пользователь вышел из системы');
    }

    /**
     * Проверяет актуальность авторизации
     * @returns {boolean}
     */
    static isSessionValid() {
        return this._isSessionActive() && this._loadFromStorage() !== null;
    }

    /**
     * Обновляет timestamp сессии (продлевает жизнь)
     */
    static refreshSession() {
        if (this._currentUser) {
            this._saveToStorage(this._currentUser);
            console.log('Сессия обновлена');
        }
    }
}

// Инициализируем при загрузке скрипта
AuthManager.init();

window.AuthManager = AuthManager;
