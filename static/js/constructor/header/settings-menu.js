/**
 * Менеджер меню настроек приложения
 *
 * Управляет отображением и поведением меню настроек.
 * Обрабатывает переключение темы, настройки автосохранения,
 * параметры загрузки файлов и сохраняет все изменения в localStorage.
 */
import { StorageManager } from '../storage-manager.js';
import { EscapeStack } from '../../shared/escape-stack.js';

export class SettingsMenuManager {
    /** @private Состояние настроек приложения */
    static _state = {
        theme: 'light',
        downloadPrompt: true,
        autoSave: true,
        autoSavePeriod: 3
    };

    /** Общий ключ localStorage для баз знаний (синхронизация с порталом) */
    static _kbStorageKey = 'assistant_knowledge_bases';

    /** Ключ localStorage для режима ОАРБ */
    static _oarbModeKey = 'assistant_oarb_mode';

    /** Допустимые значения режима ОАРБ */
    static _validOarbModes = ['off', 'adaptive', 'always'];

    /** @type {string[]} Ключи баз знаний (загружаются из DOM) */
    static _kbKeys = [];

    /** @type {Object<string, boolean>} Состояние баз знаний */
    static _kbState = {};

    /**
     * Инициализирует меню настроек и подключает обработчики событий
     */
    static setup() {
        const btn = document.getElementById('settingsMenuBtn');
        const menu = document.getElementById('settingsMenu');
        const closeBtn = document.getElementById('closeSettingsMenuBtn');
        const themeToggle = document.getElementById('themeToggle');
        const themeLabel = document.getElementById('themeToggleLabel');
        const downloadPromptToggle = document.getElementById('downloadPromptToggle');
        const autoSaveToggle = document.getElementById('autoSaveToggle');
        const autoSavePeriodContainer = document.getElementById('autoSavePeriodContainer');
        const autoSavePeriodInput = document.getElementById('autoSavePeriodInput');

        // Показ/скрытие меню при клике на кнопку
        btn?.addEventListener('click', e => {
            e.stopPropagation();
            this.toggle();
        });

        // Закрытие меню кнопкой крестика
        closeBtn?.addEventListener('click', () => {
            this.hide();
        });

        // Скрытие меню при клике вне его области
        document.addEventListener('click', e => {
            if (!menu?.contains(e.target) && !btn?.contains(e.target)) {
                this.hide();
            }
        });

        // Предотвращаем закрытие при клике внутри меню
        menu?.addEventListener('click', e => e.stopPropagation());

        // Закрытие по Escape — через EscapeStack (push в show, unsub в hide).

        // Обработчик переключения темы
        themeToggle?.addEventListener('change', () => {
            const isDark = themeToggle.checked;
            themeLabel.textContent = isDark ? 'Тёмная' : 'Светлая';
            document.documentElement.classList.toggle('theme-dark', isDark);
            this._state.theme = isDark ? 'dark' : 'light';
            this._saveSettings();
        });

        // Обработчик настройки предложения загрузки файлов
        downloadPromptToggle?.addEventListener('change', () => {
            this._state.downloadPrompt = downloadPromptToggle.checked;
            this._saveSettings();
        });

        // Обработчик включения/выключения автосохранения
        autoSaveToggle?.addEventListener('change', () => {
            const enabled = autoSaveToggle.checked;
            this._state.autoSave = enabled;
            autoSavePeriodContainer.style.display = enabled ? '' : 'none';
            this._saveSettings();
            this._updateAutoSave();
        });

        // Обработчик изменения периодичности автосохранения
        autoSavePeriodInput?.addEventListener('input', () => {
            let val = parseInt(autoSavePeriodInput.value, 10);
            if (isNaN(val) || val < 1) val = 1;
            if (val > 60) val = 60;
            autoSavePeriodInput.value = val;
            this._state.autoSavePeriod = val;
            this._saveSettings();
            this._updateAutoSave();
        });

        // Загрузка и применение сохраненных настроек
        this._loadSettings();
        themeToggle.checked = this._state.theme === 'dark';
        themeLabel.textContent = this._state.theme === 'dark' ? 'Тёмная' : 'Светлая';
        downloadPromptToggle.checked = this._state.downloadPrompt;
        autoSaveToggle.checked = this._state.autoSave;
        autoSavePeriodInput.value = this._state.autoSavePeriod;
        autoSavePeriodContainer.style.display = this._state.autoSave ? '' : 'none';

        // Базы знаний AI-ассистента (загружаем ключи из DOM, общий localStorage с порталом)
        this._loadKbKeysFromDOM();
        this._loadKbState();
        this._applyKbState();
        this._setupKbToggles();
        this._applyOarbMode();
        this._setupOarbModeSelect();
    }

    /**
     * Показывает меню настроек
     */
    static show() {
        const menu = document.getElementById('settingsMenu');
        const btn = document.getElementById('settingsMenuBtn');

        if (menu) {
            menu.classList.remove('hidden');
        }
        if (btn) {
            btn.classList.add('active');
        }
        if (!this._escapeUnsub) {
            this._escapeUnsub = EscapeStack.push(() => this.hide());
        }
    }

    /**
     * Скрывает меню настроек
     */
    static hide() {
        const menu = document.getElementById('settingsMenu');
        const btn = document.getElementById('settingsMenuBtn');

        if (menu) {
            menu.classList.add('hidden');
        }
        if (btn) {
            btn.classList.remove('active');
        }
        if (this._escapeUnsub) {
            this._escapeUnsub();
            this._escapeUnsub = null;
        }
    }

    /**
     * Переключает видимость меню настроек
     */
    static toggle() {
        const menu = document.getElementById('settingsMenu');
        if (menu && menu.classList.contains('hidden')) {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Сохраняет текущие настройки в localStorage
     * @private
     */
    static _saveSettings() {
        localStorage.setItem('app_settings', JSON.stringify(this._state));
    }

    /**
     * Загружает сохраненные настройки из localStorage
     * @private
     */
    static _loadSettings() {
        const saved = localStorage.getItem('app_settings');
        if (saved) {
            try {
                this._state = {...this._state, ...JSON.parse(saved)};
            } catch (e) {
                console.error('Ошибка загрузки настроек:', e);
            }
        }
    }

    /**
     * Обновляет параметры автосохранения в StorageManager
     * @private
     */
    static _updateAutoSave() {
        if (typeof StorageManager !== 'undefined') {
            const periodMs = this._state.autoSavePeriod * 1000;
            console.log('Обновлена периодичность автосохранения:', periodMs, 'мс');
            // StorageManager.updatePeriod(periodMs);
        }
    }

    /**
     * Загружает ключи баз знаний из data-атрибутов DOM-элементов.
     * Пропускает ОАРБ (управляется отдельным селектом) и задизейбленные опции.
     * @private
     */
    static _loadKbKeysFromDOM() {
        this._kbKeys = [];
        this._kbState = {};

        const options = document.querySelectorAll('.settings-option[data-kb-key]');
        for (const opt of options) {
            const key = opt.dataset.kbKey;
            // ОАРБ — режимный контрол, не чекбокс; задизейбленные — read-only
            if (key && key !== 'knowledge_base_oarb' && !opt.classList.contains('settings-option--disabled')) {
                this._kbKeys.push(key);
                this._kbState[key] = false;
            }
        }
    }

    /**
     * Читает режим ОАРБ из localStorage
     * @returns {'off'|'adaptive'|'always'}
     * @private
     */
    static _getOarbMode() {
        const val = localStorage.getItem(this._oarbModeKey);
        return this._validOarbModes.includes(val) ? val : 'off';
    }

    /**
     * Синхронизирует селект режима ОАРБ с localStorage
     * @private
     */
    static _applyOarbMode() {
        const select = document.querySelector('[data-oarb-mode]');
        if (select) {
            select.value = this._getOarbMode();
        }
    }

    /**
     * Обработчик изменения режима ОАРБ
     * @private
     */
    static _setupOarbModeSelect() {
        const select = document.querySelector('[data-oarb-mode]');
        if (!select) return;

        select.addEventListener('change', () => {
            const val = this._validOarbModes.includes(select.value) ? select.value : 'off';
            try {
                localStorage.setItem(this._oarbModeKey, val);
            } catch (e) {
                console.warn('SettingsMenuManager: не удалось сохранить режим ОАРБ', e);
            }
        });
    }

    /**
     * Загружает состояние баз знаний из общего localStorage
     * @private
     */
    static _loadKbState() {
        try {
            const data = localStorage.getItem(this._kbStorageKey);
            if (!data) return;

            const saved = JSON.parse(data);
            if (saved && typeof saved === 'object') {
                for (const key of this._kbKeys) {
                    if (typeof saved[key] === 'boolean') {
                        this._kbState[key] = saved[key];
                    }
                }
            }
        } catch (e) {
            console.warn('SettingsMenuManager: не удалось загрузить настройки баз знаний', e);
        }
    }

    /**
     * Сохраняет состояние баз знаний в общий localStorage
     * @private
     */
    static _saveKbState() {
        try {
            localStorage.setItem(this._kbStorageKey, JSON.stringify(this._kbState));
        } catch (e) {
            console.warn('SettingsMenuManager: не удалось сохранить настройки баз знаний', e);
        }
    }

    /**
     * Синхронизирует чекбоксы баз знаний с текущим состоянием
     * @private
     */
    static _applyKbState() {
        const checkboxes = document.querySelectorAll('.settings-option[data-kb-key] input[data-kb-key]');
        for (const checkbox of checkboxes) {
            const key = checkbox.dataset.kbKey;
            if (key) {
                checkbox.checked = !!this._kbState[key];
            }
        }
    }

    /**
     * Обработчики change на тумблерах баз знаний (используют data-kb-key)
     * @private
     */
    static _setupKbToggles() {
        const checkboxes = document.querySelectorAll('.settings-option[data-kb-key] input[data-kb-key]');
        for (const checkbox of checkboxes) {
            const key = checkbox.dataset.kbKey;
            if (!key) continue;

            checkbox.addEventListener('change', () => {
                this._kbState[key] = checkbox.checked;
                this._saveKbState();
            });
        }
    }

    /**
     * Возвращает копию текущих настроек
     *
     * @returns {Object} Объект с текущими настройками
     */
    static getSettings() {
        return {...this._state};
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => SettingsMenuManager.setup());

// Глобальный доступ
window.SettingsMenuManager = SettingsMenuManager;
