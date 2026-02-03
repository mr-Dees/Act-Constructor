/**
 * Менеджер настроек landing page
 *
 * Управляет выпадающим меню с тумблерами AI-ассистентов.
 * Состояние сохраняется в localStorage.
 */
class LandingSettingsManager {
    static _storageKey = 'landing_assistants';

    /** Маппинг id чекбокса → { key, label } */
    static _assistants = {
        assistantKnowledgeOarb:    { key: 'knowledge_base_oarb',    label: 'База Знаний ОАРБ' },
        assistantKnowledgeSources: { key: 'knowledge_base_sources', label: 'База знаний источников информации' },
        assistantKnowledgeTools:   { key: 'knowledge_base_tools',   label: 'База знаний по инструментам' }
    };

    /** @type {{ knowledge_base_oarb: boolean, knowledge_base_sources: boolean, knowledge_base_tools: boolean }} */
    static _state = {
        knowledge_base_oarb: false,
        knowledge_base_sources: false,
        knowledge_base_tools: false
    };

    /**
     * Инициализация: загрузка состояния, привязка обработчиков, применение к чекбоксам
     */
    static init() {
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
        for (const [id, info] of Object.entries(this._assistants)) {
            if (this._state[info.key]) {
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
     * Обработчики change на каждом тумблере
     * @private
     */
    static _setupAssistantToggles() {
        for (const [id, info] of Object.entries(this._assistants)) {
            const checkbox = document.getElementById(id);
            if (!checkbox) continue;

            checkbox.addEventListener('change', () => {
                this._state[info.key] = checkbox.checked;
                this._saveState();
            });
        }
    }

    /**
     * Синхронизирует чекбоксы с текущим _state
     * @private
     */
    static _applyState() {
        for (const [id, info] of Object.entries(this._assistants)) {
            const checkbox = document.getElementById(id);
            if (checkbox) {
                checkbox.checked = !!this._state[info.key];
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
