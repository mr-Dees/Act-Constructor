// static/js/acts-menu.js
/**
 * Менеджер меню выбора актов
 *
 * Управляет отображением списка актов пользователя и переключением между ними.
 * Интегрирован с БД через API. Отвечает за автозагрузку акта при входе в конструктор.
 */

class ActsMenuManager {
    /**
     * Текущий ID акта (загруженный)
     * @type {number|null}
     */
    static currentActId = null;

    /**
     * Выбранный ID акта (выделенный для действий)
     * @type {number|null}
     */
    static selectedActId = null;

    /**
     * Флаг выполнения начальной загрузки
     * @type {boolean}
     */
    static _initialLoadInProgress = false;

    /**
     * Таймер для отслеживания двойного клика
     * @private
     * @type {number|null}
     */
    static _clickTimer = null;

    /**
     * Задержка для определения двойного клика (мс)
     * @private
     * @type {number}
     */
    static _clickDelay = 300;

    /**
     * Настраивает обработчик закрытия по Escape
     * @private
     */
    static _setupEscapeHandler() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const menu = document.getElementById('actsMenuDropdown');
                if (menu && !menu.classList.contains('hidden')) {
                    this.hide();
                }
            }
        });
    }

    /**
     * Показывает меню выбора актов
     */
    static show() {
        const menu = document.getElementById('actsMenuDropdown');
        const btn = document.getElementById('actsMenuBtn');

        if (menu) {
            menu.classList.remove('hidden');
            if (btn) {
                btn.classList.add('active');
            }
            this.renderActsList();
        }
    }

    /**
     * Скрывает меню выбора актов
     */
    static hide() {
        const menu = document.getElementById('actsMenuDropdown');
        const btn = document.getElementById('actsMenuBtn');

        if (menu) {
            menu.classList.add('hidden');
        }
        if (btn) {
            btn.classList.remove('active');
        }
    }

    /**
     * Переключает видимость меню
     */
    static toggle() {
        const menu = document.getElementById('actsMenuDropdown');
        if (menu && menu.classList.contains('hidden')) {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Загружает список актов из API
     * @returns {Promise<Array>} Массив актов
     */
    static async fetchActsList() {
        const username = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";

        const response = await fetch('/api/v1/acts/list', {
            headers: {'X-JupyterHub-User': username}
        });

        if (!response.ok) {
            throw new Error('Ошибка загрузки списка актов');
        }

        return await response.json();
    }

    /**
     * Форматирует дату в формате DD.MM.YYYY
     * @private
     * @param {string|Date} date - Дата для форматирования
     * @returns {string} Отформатированная дата
     */
    static _formatDate(date) {
        if (!date) return '—';

        try {
            const d = new Date(date);
            if (isNaN(d.getTime())) return '—';

            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();

            return `${day}.${month}.${year}`;
        } catch (e) {
            return '—';
        }
    }

    /**
     * Форматирует дату и время в формате DD.MM.YYYY HH:MM
     * @private
     * @param {string|Date} datetime - Дата-время для форматирования
     * @returns {string} Отформатированная дата-время
     */
    static _formatDateTime(datetime) {
        if (!datetime) return 'Не редактировался';

        try {
            const d = new Date(datetime);
            if (isNaN(d.getTime())) return 'Не редактировался';

            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');

            return `Изменено: ${day}.${month}.${year} ${hours}:${minutes}`;
        } catch (e) {
            return 'Не редактировался';
        }
    }

    /**
     * Форматирует информацию о частях акта
     * @private
     * @param {number} partNumber - Номер части
     * @param {number} totalParts - Общее количество частей
     * @returns {string} Отформатированная строка с частью
     */
    static _formatPartInfo(partNumber, totalParts) {
        if (!totalParts || totalParts === 1) {
            return ''; // Не показываем части если акт один
        }
        return `_${partNumber}`;
    }

    /**
     * Клонирует template элемент
     * @private
     * @param {string} templateId - ID template
     * @returns {DocumentFragment|null} Клонированный template
     */
    static _cloneTemplate(templateId) {
        const template = document.getElementById(templateId);
        if (!template) {
            console.error(`Template ${templateId} не найден`);
            return null;
        }
        return template.content.cloneNode(true);
    }

    /**
     * Заполняет поля в элементе данными
     * @private
     * @param {Element} element - Элемент для заполнения
     * @param {Object} data - Данные для заполнения
     */
    static _fillFields(element, data) {
        element.querySelectorAll('[data-field]').forEach(field => {
            const fieldName = field.getAttribute('data-field');
            if (data.hasOwnProperty(fieldName)) {
                field.textContent = data[fieldName];
            }
        });
    }

    /**
     * Рендерит список актов в меню
     */
    static async renderActsList() {
        const listContainer = document.getElementById('actsList');
        if (!listContainer) return;

        this._showLoading(listContainer);

        try {
            const acts = await this.fetchActsList();

            if (!acts.length) {
                this._showEmptyState(listContainer);
                return;
            }

            // Разделяем акты на текущий и остальные
            const currentAct = acts.find(act => act.id === this.currentActId);
            const otherActs = acts.filter(act => act.id !== this.currentActId);

            listContainer.innerHTML = '';

            // Рендерим текущий акт отдельно
            if (currentAct) {
                const currentSection = document.createElement('div');
                currentSection.className = 'acts-list-current-section';

                const currentLabel = document.createElement('div');
                currentLabel.className = 'acts-list-current-label';
                currentLabel.textContent = 'Текущий акт';

                currentSection.appendChild(currentLabel);
                currentSection.appendChild(this._createActListItem(currentAct, true));

                listContainer.appendChild(currentSection);
            }

            // Рендерим остальные акты
            if (otherActs.length > 0) {
                const otherSection = document.createElement('div');
                otherSection.className = 'acts-list-other-section';

                const otherLabel = document.createElement('div');
                otherLabel.className = 'acts-list-other-label';
                otherLabel.textContent = 'Другие акты';

                otherSection.appendChild(otherLabel);

                otherActs.forEach(act => {
                    otherSection.appendChild(this._createActListItem(act, false));
                });

                listContainer.appendChild(otherSection);
            }

        } catch (err) {
            console.error('Ошибка загрузки актов:', err);
            this._showErrorState(listContainer);
            if (typeof Notifications !== 'undefined') {
                Notifications.error('Ошибка загрузки списка актов');
            }
        }
    }

    /**
     * Создает элемент списка акта из template
     * @private
     * @param {Object} act - Данные акта
     * @param {boolean} isCurrent - Является ли акт текущим
     * @returns {Element} Элемент списка
     */
    static _createActListItem(act, isCurrent) {
        const item = this._cloneTemplate('actsMenuItemTemplate');
        if (!item) {
            console.error('Template actsMenuItemTemplate не найден');
            return document.createElement('li');
        }

        const lastEdited = this._formatDateTime(act.last_edited_at);
        const startDate = this._formatDate(act.inspection_start_date);
        const endDate = this._formatDate(act.inspection_end_date);
        const partInfo = this._formatPartInfo(act.part_number, act.total_parts);

        // Подготавливаем данные для заполнения
        const data = {
            inspection_name: act.inspection_name,
            user_role: act.user_role,
            km_display: `${act.km_number}${partInfo}`,
            order_number: act.order_number,
            inspection_start_date: startDate,
            inspection_end_date: endDate,
            last_edited_at: lastEdited
        };

        // Заполняем поля
        this._fillFields(item, data);

        // Получаем элемент li
        const listItem = item.querySelector('.acts-menu-list-item');
        if (listItem) {
            listItem.dataset.actId = act.id;

            // Добавляем классы состояния
            if (isCurrent) {
                listItem.classList.add('current');
            }
            if (this.selectedActId === act.id) {
                listItem.classList.add('selected');
            }

            // Обработчик клика
            listItem.addEventListener('click', (e) => this._handleActClick(e, act.id));
        }

        return item;
    }

    /**
     * Показывает индикатор загрузки
     * @private
     * @param {Element} container - Контейнер для индикатора
     */
    static _showLoading(container) {
        const loading = this._cloneTemplate('actsLoadingTemplate');
        if (loading) {
            container.innerHTML = '';
            container.appendChild(loading);
        }
    }

    /**
     * Показывает пустое состояние
     * @private
     * @param {Element} container - Контейнер для сообщения
     */
    static _showEmptyState(container) {
        const emptyState = this._cloneTemplate('actsEmptyStateTemplate');
        if (emptyState) {
            container.innerHTML = '';
            container.appendChild(emptyState);
        }
    }

    /**
     * Показывает состояние ошибки
     * @private
     * @param {Element} container - Контейнер для сообщения
     */
    static _showErrorState(container) {
        const errorState = this._cloneTemplate('actsErrorStateTemplate');
        if (errorState) {
            container.innerHTML = '';
            container.appendChild(errorState);
        }
    }

    /**
     * Обрабатывает клик по карточке акта
     * @private
     * @param {Event} e - Событие клика
     * @param {number} actId - ID акта
     */
    static _handleActClick(e, actId) {
        e.preventDefault();
        e.stopPropagation();

        // Если это двойной клик - загружаем акт
        if (this._clickTimer !== null) {
            clearTimeout(this._clickTimer);
            this._clickTimer = null;
            this._loadAct(actId);
            return;
        }

        // Одинарный клик - выделяем акт
        this._clickTimer = setTimeout(() => {
            this._clickTimer = null;
            this._selectActForActions(actId);
        }, this._clickDelay);
    }

    /**
     * Выделяет акт для действий (редактирование, дублирование, удаление)
     * @private
     * @param {number} actId - ID акта
     */
    static _selectActForActions(actId) {
        this.selectedActId = actId;

        // Убираем класс selected со всех элементов
        const allItems = document.querySelectorAll('.acts-menu-list-item');
        allItems.forEach(item => item.classList.remove('selected'));

        // Добавляем класс selected к выбранному элементу
        const selectedItem = document.querySelector(`.acts-menu-list-item[data-act-id="${actId}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }

        console.log('Выбран акт для действий:', actId);
    }

    /**
     * Загружает акт (переход к редактированию)
     * @private
     * @param {number} actId - ID акта
     */
    static async _loadAct(actId) {
        if (actId === this.currentActId) {
            this.hide();
            return;
        }

        // Проверяем наличие несохраненных в БД изменений
        if (StorageManager.hasUnsyncedChanges()) {
            this.hide();

            const confirmed = await DialogManager.show({
                title: 'Несохраненные изменения',
                message: 'У вас есть несохраненные изменения в текущем акте. Если вы продолжите, они будут утеряны. Сохранить изменения в базу данных?',
                icon: '⚠️',
                confirmText: 'Сохранить и продолжить',
                cancelText: 'Не сохранять'
            });

            if (confirmed) {
                try {
                    if (typeof ItemsRenderer !== 'undefined') {
                        ItemsRenderer.syncDataToState();
                    }

                    await APIClient.saveActContent(window.currentActId);
                    Notifications.success('Изменения сохранены в БД');
                } catch (err) {
                    console.error('Ошибка сохранения:', err);
                    Notifications.error('Не удалось сохранить изменения');

                    const continueAnyway = await DialogManager.show({
                        title: 'Ошибка сохранения',
                        message: 'Не удалось сохранить изменения. Продолжить без сохранения?',
                        icon: '❌',
                        confirmText: 'Продолжить',
                        cancelText: 'Отмена'
                    });

                    if (!continueAnyway) {
                        this.show();
                        return;
                    }
                }
            }
        } else {
            this.hide();
        }

        try {
            StorageManager.clearStorage();

            this.currentActId = actId;
            this.selectedActId = actId;
            window.currentActId = actId;

            await APIClient.loadActContent(actId);

            const newUrl = `/constructor?act_id=${actId}`;
            window.history.pushState({actId}, '', newUrl);

            if (typeof Notifications !== 'undefined') {
                Notifications.success('Акт загружен');
            }

        } catch (err) {
            console.error('Ошибка загрузки акта:', err);
            if (typeof Notifications !== 'undefined') {
                Notifications.error('Не удалось загрузить акт');
            }
        }
    }

    /**
     * Показывает диалог редактирования метаданных выбранного акта
     */
    static async showEditMetadataDialog() {
        const actId = this.selectedActId || this.currentActId;

        if (!actId) {
            Notifications.warning('Сначала выберите акт из списка');
            return;
        }

        try {
            const username = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";
            const response = await fetch(`/api/v1/acts/${actId}`, {
                headers: {'X-JupyterHub-User': username}
            });

            if (!response.ok) throw new Error('Ошибка загрузки данных акта');

            const actData = await response.json();

            this.hide();

            CreateActDialog.showEdit(actData);

        } catch (err) {
            console.error('Ошибка загрузки данных акта:', err);
            Notifications.error('Не удалось загрузить данные акта');
        }
    }

    /**
     * Создает дубликат выбранного акта
     */
    static async duplicateCurrentAct() {
        const actId = this.selectedActId || this.currentActId;

        if (!actId) {
            Notifications.warning('Сначала выберите акт из списка');
            return;
        }

        this.hide();

        const confirmed = await DialogManager.show({
            title: 'Дублирование акта',
            message: 'Будет создана копия выбранного акта. Продолжить?',
            icon: '📋',
            confirmText: 'Создать копию',
            cancelText: 'Отмена'
        });

        if (!confirmed) {
            Notifications.info('Дублирование отменено');
            return;
        }

        try {
            const username = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";
            const response = await fetch(
                `/api/v1/acts/${actId}/duplicate`,
                {
                    method: 'POST',
                    headers: {'X-JupyterHub-User': username}
                }
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Ошибка дублирования');
            }

            const newAct = await response.json();
            Notifications.success(`Копия создана: ${newAct.inspection_name}`);

            window.location.href = `/constructor?act_id=${newAct.id}`;

        } catch (err) {
            console.error('Ошибка дублирования акта:', err);
            Notifications.error(`Не удалось создать копию: ${err.message}`);
        }
    }

    /**
     * Удаляет выбранный акт
     */
    static async deleteCurrentAct() {
        const actId = this.selectedActId || this.currentActId;

        if (!actId) {
            Notifications.warning('Сначала выберите акт из списка');
            return;
        }

        this.hide();

        const confirmed = await DialogManager.show({
            title: 'Удаление акта',
            message: 'Вы уверены, что хотите удалить выбранный акт? Это действие необратимо и удалит все данные акта.',
            icon: '🗑️',
            confirmText: 'Удалить',
            cancelText: 'Отмена'
        });

        if (!confirmed) {
            Notifications.info('Удаление отменено');
            return;
        }

        try {
            await APIClient.deleteAct(actId);

            // Если удаляем текущий акт - очищаем localStorage и переходим на главную
            if (actId === this.currentActId) {
                StorageManager.clearStorage();
                window.location.href = '/';
            } else {
                // Если удаляем другой акт - перезагружаем список
                Notifications.success('Акт успешно удален');
                await this.renderActsList();
                this.show();
            }

        } catch (err) {
            console.error('Ошибка удаления акта:', err);
            Notifications.error(`Не удалось удалить акт: ${err.message}`);
        }
    }

    /**
     * Автоматическая загрузка акта при инициализации страницы
     * @private
     * @param {number} actId - ID акта из URL
     */
    static async _autoLoadAct(actId) {
        if (this._initialLoadInProgress) {
            console.log('Загрузка уже выполняется');
            return;
        }

        this._initialLoadInProgress = true;
        this.currentActId = actId;
        this.selectedActId = actId;
        window.currentActId = actId;

        try {
            // Проверяем localStorage
            const stateKey = AppConfig.localStorage.stateKey;
            const savedStateJson = localStorage.getItem(stateKey);

            let restoredFromCache = false;

            if (savedStateJson) {
                try {
                    const savedState = JSON.parse(savedStateJson);
                    const savedActId = savedState.actId;

                    // Если actId совпадает - восстанавливаем из localStorage
                    if (savedActId === actId) {
                        console.log('Восстанавливаем акт из localStorage, ID:', actId);

                        // Показываем индикатор на время восстановления
                        this._showLoadingIndicator('Восстановление из кеша...');

                        // Восстанавливаем состояние через StorageManager
                        const restored = StorageManager.restoreSavedState();

                        if (restored) {
                            // Обновляем UI
                            if (typeof treeManager !== 'undefined') {
                                treeManager.render();
                            }
                            if (typeof ItemsRenderer !== 'undefined') {
                                ItemsRenderer.renderAll();
                            }
                            if (typeof PreviewManager !== 'undefined') {
                                PreviewManager.update();
                            }

                            Notifications.success('Акт восстановлен из кеша');
                            restoredFromCache = true;
                        }
                    }
                } catch (err) {
                    console.error('Ошибка парсинга localStorage:', err);
                    // Очищаем поврежденный кеш
                    StorageManager.clearStorage();
                }
            }

            // Если не удалось восстановить из кеша - загружаем из БД
            if (!restoredFromCache) {
                console.log('Загружаем акт из БД, ID:', actId);
                this._showLoadingIndicator('Загрузка из базы данных...');

                await APIClient.loadActContent(actId);
                Notifications.success('Акт загружен из базы данных');
            }

        } catch (err) {
            console.error('Ошибка загрузки акта:', err);

            // Показываем понятное сообщение об ошибке
            if (err.message.includes('Нет доступа')) {
                Notifications.error('У вас нет доступа к этому акту');
            } else if (err.message.includes('не найден')) {
                Notifications.error('Акт не найден');
            } else {
                Notifications.error('Не удалось загрузить акт');
            }

            // Показываем меню выбора актов
            setTimeout(() => {
                this.show();
            }, 1000);

        } finally {
            this._hideLoadingIndicator();
            this._initialLoadInProgress = false;
        }
    }

    /**
     * Показывает индикатор загрузки
     * @private
     * @param {string} [message='Загрузка акта...'] - Текст сообщения
     */
    static _showLoadingIndicator(message = 'Загрузка акта...') {
        // Удаляем предыдущий индикатор если есть
        this._hideLoadingIndicator();

        const indicator = this._cloneTemplate('actLoadingIndicatorTemplate');
        if (!indicator) {
            console.error('Template actLoadingIndicatorTemplate не найден');
            return;
        }

        // Заполняем сообщение
        const messageField = indicator.querySelector('[data-field="message"]');
        if (messageField) {
            messageField.textContent = message;
        }

        // Получаем корневой элемент и добавляем ID для последующего удаления
        const indicatorElement = indicator.querySelector('.act-loading-indicator');
        if (indicatorElement) {
            indicatorElement.id = 'actLoadingIndicator';
        }

        document.body.appendChild(indicator);
    }

    /**
     * Скрывает индикатор загрузки
     * @private
     */
    static _hideLoadingIndicator() {
        const indicator = document.getElementById('actLoadingIndicator');
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * Экранирует HTML
     * @private
     */
    static _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Инициализация обработчиков и автозагрузка акта
     */
    static init() {
        const menuBtn = document.getElementById('actsMenuBtn');
        const closeBtn = document.getElementById('closeActsMenuBtn');
        const createBtn = document.getElementById('createNewActBtn');
        const editBtn = document.getElementById('editMetadataBtn');
        const duplicateBtn = document.getElementById('duplicateActBtn');
        const deleteBtn = document.getElementById('deleteActBtn');

        // Закрытие по Escape
        this._setupEscapeHandler();

        if (menuBtn) {
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggle();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }

        if (createBtn) {
            createBtn.addEventListener('click', () => {
                this.hide();
                CreateActDialog.show();
            });
        }

        if (editBtn) {
            editBtn.addEventListener('click', () => this.showEditMetadataDialog());
        }

        if (duplicateBtn) {
            duplicateBtn.addEventListener('click', () => this.duplicateCurrentAct());
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.deleteCurrentAct());
        }

        // Закрытие при клике вне меню
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('actsMenuDropdown');
            if (menu && !menu.contains(e.target) && !menuBtn?.contains(e.target)) {
                this.hide();
            }
        });

        // Предотвращаем закрытие при клике внутри меню
        const menu = document.getElementById('actsMenuDropdown');
        if (menu) {
            menu.addEventListener('click', (e) => e.stopPropagation());
        }

        // Извлекаем act_id из URL
        const urlParams = new URLSearchParams(window.location.search);
        const actIdFromUrl = urlParams.get('act_id');

        if (actIdFromUrl) {
            const actId = parseInt(actIdFromUrl);

            // Автоматически загружаем акт
            this._autoLoadAct(actId);
        } else {
            // Если нет act_id - показываем меню выбора
            console.log('Нет act_id в URL, показываем меню');
            setTimeout(() => {
                this.show();
            }, 500);
        }
    }
}

// Глобальный доступ
window.ActsMenuManager = ActsMenuManager;

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
    ActsMenuManager.init();
});
