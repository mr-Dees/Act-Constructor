/**
 * Менеджер системы помощи и инструкций
 *
 * Управляет отображением контекстных инструкций для пользователя
 * на разных этапах работы с конструктором актов.
 */
class HelpManager {
    /**
     * Инициализирует менеджер помощи.
     * Безопасно проверяет DOM и настраивает обработчики событий.
     */
    static init() {
        try {
            const elements = this._getElements();

            if (!this._validateElements(elements)) {
                Notifications.error('Не удалось инициализировать систему помощи (DOM элементы не найдены)');
                return;
            }

            this._setupEventHandlers(elements);
            this.updateTooltip();
        } catch (error) {
            Notifications.error(`Ошибка инициализации HelpManager: ${error.message}`);
        }
    }

    /**
     * Получает все нужные DOM-элементы
     * @private
     * @returns {{helpBtn: HTMLElement|null, modal: HTMLElement|null}} Элементы интерфейса помощи
     */
    static _getElements() {
        return {
            helpBtn: document.getElementById('helpBtn'),
            modal: document.getElementById('helpModal')
        };
    }

    /**
     * Проверяет наличие обязательных элементов
     * @private
     * @param {{helpBtn: HTMLElement|null, modal: HTMLElement|null}} elements - Объекты DOM элементов
     * @returns {boolean} true если все элементы найдены, иначе false
     */
    static _validateElements(elements) {
        return !!(elements.helpBtn && elements.modal);
    }

    /**
     * Назначает события на элементы управления
     * @private
     * @param {{helpBtn: HTMLElement, modal: HTMLElement}} elements - DOM-элементы
     */
    static _setupEventHandlers(elements) {
        elements.helpBtn.addEventListener('click', () => this.show());

        elements.modal.addEventListener('click', (e) => {
            if (e.target === elements.modal) {
                this.hide();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !elements.modal.classList.contains('hidden')) {
                this.hide();
            }
        });
    }

    /**
     * Отображает модальное окно инструкции для текущего шага
     */
    static show() {
        try {
            const currentStep = AppState.currentStep || 1;
            const elements = this._getModalElements();

            if (!elements) return;

            const contentId = AppConfig.help.contentIds[currentStep];
            const contentElement = document.getElementById(contentId);

            if (!contentElement) {
                Notifications.info(`Помощь отсутствует для шага ${currentStep}`);
                return;
            }

            this._updateModalContent(elements, currentStep, contentElement.innerHTML);
            this._showModal(elements.modal);
            this._lockBodyScroll();
        } catch (error) {
            Notifications.error(`Ошибка показа помощи: ${error.message}`);
        }
    }

    /**
     * Находит внутренние элементы модального окна
     * @private
     * @returns {{modal: HTMLElement, title: HTMLElement, body: HTMLElement}|null} Элементы модального окна или null
     */
    static _getModalElements() {
        const modal = document.getElementById('helpModal');
        const title = document.getElementById('helpModalTitle');
        const body = document.getElementById('helpModalBody');

        if (!modal || !title || !body) {
            console.warn('HelpManager: структура модального окна неполная');
            return null;
        }

        return {modal, title, body};
    }

    /**
     * Обновляет содержимое модального окна
     * @private
     * @param {{title: HTMLElement, body: HTMLElement}} elements - Ссылки на элементы модального окна
     * @param {number} step - Номер шага
     * @param {string} content - HTML содержимое
     */
    static _updateModalContent(elements, step, content) {
        const title = AppConfig.help.titles[step] || 'Инструкция';
        elements.title.textContent = title;
        elements.body.innerHTML = content;
    }

    /**
     * Показывает модальное окно
     * @private
     * @param {HTMLElement} modal - Элемент модального окна
     */
    static _showModal(modal) {
        modal.classList.remove('hidden');
    }

    /**
     * Блокирует прокрутку основной страницы
     * @private
     */
    static _lockBodyScroll() {
        document.body.style.overflow = 'hidden';
    }

    /**
     * Разблокирует прокрутку основной страницы
     * @private
     */
    static _unlockBodyScroll() {
        document.body.style.overflow = '';
    }

    /**
     * Скрывает модальное окно
     */
    static hide() {
        const modal = document.getElementById('helpModal');
        if (modal) {
            modal.classList.add('hidden');
            this._unlockBodyScroll();
        }
    }

    /**
     * Обновляет всплывающую подсказку у кнопки помощи
     */
    static updateTooltip() {
        const helpBtn = document.getElementById('helpBtn');
        if (!helpBtn) return;

        const currentStep = AppState.currentStep || 1;
        const stepName = AppConfig.help.stepNames[currentStep] || 'Неизвестно';

        helpBtn.title = `Инструкция: Шаг ${currentStep} - ${stepName}`;
    }
}
