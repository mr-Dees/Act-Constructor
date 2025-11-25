// static/js/acts-manager-page.js
/**
 * Менеджер главной страницы выбора актов
 *
 * Отображает карточки актов с возможностью открытия, дублирования и удаления.
 */

class ActsManagerPage {
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
     * Загружает и отображает список актов
     */
    static async loadActs() {
        const container = document.getElementById('actsListContainer');
        if (!container) return;

        container.innerHTML = '<div class="loading">Загрузка актов...</div>';

        try {
            const username = window.env?.JUPYTERHUB_USER || "unknown";
            const response = await fetch('/api/v1/acts/list', {
                headers: {'X-JupyterHub-User': username}
            });

            if (!response.ok) {
                throw new Error('Ошибка загрузки списка актов');
            }

            const acts = await response.json();

            if (!acts.length) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                        <h3>Нет доступных актов</h3>
                        <p>Создайте первый акт, чтобы начать работу</p>
                    </div>
                `;
                return;
            }

            this._renderActsGrid(acts, container);

        } catch (error) {
            console.error('Ошибка загрузки актов:', error);
            container.innerHTML = `
                <div class="empty-state" style="color: var(--error);">
                    <h3>Ошибка загрузки</h3>
                    <p>Не удалось загрузить список актов</p>
                </div>
            `;
            Notifications.error('Ошибка загрузки списка актов');
        }
    }

    /**
     * Рендерит сетку карточек актов
     * @private
     */
    static _renderActsGrid(acts, container) {
        const grid = document.createElement('div');
        grid.className = 'acts-grid';

        acts.forEach(act => {
            const card = this._createActCard(act);
            grid.appendChild(card);
        });

        container.innerHTML = '';
        container.appendChild(grid);
    }

    /**
     * Создает карточку акта
     * @private
     */
    static _createActCard(act) {
        const card = document.createElement('div');
        card.className = 'act-card';

        const lastEdited = this._formatDateTime(act.last_edited_at);
        const startDate = this._formatDate(act.inspection_start_date);
        const endDate = this._formatDate(act.inspection_end_date);

        card.innerHTML = `
            <div class="act-card-header">
                <h3 class="act-card-title">${this._escapeHtml(act.inspection_name)}</h3>
                <span class="act-card-role">${act.user_role}</span>
            </div>
            
            <div class="act-card-meta">
                <strong>КМ:</strong> ${this._escapeHtml(act.km_number)}
            </div>
            
            <div class="act-card-meta">
                <strong>Приказ:</strong> ${this._escapeHtml(act.order_number)}
            </div>
            
            <div class="act-card-meta">
                <strong>Период проверки:</strong><br>
                ${startDate} — ${endDate}
            </div>
            
            <div class="act-card-meta" style="margin-top:12px;font-size:12px;color:#999;">
                Изменено: ${lastEdited}
            </div>
            
            <div class="act-card-actions">
                <button class="btn btn-primary" onclick="ActsManagerPage.openAct(${act.id})" style="flex:2;">
                    Открыть
                </button>
                <button class="btn btn-secondary" onclick="ActsManagerPage.duplicateAct(${act.id}, '${this._escapeHtml(act.inspection_name)}')" style="flex:1;" title="Дублировать акт">
                    📋
                </button>
                <button class="btn btn-secondary" onclick="ActsManagerPage.deleteAct(${act.id}, '${this._escapeHtml(act.inspection_name)}')" style="flex:1;color:#dc3545;" title="Удалить акт">
                    🗑️
                </button>
            </div>
        `;

        return card;
    }

    /**
     * Открывает акт в конструкторе
     * @param {number} actId - ID акта
     */
    static openAct(actId) {
        window.location.href = `/constructor?act_id=${actId}`;
    }

    /**
     * Дублирует акт с подтверждением
     * @param {number} actId - ID акта
     * @param {string} actName - Название акта
     */
    static async duplicateAct(actId, actName) {
        const confirmed = await DialogManager.show({
            title: 'Дублирование акта',
            message: `Будет создана копия акта "${actName}". Продолжить?`,
            icon: '📋',
            confirmText: 'Создать копию',
            cancelText: 'Отмена'
        });

        if (!confirmed) {
            return;
        }

        try {
            const username = window.env?.JUPYTERHUB_USER || "unknown";
            const response = await fetch(`/api/v1/acts/${actId}/duplicate`, {
                method: 'POST',
                headers: {'X-JupyterHub-User': username}
            });

            if (!response.ok) {
                if (response.status === 403) {
                    throw new Error('Нет доступа к акту');
                } else if (response.status === 404) {
                    throw new Error('Акт не найден');
                }

                const error = await response.json();
                throw new Error(error.detail || 'Ошибка дублирования акта');
            }

            const newAct = await response.json();
            Notifications.success(`Копия создана: ${newAct.inspection_name}`);

            // Предлагаем открыть новый акт или остаться на странице
            const openNewAct = await DialogManager.show({
                title: 'Копия создана',
                message: 'Хотите открыть новый акт сейчас?',
                icon: '✅',
                confirmText: 'Открыть',
                cancelText: 'Остаться здесь'
            });

            if (openNewAct) {
                window.location.href = `/constructor?act_id=${newAct.id}`;
            } else {
                // Перезагружаем список актов
                await this.loadActs();
            }

        } catch (error) {
            console.error('Ошибка дублирования акта:', error);
            Notifications.error(`Не удалось создать копию: ${error.message}`);
        }
    }

    /**
     * Удаляет акт с подтверждением
     * @param {number} actId - ID акта
     * @param {string} actName - Название акта
     */
    static async deleteAct(actId, actName) {
        const confirmed = await DialogManager.show({
            title: 'Удаление акта',
            message: `Вы уверены, что хотите удалить акт "${actName}"? Это действие необратимо и удалит все данные акта.`,
            icon: '🗑️',
            confirmText: 'Удалить',
            cancelText: 'Отмена'
        });

        if (!confirmed) {
            return;
        }

        try {
            const username = window.env?.JUPYTERHUB_USER || "unknown";
            const response = await fetch(`/api/v1/acts/${actId}`, {
                method: 'DELETE',
                headers: {'X-JupyterHub-User': username}
            });

            if (!response.ok) {
                if (response.status === 403) {
                    throw new Error('Нет доступа к акту');
                } else if (response.status === 404) {
                    throw new Error('Акт не найден');
                }
                throw new Error('Ошибка удаления акта');
            }

            Notifications.success('Акт успешно удален');

            // Перезагружаем список актов
            await this.loadActs();

        } catch (error) {
            console.error('Ошибка удаления акта:', error);
            Notifications.error(`Не удалось удалить акт: ${error.message}`);
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
     * Инициализация страницы
     */
    static init() {
        // Загружаем список актов
        this.loadActs();

        // Обработчик кнопки создания акта
        const createBtn = document.getElementById('createNewActBtn');
        if (createBtn) {
            createBtn.addEventListener('click', () => {
                CreateActDialog.show();
            });
        }
    }
}

// Глобальный доступ
window.ActsManagerPage = ActsManagerPage;

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
    ActsManagerPage.init();
});
