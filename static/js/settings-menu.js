// static/js/settings-menu.js

class SettingsMenuManager {
    static _state = {
        theme: 'light',
        downloadPrompt: true,
        autoSave: true,
        autoSavePeriod: 3
    };

    static setup() {
        const btn = document.getElementById('settingsMenuBtn');
        const menu = document.getElementById('settingsMenu');
        const themeToggle = document.getElementById('themeToggle');
        const themeLabel = document.getElementById('themeToggleLabel');
        const downloadPromptToggle = document.getElementById('downloadPromptToggle');
        const autoSaveToggle = document.getElementById('autoSaveToggle');
        const autoSavePeriodContainer = document.getElementById('autoSavePeriodContainer');
        const autoSavePeriodInput = document.getElementById('autoSavePeriodInput');

        // Показ/скрытие меню с управлением активным состоянием кнопки
        btn?.addEventListener('click', e => {
            e.stopPropagation();
            const isHidden = menu.classList.contains('hidden');

            if (isHidden) {
                menu.classList.remove('hidden');
                btn.classList.add('active');
            } else {
                menu.classList.add('hidden');
                btn.classList.remove('active');
            }
        });

        // Скрытие меню при клике вне
        document.addEventListener('click', e => {
            if (!menu.contains(e.target) && !btn.contains(e.target)) {
                menu.classList.add('hidden');
                btn.classList.remove('active');
            }
        });

        // Предотвращаем закрытие при клике внутри меню
        menu?.addEventListener('click', e => e.stopPropagation());

        // Тема
        themeToggle?.addEventListener('change', () => {
            const isDark = themeToggle.checked;
            themeLabel.textContent = isDark ? 'Тёмная' : 'Светлая';
            document.documentElement.classList.toggle('theme-dark', isDark);
            this._state.theme = isDark ? 'dark' : 'light';
            this._saveSettings();
        });

        // Загрузка файлов
        downloadPromptToggle?.addEventListener('change', () => {
            this._state.downloadPrompt = downloadPromptToggle.checked;
            this._saveSettings();
        });

        // Автосохранение
        autoSaveToggle?.addEventListener('change', () => {
            const enabled = autoSaveToggle.checked;
            this._state.autoSave = enabled;
            autoSavePeriodContainer.style.display = enabled ? '' : 'none';
            this._saveSettings();
            this._updateAutoSave();
        });

        // Периодичность автосохранения
        autoSavePeriodInput?.addEventListener('input', () => {
            let val = parseInt(autoSavePeriodInput.value, 10);
            if (isNaN(val) || val < 1) val = 1;
            if (val > 60) val = 60;
            autoSavePeriodInput.value = val;
            this._state.autoSavePeriod = val;
            this._saveSettings();
            this._updateAutoSave();
        });

        // Инициализация состояний
        this._loadSettings();
        themeToggle.checked = this._state.theme === 'dark';
        themeLabel.textContent = this._state.theme === 'dark' ? 'Тёмная' : 'Светлая';
        downloadPromptToggle.checked = this._state.downloadPrompt;
        autoSaveToggle.checked = this._state.autoSave;
        autoSavePeriodInput.value = this._state.autoSavePeriod;
        autoSavePeriodContainer.style.display = this._state.autoSave ? '' : 'none';
    }

    static _saveSettings() {
        localStorage.setItem('app_settings', JSON.stringify(this._state));
    }

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

    static _updateAutoSave() {
        // Здесь можно обновить StorageManager
        if (typeof StorageManager !== 'undefined') {
            const periodMs = this._state.autoSavePeriod * 1000;
            console.log('Обновлена периодичность автосохранения:', periodMs, 'мс');
            // StorageManager.updatePeriod(periodMs);
        }
    }

    static getSettings() {
        return {...this._state};
    }
}

document.addEventListener('DOMContentLoaded', () => SettingsMenuManager.setup());
window.SettingsMenuManager = SettingsMenuManager;
