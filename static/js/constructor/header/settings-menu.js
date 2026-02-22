/**
 * Менеджер меню настроек приложения
 *
 * Управляет отображением и поведением меню настроек.
 * Обрабатывает переключение темы, настройки автосохранения,
 * параметры загрузки файлов и сохраняет все изменения в localStorage.
 */
class SettingsMenuManager {
    /** @private Состояние настроек */
    static _state = {
        theme: 'light',
        downloadPrompt: true,
        autoSave: true,
        autoSavePeriod: 3
    };

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

        // Закрытие по Escape
        this._setupEscapeHandler();

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
     * Настраивает обработчик закрытия меню по клавише Escape
     * @private
     */
    static _setupEscapeHandler() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const menu = document.getElementById('settingsMenu');
                if (menu && !menu.classList.contains('hidden')) {
                    this.hide();
                }
            }
        });
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
