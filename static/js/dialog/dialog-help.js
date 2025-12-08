/**
 * Менеджер системы помощи и инструкций
 *
 * Управляет отображением контекстных инструкций для пользователя
 * на разных этапах работы с конструктором актов.
 * Наследует базовый функционал от DialogBase.
 */
class HelpManager extends DialogBase {
    /**
     * Текущее модальное окно
     * @private
     * @type {HTMLElement|null}
     */
    static _currentModal = null;

    /**
     * Инициализирует менеджер помощи
     */
    static init() {
        try {
            const elements = this._getElements();

            if (!this._validateElements(elements)) {
                console.warn('HelpManager: не удалось найти все необходимые элементы DOM');
                return;
            }

            this._setupEventHandlers(elements);
            this.updateTooltip();
        } catch (error) {
            console.error(`Ошибка инициализации HelpManager: ${error.message}`);
        }
    }

    /**
     * Получает все нужные DOM-элементы
     * @private
     * @returns {{helpBtn: HTMLElement|null, modal: HTMLElement|null, closeBtn: HTMLElement|null}} Элементы интерфейса помощи
     */
    static _getElements() {
        return {
            helpBtn: document.getElementById('helpBtn'),
            modal: document.getElementById('helpModal'),
            closeBtn: document.getElementById('closeHelpModalBtn')
        };
    }

    /**
     * Проверяет наличие обязательных элементов
     * @private
     * @param {{helpBtn: HTMLElement|null, modal: HTMLElement|null, closeBtn: HTMLElement|null}} elements - Объекты DOM элементов
     * @returns {boolean} true если все элементы найдены, иначе false
     */
    static _validateElements(elements) {
        return !!(elements.helpBtn && elements.modal);
    }

    /**
     * Назначает события на элементы управления
     * @private
     * @param {{helpBtn: HTMLElement, modal: HTMLElement, closeBtn: HTMLElement|null}} elements - DOM-элементы
     */
    static _setupEventHandlers(elements) {
        const {helpBtn, modal, closeBtn} = elements;

        // Открытие по кнопке помощи
        helpBtn.addEventListener('click', () => this.show());

        // Закрытие по кнопке крестика
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }

        // Закрытие по клику на оверлей (сам modal является оверлеем)
        this._setupOverlayClickHandler(modal, modal.querySelector('.help-modal-content'), () => this.hide());

        // Закрытие по Escape
        this._setupModalEscapeHandler(modal);
    }

    /**
     * Настраивает обработчик Escape для модального окна помощи
     * @private
     */
    static _setupModalEscapeHandler(modal) {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
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
                if (typeof Notifications !== 'undefined') {
                    Notifications.info(`Помощь отсутствует для шага ${currentStep}`);
                }
                return;
            }

            this._updateModalContent(elements, currentStep, contentElement.innerHTML);
            this._showModalHelp(elements.modal);
        } catch (error) {
            console.error(`Ошибка показа помощи: ${error.message}`);
            if (typeof Notifications !== 'undefined') {
                Notifications.error(`Ошибка показа помощи: ${error.message}`);
            }
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
     * Показывает модальное окно помощи
     * @private
     * @param {HTMLElement} modal - Элемент модального окна
     */
    static _showModalHelp(modal) {
        const modalBody = modal.querySelector('.help-modal-body');
        if (modalBody) {
            modalBody.scrollTop = 0;
        }
        modal.classList.remove('hidden');
        this._currentModal = modal;
        this._lockBodyScroll();
    }

    /**
     * Скрывает модальное окно
     */
    static hide() {
        const modal = document.getElementById('helpModal');
        if (modal) {
            modal.classList.add('hidden');
            this._currentModal = null;
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

// Глобальный доступ
window.HelpManager = HelpManager;

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
    HelpManager.init();
});
