/**
 * Менеджер системы помощи и инструкций
 *
 * Управляет отображением контекстных инструкций для пользователя
 * на разных этапах работы с конструктором актов.
 */
class HelpManager {
    /**
     * Инициализирует менеджер помощи
     */
    static init() {
        const elements = this._getElements();

        if (!this._validateElements(elements)) {
            return;
        }

        this._setupEventHandlers(elements);
        this.updateTooltip();
    }

    /**
     * Получает необходимые DOM-элементы
     * @private
     */
    static _getElements() {
        return {
            helpBtn: document.getElementById(AppConfig.help.elements.helpBtn),
            modal: document.getElementById(AppConfig.help.elements.modal)
        };
    }

    /**
     * Проверяет наличие обязательных элементов
     * @private
     */
    static _validateElements(elements) {
        if (!elements.helpBtn || !elements.modal) {
            console.error('HelpManager: не найдены необходимые элементы');
            return false;
        }
        return true;
    }

    /**
     * Настраивает обработчики событий
     * @private
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
     * Показывает модальное окно с инструкцией
     */
    static show() {
        const currentStep = AppState.currentStep || 1;

        const elements = this._getModalElements();
        if (!elements) return;

        const contentId = AppConfig.help.contentIds[currentStep];
        const contentElement = document.getElementById(contentId);

        if (!contentElement) {
            console.error('HelpManager: контент инструкции не найден для шага', currentStep);
            return;
        }

        this._updateModalContent(elements, currentStep, contentElement.innerHTML);
        this._showModal(elements.modal);
        this._lockBodyScroll();
    }

    /**
     * Получает элементы модального окна
     * @private
     */
    static _getModalElements() {
        const modal = document.getElementById(AppConfig.help.elements.modal);
        const title = document.getElementById(AppConfig.help.elements.modalTitle);
        const body = document.getElementById(AppConfig.help.elements.modalBody);

        if (!modal || !title || !body) {
            console.error('HelpManager: элементы модального окна не найдены');
            return null;
        }

        return {modal, title, body};
    }

    /**
     * Обновляет содержимое модального окна
     * @private
     */
    static _updateModalContent(elements, step, content) {
        const title = AppConfig.help.titles[step];
        elements.title.textContent = title;
        elements.body.innerHTML = content;
    }

    /**
     * Показывает модальное окно
     * @private
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
        const modal = document.getElementById(AppConfig.help.elements.modal);
        if (modal) {
            modal.classList.add('hidden');
            this._unlockBodyScroll();
        }
    }

    /**
     * Обновляет подсказку кнопки помощи
     */
    static updateTooltip() {
        const helpBtn = document.getElementById(AppConfig.help.elements.helpBtn);
        if (!helpBtn) return;

        const currentStep = AppState.currentStep || 1;
        const stepName = AppConfig.help.stepNames[currentStep];

        helpBtn.title = `Инструкция: Шаг ${currentStep} - ${stepName}`;
    }
}
