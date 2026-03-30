/**
 * Менеджер настроек landing page
 *
 * Управляет выпадающим меню с тумблерами AI-ассистентов.
 * Состояние сохраняется в localStorage.
 * Базы знаний читаются из DOM (data-атрибуты, сгенерированные бэкендом).
 */
class LandingSettingsManager {
    static _storageKey = 'assistant_knowledge_bases';

    /** @type {Object<string, {key: string, label: string}>} Загружается из DOM */
    static _assistants = {};

    /** @type {Object<string, boolean>} */
    static _state = {};

    /**
     * Инициализация: загрузка баз знаний из DOM, состояния, привязка обработчиков
     */
    static init() {
        this._loadAssistantsFromDOM();
        this._loadState();
        this._applyState();

        this._setupToggleButton();
        this._setupCloseButton();
        this._setupOutsideClick();
        this._setupEscapeHandler();
        this._setupAssistantToggles();

        console.log('LandingSettingsManager: инициализация завершена');
    }

    /**
     * Загружает маппинг баз знаний из data-атрибутов DOM-элементов
     * @private
     */
    static _loadAssistantsFromDOM() {
        this._assistants = {};
        this._state = {};

        const options = document.querySelectorAll('.settings-option[data-kb-key]');
        for (const opt of options) {
            const key = opt.dataset.kbKey;
            const label = opt.dataset.kbLabel;
            if (key && label) {
                this._assistants[key] = { key, label };
                this._state[key] = false;
            }
        }
    }

    /**
     * Показывает меню настроек
     */
    static show() {
        const menu = document.getElementById('landingSettingsMenu');
        const btn = document.getElementById('landingSettingsBtn');
        if (menu) menu.classList.remove('hidden');
        if (btn) btn.classList.add('active');
    }

    /**
     * Скрывает меню настроек
     */
    static hide() {
        const menu = document.getElementById('landingSettingsMenu');
        const btn = document.getElementById('landingSettingsBtn');
        if (menu) menu.classList.add('hidden');
        if (btn) btn.classList.remove('active');
    }

    /**
     * Переключает видимость меню
     */
    static toggle() {
        const menu = document.getElementById('landingSettingsMenu');
        if (!menu) return;

        if (menu.classList.contains('hidden')) {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Возвращает список label включённых ассистентов
     * @returns {string[]}
     */
    static getEnabledAssistants() {
        const enabled = [];
        for (const [key, info] of Object.entries(this._assistants)) {
            if (this._state[key]) {
                enabled.push(info.label);
            }
        }
        return enabled;
    }

    /**
     * Проверка конкретного ассистента по ключу
     * @param {string} key
     * @returns {boolean}
     */
    static isAssistantEnabled(key) {
        return !!this._state[key];
    }

    /**
     * Обработчик кнопки-шестерёнки в topbar
     * @private
     */
    static _setupToggleButton() {
        const btn = document.getElementById('landingSettingsBtn');
        if (!btn) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
    }

    /**
     * Обработчик крестика в шапке меню
     * @private
     */
    static _setupCloseButton() {
        const closeBtn = document.getElementById('closeLandingSettingsBtn');
        if (!closeBtn) return;

        closeBtn.addEventListener('click', () => {
            this.hide();
        });
    }

    /**
     * Клик вне меню → закрытие
     * @private
     */
    static _setupOutsideClick() {
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('landingSettingsMenu');
            const btn = document.getElementById('landingSettingsBtn');
            if (!menu || menu.classList.contains('hidden')) return;

            if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
                this.hide();
            }
        });
    }

    /**
     * Escape → закрытие
     * @private
     */
    static _setupEscapeHandler() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const menu = document.getElementById('landingSettingsMenu');
                if (menu && !menu.classList.contains('hidden')) {
                    this.hide();
                }
            }
        });
    }

    /**
     * Обработчики change на каждом тумблере (используют data-kb-key)
     * @private
     */
    static _setupAssistantToggles() {
        const checkboxes = document.querySelectorAll('.settings-option[data-kb-key] input[data-kb-key]');
        for (const checkbox of checkboxes) {
            const key = checkbox.dataset.kbKey;
            if (!key) continue;

            checkbox.addEventListener('change', () => {
                this._state[key] = checkbox.checked;
                this._saveState();
            });
        }
    }

    /**
     * Синхронизирует чекбоксы с текущим _state
     * @private
     */
    static _applyState() {
        const checkboxes = document.querySelectorAll('.settings-option[data-kb-key] input[data-kb-key]');
        for (const checkbox of checkboxes) {
            const key = checkbox.dataset.kbKey;
            if (key) {
                checkbox.checked = !!this._state[key];
            }
        }
    }

    /**
     * Сохраняет состояние в localStorage
     * @private
     */
    static _saveState() {
        try {
            localStorage.setItem(this._storageKey, JSON.stringify(this._state));
        } catch (e) {
            console.warn('LandingSettingsManager: не удалось сохранить состояние', e);
        }
    }

    /**
     * Загружает состояние из localStorage
     * @private
     */
    static _loadState() {
        try {
            const data = localStorage.getItem(this._storageKey);
            if (!data) return;

            const saved = JSON.parse(data);
            if (saved && typeof saved === 'object') {
                for (const key of Object.keys(this._state)) {
                    if (typeof saved[key] === 'boolean') {
                        this._state[key] = saved[key];
                    }
                }
            }
        } catch (e) {
            console.warn('LandingSettingsManager: не удалось загрузить состояние', e);
        }
    }
}

// Экспортируем в глобальную область видимости
window.LandingSettingsManager = LandingSettingsManager;
