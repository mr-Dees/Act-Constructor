/**
 * Менеджер меню выбора форматов экспорта
 *
 * Управляет выпадающим меню выбора форматов,
 * индикаторами выбранных форматов и их визуализацией.
 */
class FormatMenuManager {
    /**
     * Настройка меню форматов
     */
    static setup() {
        const dropdownBtn = document.getElementById('formatDropdownBtn');
        const formatMenu = document.getElementById('formatMenu');

        if (!dropdownBtn || !formatMenu) return;

        this._setupToggle(dropdownBtn, formatMenu);
        this._setupOutsideClick(dropdownBtn, formatMenu);
        this._setupCheckboxHandlers(formatMenu);

        this.updateIndicator();
    }

    /**
     * Настройка переключения видимости меню
     * @private
     * @param {HTMLElement} button - Кнопка открытия меню
     * @param {HTMLElement} menu - Элемент меню
     */
    static _setupToggle(button, menu) {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._positionMenu(button, menu);
            menu.classList.toggle('hidden');
            button.classList.toggle('active');
        });
    }

    /**
     * Умное позиционирование меню относительно кнопки
     * @private
     * @param {HTMLElement} button - Кнопка-триггер
     * @param {HTMLElement} menu - Элемент меню
     */
    static _positionMenu(button, menu) {
        if (!menu.classList.contains('hidden')) return;

        const buttonRect = button.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - buttonRect.bottom;
        const spaceAbove = buttonRect.top;

        // Показываем меню сверху, если снизу недостаточно места
        if (spaceBelow < 200 && spaceAbove > 200) {
            menu.style.bottom = 'calc(100% + 8px)';
            menu.style.top = 'auto';
        } else {
            menu.style.top = 'calc(100% + 8px)';
            menu.style.bottom = 'auto';
        }
    }

    /**
     * Настройка закрытия меню при клике вне его
     * @private
     * @param {HTMLElement} button - Кнопка меню
     * @param {HTMLElement} menu - Элемент меню
     */
    static _setupOutsideClick(button, menu) {
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && e.target !== button) {
                menu.classList.add('hidden');
                button.classList.remove('active');
            }
        });

        // Предотвращаем закрытие при клике внутри меню
        menu.addEventListener('click', (e) => e.stopPropagation());
    }

    /**
     * Настройка обработчиков изменения чекбоксов
     * @private
     * @param {HTMLElement} menu - Элемент меню
     */
    static _setupCheckboxHandlers(menu) {
        const checkboxes = menu.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => this.updateIndicator());
        });
    }

    /**
     * Получение списка выбранных форматов
     * @returns {string[]} Массив выбранных форматов
     */
    static getSelectedFormats() {
        const checkboxes = document.querySelectorAll(
            '#formatMenu input[type="checkbox"]:checked'
        );
        return Array.from(checkboxes).map(cb => cb.value);
    }

    /**
     * Обновление визуального индикатора выбранных форматов
     */
    static updateIndicator() {
        const generateBtn = document.getElementById('generateBtn');
        const dropdownBtn = document.getElementById('formatDropdownBtn');
        const selectedFormats = this.getSelectedFormats();

        if (selectedFormats.length > 0) {
            const formatsText = selectedFormats.map(f => f.toUpperCase()).join(' + ');

            this._setIndicator(dropdownBtn, formatsText);
            this._updateTooltips(generateBtn, dropdownBtn, formatsText);
        } else {
            this._clearIndicators(generateBtn, dropdownBtn);
        }
    }

    /**
     * Установка индикатора на кнопке
     * @private
     * @param {HTMLElement} button - Кнопка для индикатора
     * @param {string} text - Текст индикатора
     */
    static _setIndicator(button, text) {
        button.setAttribute('data-formats', text);
        button.classList.add('has-formats');
    }

    /**
     * Обновление подсказок кнопок
     * @private
     * @param {HTMLElement} generateBtn - Кнопка сохранения
     * @param {HTMLElement} dropdownBtn - Кнопка меню
     * @param {string} formatsText - Текст с форматами
     */
    static _updateTooltips(generateBtn, dropdownBtn, formatsText) {
        dropdownBtn.title = `Выбрано: ${formatsText}`;
        generateBtn.title = `Сохранить в форматах: ${formatsText}`;
    }

    /**
     * Очистка всех индикаторов
     * @private
     * @param {HTMLElement} generateBtn - Кнопка сохранения
     * @param {HTMLElement} dropdownBtn - Кнопка меню
     */
    static _clearIndicators(generateBtn, dropdownBtn) {
        [generateBtn, dropdownBtn].forEach(btn => {
            btn.removeAttribute('data-formats');
            btn.classList.remove('has-formats');
        });

        generateBtn.title = 'Выберите хотя бы один формат';
        dropdownBtn.title = 'Выбрать форматы';
    }
}
