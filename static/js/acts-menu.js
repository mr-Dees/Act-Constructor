// static/js/acts-menu.js
/**
 * Менеджер меню выбора актов
 *
 * Управляет отображением списка актов пользователя и переключением между ними.
 * Интегрирован с БД через API. Отвечает за автозагрузку акта при входе в конструктор.
 */

class ActsMenuManager {
    /**
     * Текущий ID акта
     * @type {number|null}
     */
    static currentActId = null;

    /**
     * Флаг выполнения начальной загрузки
     * @type {boolean}
     */
    static _initialLoadInProgress = false;

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

            return `${day}.${month}.${year} ${hours}:${minutes}`;
        } catch (e) {
            return 'Не редактировался';
        }
    }

    /**
     * Рендерит список актов в меню
     */
    static async renderActsList() {
        const listContainer = document.getElementById('actsList');
        if (!listContainer) return;

        listContainer.innerHTML = '<li class="acts-list-loading">Загрузка...</li>';

        try {
            const acts = await this.fetchActsList();

            if (!acts.length) {
                listContainer.innerHTML = `
                    <div class="acts-list-empty">
                        <div class="acts-list-empty-icon">📋</div>
                        <div class="acts-list-empty-text">Нет доступных актов</div>
                    </div>
                `;
                return;
            }

            listContainer.innerHTML = '';

            acts.forEach(act => {
                const li = document.createElement('li');
                li.className = "acts-list-item";
                if (this.currentActId === act.id) {
                    li.classList.add('current');
                }

                const lastEdited = this._formatDateTime(act.last_edited_at);
                const startDate = this._formatDate(act.inspection_start_date);
                const endDate = this._formatDate(act.inspection_end_date);

                li.innerHTML = `
                    <div class="acts-list-item-header">
                        <div class="acts-list-item-title">${this._escapeHtml(act.inspection_name)}</div>
                        <span class="acts-list-item-badge">${this._escapeHtml(act.user_role)}</span>
                    </div>
                    <div class="acts-list-item-meta">
                        <div class="acts-list-item-meta-row">
                            <span class="acts-list-item-meta-label">КМ:</span>
                            <span>${this._escapeHtml(act.km_number)}</span>
                        </div>
                        <div class="acts-list-item-meta-row">
                            <span class="acts-list-item-meta-label">Приказ:</span>
                            <span>${this._escapeHtml(act.order_number)}</span>
                        </div>
                        <div class="acts-list-item-meta-row">
                            <span class="acts-list-item-meta-label">Период:</span>
                            <span>${startDate} — ${endDate}</span>
                        </div>
                    </div>
                    <div class="acts-list-item-date">
                        Изменено: ${lastEdited}
                    </div>
                `;

                li.addEventListener('click', () => this.selectAct(act.id));

                listContainer.appendChild(li);
            });

        } catch (err) {
            console.error('Ошибка загрузки актов:', err);
            listContainer.innerHTML = `
                <div class="acts-list-error">
                    ❌ Ошибка загрузки списка актов
                </div>
            `;
            if (typeof Notifications !== 'undefined') {
                Notifications.error('Ошибка загрузки списка актов');
            }
        }
    }

    /**
     * Выбирает акт и загружает его содержимое
     * @param {number} actId - ID акта
     */
    static async selectAct(actId) {
        if (actId === this.currentActId) {
            this.hide();
            return;
        }

        // Проверяем наличие несохраненных в БД изменений
        if (StorageManager.hasUnsyncedChanges()) {
            // Закрываем меню перед показом диалога
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
                    // Синхронизируем данные и сохраняем в БД
                    if (typeof ItemsRenderer !== 'undefined') {
                        ItemsRenderer.syncDataToState();
                    }

                    await APIClient.saveActContent(window.currentActId);
                    Notifications.success('Изменения сохранены в БД');
                } catch (err) {
                    console.error('Ошибка сохранения:', err);
                    Notifications.error('Не удалось сохранить изменения');

                    // Спрашиваем, продолжить ли без сохранения
                    const continueAnyway = await DialogManager.show({
                        title: 'Ошибка сохранения',
                        message: 'Не удалось сохранить изменения. Продолжить без сохранения?',
                        icon: '❌',
                        confirmText: 'Продолжить',
                        cancelText: 'Отмена'
                    });

                    if (!continueAnyway) {
                        // Возвращаем меню если пользователь отменил
                        this.show();
                        return;
                    }
                }
            }
        } else {
            // Если нет несохраненных изменений, просто закрываем меню
            this.hide();
        }

        try {
            // Очищаем localStorage перед загрузкой нового акта
            StorageManager.clearStorage();

            this.currentActId = actId;
            window.currentActId = actId;

            // Загружаем содержимое акта
            await APIClient.loadActContent(actId);

            // Обновляем URL без перезагрузки
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
     * Показывает диалог редактирования метаданных текущего акта
     */
    static async showEditMetadataDialog() {
        if (!this.currentActId) {
            Notifications.warning('Сначала выберите акт');
            return;
        }

        try {
            const username = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";
            const response = await fetch(`/api/v1/acts/${this.currentActId}`, {
                headers: {'X-JupyterHub-User': username}
            });

            if (!response.ok) throw new Error('Ошибка загрузки данных акта');

            const actData = await response.json();

            // Закрываем меню перед показом диалога
            this.hide();

            CreateActDialog.showEdit(actData);

        } catch (err) {
            console.error('Ошибка загрузки данных акта:', err);
            Notifications.error('Не удалось загрузить данные акта');
        }
    }

    /**
     * Создает дубликат текущего акта
     */
    static async duplicateCurrentAct() {
        if (!this.currentActId) {
            Notifications.warning('Сначала выберите акт');
            return;
        }

        // Закрываем меню перед показом диалога подтверждения
        this.hide();

        const confirmed = await DialogManager.show({
            title: 'Дублирование акта',
            message: 'Будет создана копия текущего акта. Продолжить?',
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
                `/api/v1/acts/${this.currentActId}/duplicate`,
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

            // Переходим к новому акту
            window.location.href = `/constructor?act_id=${newAct.id}`;

        } catch (err) {
            console.error('Ошибка дублирования акта:', err);
            Notifications.error(`Не удалось создать копию: ${err.message}`);
        }
    }

    /**
     * Удаляет текущий акт
     */
    static async deleteCurrentAct() {
        if (!this.currentActId) {
            Notifications.warning('Сначала выберите акт');
            return;
        }

        // Закрываем меню перед показом диалога
        this.hide();

        const confirmed = await DialogManager.show({
            title: 'Удаление акта',
            message: 'Вы уверены, что хотите удалить этот акт? Это действие необратимо и удалит все данные акта.',
            icon: '🗑️',
            confirmText: 'Удалить',
            cancelText: 'Отмена'
        });

        if (!confirmed) {
            Notifications.info('Удаление отменено');
            return;
        }

        try {
            await APIClient.deleteAct(this.currentActId);

            // Очищаем localStorage
            StorageManager.clearStorage();

            // Переходим на главную страницу
            window.location.href = '/';

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

        const indicator = document.createElement('div');
        indicator.id = 'actLoadingIndicator';
        indicator.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            flex-direction: column;
            gap: 16px;
        `;

        indicator.innerHTML = `
            <div class="spinner" style="
                border: 4px solid #f3f3f3;
                border-top: 4px solid #007bff;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                animation: spin 1s linear infinite;
            "></div>
            <p style="font-size: 16px; color: #333; font-weight: 500;">${this._escapeHtml(message)}</p>
        `;

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
