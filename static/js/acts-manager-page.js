/**
 * Менеджер главной страницы выбора актов
 */

class ActsManagerPage {
    /**
     * Форматирует отображение КМ с учетом служебной записки
     * @private
     */
    static _formatKmNumber(kmNumber, partNumber, totalParts, serviceNote) {
        // Если есть служебная записка - склеиваем КМ + "_" + часть (из СЗ)
        if (serviceNote) {
            return `${kmNumber}_${partNumber}`;
        }

        // Иначе используем старую логику с подчеркиванием для многочастных актов без СЗ
        if (totalParts > 1) {
            return `${kmNumber}_${partNumber}`;
        }

        return kmNumber;
    }

    /**
     * Форматирует дату в формате DD.MM.YYYY
     * @private
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
     * Клонирует template элемент
     * @private
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
     */
    static _fillFields(element, data) {
        element.querySelectorAll('[data-field]').forEach(field => {
            const fieldName = field.getAttribute('data-field');
            if (Object.prototype.hasOwnProperty.call(data, fieldName)) {
                field.textContent = data[fieldName];
            }
        });
    }

    /**
     * Загружает список актов из API (всегда свежие данные)
     */
    static async loadActs() {
        const container = document.getElementById('actsListContainer');
        if (!container) return;

        // Показываем загрузку
        this._showLoading(container);

        try {
            const username = AuthManager.getCurrentUser();

            if (!username) {
                throw new Error('Пользователь не авторизован');
            }

            const response = await fetch('/api/v1/acts/list', {
                headers: {'X-JupyterHub-User': username}
            });

            if (!response.ok) {
                throw new Error('Ошибка загрузки списка актов');
            }

            const acts = await response.json();

            if (!acts.length) {
                this._showEmptyState(container);
                return;
            }

            this._renderActsGrid(acts, container);

        } catch (error) {
            console.error('Ошибка загрузки актов:', error);
            this._showErrorState(container);
            Notifications.error('Ошибка загрузки списка актов');
        }
    }

    /**
     * Показывает индикатор загрузки
     * @private
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
     */
    static _showErrorState(container) {
        const errorState = this._cloneTemplate('actsErrorStateTemplate');
        if (errorState) {
            container.innerHTML = '';
            container.appendChild(errorState);
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
            if (card) {
                grid.appendChild(card);
            }
        });

        container.innerHTML = '';
        container.appendChild(grid);
    }

    /**
     * Создает карточку акта из template
     * @private
     */
    static _createActCard(act) {
        const cardFragment = this._cloneTemplate('actCardTemplate');
        if (!cardFragment) return null;

        const cardElement = cardFragment.querySelector('.act-card');
        if (!cardElement) return null;

        // Подготавливаем данные для заполнения
        const data = {
            inspection_name: act.inspection_name,
            user_role: act.user_role,
            km_display: this._formatKmNumber(
                act.km_number,
                act.part_number || 1,
                act.total_parts || 1,
                act.service_note
            ),
            order_number: act.order_number,
            inspection_start_date: this._formatDate(act.inspection_start_date),
            inspection_end_date: this._formatDate(act.inspection_end_date),
            last_edited_at: this._formatDateTime(act.last_edited_at)
        };

        // Заполняем поля
        this._fillFields(cardFragment, data);

        // Привязываем обработчики к кнопкам
        const openBtn = cardElement.querySelector('[data-action="open"]');
        const editBtn = cardElement.querySelector('[data-action="edit"]');
        const duplicateBtn = cardElement.querySelector('[data-action="duplicate"]');
        const deleteBtn = cardElement.querySelector('[data-action="delete"]');

        if (openBtn) {
            openBtn.addEventListener('click', () => this.openAct(act.id));
        }

        if (editBtn) {
            editBtn.addEventListener('click', () => this.editAct(act.id));
        }

        if (duplicateBtn) {
            duplicateBtn.addEventListener('click', () => this.duplicateAct(act.id, act.inspection_name));
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.deleteAct(act.id, act.inspection_name));
        }

        return cardFragment;
    }

    /**
     * Открывает акт в конструкторе
     */
    static openAct(actId) {
        window.location.href = `/constructor?act_id=${actId}`;
    }

    /**
     * Открывает диалог редактирования акта
     */
    static async editAct(actId) {
        try {
            const username = AuthManager.getCurrentUser();

            if (!username) {
                throw new Error('Пользователь не авторизован');
            }

            const response = await fetch(`/api/v1/acts/${actId}`, {
                headers: {'X-JupyterHub-User': username}
            });

            if (!response.ok) {
                if (response.status === 403) {
                    throw new Error('Нет доступа к акту');
                } else if (response.status === 404) {
                    throw new Error('Акт не найден');
                }
                throw new Error('Ошибка загрузки акта');
            }

            const actData = await response.json();

            if (window.CreateActDialog && typeof window.CreateActDialog.showEdit === 'function') {
                window.CreateActDialog.showEdit(actData);
            } else {
                console.error('CreateActDialog не найден');
                Notifications.error('Ошибка открытия диалога редактирования');
            }

        } catch (error) {
            console.error('Ошибка загрузки акта для редактирования:', error);
            Notifications.error(`Не удалось загрузить акт: ${error.message}`);
        }
    }

    /**
     * Дублирует акт с подтверждением
     */
    static async duplicateAct(actId, actName) {
        const confirmed = await DialogManager.show({
            title: 'Дублирование акта',
            message: `Будет создана копия акта "${actName}". Продолжить?`,
            icon: '📋',
            confirmText: 'Создать копию',
            cancelText: 'Отмена'
        });

        if (!confirmed) return;

        try {
            const username = AuthManager.getCurrentUser();

            if (!username) {
                throw new Error('Пользователь не авторизован');
            }

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
                // Обновляем список
                await this.loadActs();
            }

        } catch (error) {
            console.error('Ошибка дублирования акта:', error);
            Notifications.error(`Не удалось создать копию: ${error.message}`);
        }
    }

    /**
     * Удаляет акт с подтверждением
     */
    static async deleteAct(actId, actName) {
        const confirmed = await DialogManager.show({
            title: 'Удаление акта',
            message: `Вы уверены, что хотите удалить акт "${actName}"? Это действие необратимо и удалит все данные акта.`,
            icon: '🗑️',
            confirmText: 'Удалить',
            cancelText: 'Отмена'
        });

        if (!confirmed) return;

        try {
            const username = AuthManager.getCurrentUser();

            if (!username) {
                throw new Error('Пользователь не авторизован');
            }

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

            // Обновляем список
            await this.loadActs();

        } catch (error) {
            console.error('Ошибка удаления акта:', error);
            Notifications.error(`Не удалось удалить акт: ${error.message}`);
        }
    }

    /**
     * Инициализация страницы
     */
    static async init() {
        console.log('ActsManagerPage.init() вызван');

        // ВАЖНО: Сначала выполняем отложенные действия от LockManager
        if (typeof LockManager !== 'undefined' && LockManager.executePendingActions) {
            console.log('Вызываем LockManager.executePendingActions()');
            await LockManager.executePendingActions();
            console.log('LockManager.executePendingActions() завершен');
        } else {
            console.log('LockManager или executePendingActions не найден');
        }

        // Проверяем флаги из sessionStorage
        await this._checkSessionExit();

        // Загружаем акты (всегда из БД)
        this.loadActs();

        const createBtn = document.getElementById('createNewActBtn');
        if (createBtn) {
            createBtn.addEventListener('click', () => {
                if (window.CreateActDialog && typeof window.CreateActDialog.show === 'function') {
                    window.CreateActDialog.show();
                } else {
                    console.error('CreateActDialog не найден');
                    Notifications.error('Ошибка открытия диалога создания акта');
                }
            });
        }

        const refreshBtn = document.getElementById('refreshActsBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.loadActs();
            });
        }
    }

    /**
     * Проверяет флаги завершения сессии и показывает соответствующий диалог
     * @private
     */
    static async _checkSessionExit() {
        const autoExited = sessionStorage.getItem('sessionAutoExited');
        const exitedWithSave = sessionStorage.getItem('sessionExitedWithSave');

        if (autoExited) {
            sessionStorage.removeItem('sessionAutoExited');

            await DialogManager.alert({
                title: 'Сессия завершена',
                message: 'Редактирование было автоматически прекращено из-за длительного бездействия. Изменения сохранены.',
                icon: '⏱️',
                type: 'info',
                confirmText: 'Понятно'
            });
        } else if (exitedWithSave) {
            sessionStorage.removeItem('sessionExitedWithSave');

            await DialogManager.alert({
                title: 'Данные сохранены',
                message: 'Редактирование завершено. Все изменения сохранены.',
                icon: '✅',
                type: 'success',
                confirmText: 'OK'
            });
        }
    }
}

window.ActsManagerPage = ActsManagerPage;
