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
        const menu = document.getElementById('actsMenu');
        if (menu) {
            menu.classList.remove('hidden');
            this.renderActsList();
        }
    }

    /**
     * Скрывает меню выбора актов
     */
    static hide() {
        const menu = document.getElementById('actsMenu');
        if (menu) {
            menu.classList.add('hidden');
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
     * Рендерит список актов в меню
     */
    static async renderActsList() {
        const listContainer = document.getElementById('actsList');
        if (!listContainer) return;

        listContainer.innerHTML = '<li style="padding:8px;color:#999;">Загрузка...</li>';

        try {
            const acts = await this.fetchActsList();

            if (!acts.length) {
                listContainer.innerHTML = `
                    <li style="padding:12px;text-align:center;color:#999;">
                        Нет доступных актов
                    </li>
                    <li style="padding:8px;text-align:center;">
                        <button class="btn btn-primary" id="createActFromMenuBtn" style="width:100%;">
                            Создать новый акт
                        </button>
                    </li>
                `;
                document.getElementById('createActFromMenuBtn')?.addEventListener('click', () => {
                    this.hide();
                    CreateActDialog.show();
                });
                return;
            }

            listContainer.innerHTML = '';

            acts.forEach(act => {
                const li = document.createElement('li');
                li.className = "acts-list-item";
                li.style.cssText = `
                    margin-bottom:12px;
                    padding:12px;
                    border:1px solid #ddd;
                    border-radius:6px;
                    background: ${this.currentActId === act.id ? '#f0f8ff' : 'white'};
                    cursor:pointer;
                    transition: all 0.2s;
                `;

                const lastEdited = act.last_edited_at
                    ? new Date(act.last_edited_at).toLocaleString('ru-RU')
                    : 'Не редактировался';

                li.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
                        <b style="font-size:15px;">${this._escapeHtml(act.inspection_name)}</b>
                        <span style="
                            background:#6c757d;
                            color:white;
                            padding:2px 8px;
                            border-radius:10px;
                            font-size:11px;
                        ">${act.user_role}</span>
                    </div>
                    <div style="font-size:13px;color:#666;margin-bottom:4px;">
                        <strong>КМ:</strong> ${act.km_number}
                    </div>
                    <div style="font-size:13px;color:#666;margin-bottom:8px;">
                        <strong>Город:</strong> ${act.city}
                    </div>
                    <div style="font-size:12px;color:#999;">
                        Изменено: ${lastEdited}
                    </div>
                `;

                li.addEventListener('click', () => this.selectAct(act.id));
                li.addEventListener('mouseenter', () => {
                    if (this.currentActId !== act.id) {
                        li.style.background = '#f9f9f9';
                        li.style.borderColor = '#007bff';
                    }
                });
                li.addEventListener('mouseleave', () => {
                    if (this.currentActId !== act.id) {
                        li.style.background = 'white';
                        li.style.borderColor = '#ddd';
                    }
                });

                listContainer.appendChild(li);
            });

            // Кнопка создания нового акта внизу списка
            const createLi = document.createElement('li');
            createLi.style.cssText = 'padding:8px;margin-top:16px;border-top:1px solid #ddd;';
            createLi.innerHTML = `
                <button class="btn btn-primary" id="createActFromMenuBtn" style="width:100%;">
                    + Создать новый акт
                </button>
            `;
            listContainer.appendChild(createLi);

            document.getElementById('createActFromMenuBtn')?.addEventListener('click', () => {
                this.hide();
                CreateActDialog.show();
            });

        } catch (err) {
            console.error('Ошибка загрузки актов:', err);
            listContainer.innerHTML = `
                <li style="padding:12px;text-align:center;color:red;">
                    Ошибка загрузки списка актов
                </li>
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

        try {
            // Очищаем localStorage перед загрузкой нового акта
            StorageManager.clearStorage();

            this.currentActId = actId;
            window.currentActId = actId;

            this.hide();

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

        const newKm = prompt('Введите новый номер КМ для дубликата:');
        if (!newKm) return;

        try {
            const username = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";
            const response = await fetch(
                `/api/v1/acts/${this.currentActId}/duplicate?new_km_number=${encodeURIComponent(newKm)}`,
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
            Notifications.success(`Дубликат создан: КМ ${newAct.km_number}`);

            // Переходим к новому акту
            window.location.href = `/constructor?act_id=${newAct.id}`;

        } catch (err) {
            console.error('Ошибка дублирования акта:', err);
            Notifications.error(`Не удалось создать дубликат: ${err.message}`);
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
        <p style="font-size: 16px; color: #333; font-weight: 500;">${message}</p>
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

        if (menuBtn) {
            menuBtn.addEventListener('click', () => this.show());
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
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
