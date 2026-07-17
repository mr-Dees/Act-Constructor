/**
 * Менеджер форматов экспорта
 *
 * Управляет чекбоксами форматов (TXT/MD/DOCX) в меню настроек:
 * восстанавливает выбор из localStorage и сохраняет при изменении.
 * Список выбранных форматов читает кнопка «сохранить и скачать» в шапке.
 * В базу данных акт сохраняется всегда — отдельной опции для этого нет.
 */
export class FormatMenuManager {
    static _storageKey = 'selected_formats';

    /**
     * Настройка секции форматов экспорта в меню настроек
     */
    static setup() {
        const menu = document.getElementById('exportFormatsMenu');

        if (!menu) {
            console.warn('FormatMenuManager: секция форматов экспорта не найдена');
            return;
        }

        this._restoreFormats(menu);
        this._setupCheckboxHandlers(menu);
    }

    /**
     * Настройка обработчиков изменения чекбоксов
     * @private
     * @param {HTMLElement} menu - Контейнер чекбоксов форматов
     */
    static _setupCheckboxHandlers(menu) {
        const checkboxes = menu.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => this._saveFormats());
        });
    }

    /**
     * Сохраняет выбранные форматы в localStorage
     * @private
     */
    static _saveFormats() {
        const formats = this.getSelectedFormats();
        localStorage.setItem(this._storageKey, JSON.stringify(formats));
    }

    /**
     * Восстанавливает выбранные форматы из localStorage
     * @private
     * @param {HTMLElement} menu - Контейнер чекбоксов форматов
     */
    static _restoreFormats(menu) {
        const saved = localStorage.getItem(this._storageKey);
        if (!saved) return;

        try {
            const formats = JSON.parse(saved);
            if (!Array.isArray(formats)) return;

            const checkboxes = menu.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = formats.includes(checkbox.value);
            });
        } catch (e) {
            console.error('Ошибка восстановления форматов:', e);
        }
    }

    /**
     * Получение списка выбранных форматов экспорта
     * @returns {string[]} Массив выбранных форматов (txt/md/docx)
     */
    static getSelectedFormats() {
        const checkboxes = document.querySelectorAll(
            '#exportFormatsMenu input[type="checkbox"]:checked'
        );
        return Array.from(checkboxes).map(cb => cb.value);
    }
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.FormatMenuManager = FormatMenuManager;
