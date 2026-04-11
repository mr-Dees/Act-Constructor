/**
 * Менеджер меню выбора актов
 *
 * Управляет отображением списка актов пользователя и переключением между ними.
 * Интегрирован с БД через API. Отвечает за автозагрузку акта при входе в конструктор.
 */

class ActsMenuManager {
    static currentActId = null;
    static selectedActId = null;
    static _initialLoadInProgress = false;
    static _clickTimer = null;
    static _clickDelay = 300;
    static _cacheKey = 'acts_menu_cache';
    static _cacheExpiry = 1 * 60 * 1000;

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

    static show() {
        const menu = document.getElementById('actsMenuDropdown');
        const btn = document.getElementById('actsMenuBtn');
        if (menu) {
            menu.classList.remove('hidden');
            if (btn) btn.classList.add('active');
            this.renderActsList();
        }
    }

    static hide() {
        const menu = document.getElementById('actsMenuDropdown');
        const btn = document.getElementById('actsMenuBtn');
        if (menu) menu.classList.add('hidden');
        if (btn) btn.classList.remove('active');
    }

    static toggle() {
        const menu = document.getElementById('actsMenuDropdown');
        if (menu && menu.classList.contains('hidden')) this.show();
        else this.hide();
    }

    static _loadFromCache() {
        try {
            const cached = localStorage.getItem(this._cacheKey);
            if (!cached) return null;
            const parsed = JSON.parse(cached);
            const now = Date.now();
            if (now - parsed.timestamp > this._cacheExpiry) {
                this._clearCache();
                return null;
            }
            return parsed.acts;
        } catch (error) {
            console.error('Ошибка чтения кеша актов меню:', error);
            this._clearCache();
            return null;
        }
    }

    static _saveToCache(acts) {
        try {
            const cacheData = {
                acts,
                timestamp: Date.now()
            };
            localStorage.setItem(this._cacheKey, JSON.stringify(cacheData));
        } catch (error) {
            console.error('Ошибка сохранения кеша актов меню:', error);
        }
    }

    static _clearCache() {
        try {
            localStorage.removeItem(this._cacheKey);
        } catch (error) {
            console.error('Ошибка очистки кеша актов меню:', error);
        }
    }

    static async fetchActsList(forceRefresh = false) {
        if (!forceRefresh) {
            const cached = this._loadFromCache();
            if (cached) {
                console.log('Загружено из кеша (меню):', cached.length, 'актов');
                return cached;
            }
        }

        const username = AuthManager.getCurrentUser();
        if (!username) throw new Error('Пользователь не авторизован');

        const response = await fetch(AppConfig.api.getUrl('/api/v1/acts/list'), {
            headers: {'X-JupyterHub-User': username}
        });
        if (!response.ok) throw new Error('Ошибка загрузки списка актов');

        const acts = await response.json();
        this._saveToCache(acts);
        return acts;
    }

    static _formatDate(date) {
        if (!date) return '—';
        try {
            const d = new Date(date);
            if (isNaN(d.getTime())) return '—';
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}.${month}.${year}`;
        } catch {
            return '—';
        }
    }

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
        } catch {
            return 'Не редактировался';
        }
    }

    static _cloneTemplate(templateId) {
        const template = document.getElementById(templateId);
        if (!template) {
            console.error(`Template ${templateId} не найден`);
            return null;
        }
        return template.content.cloneNode(true);
    }

    static _fillFields(element, data) {
        element.querySelectorAll('[data-field]').forEach(field => {
            const key = field.getAttribute('data-field');
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                field.textContent = data[key];
            }
        });
    }

    static async renderActsList(forceRefresh = false) {
        const listContainer = document.getElementById('actsList');
        if (!listContainer) return;
        this._showLoading(listContainer);

        try {
            const acts = await this.fetchActsList(forceRefresh);
            if (!acts.length) {
                this._showEmptyState(listContainer);
                return;
            }

            const currentAct = acts.find(a => a.id === this.currentActId);
            const otherActs = acts.filter(a => a.id !== this.currentActId);
            listContainer.innerHTML = '';

            if (currentAct) {
                const section = document.createElement('div');
                section.className = 'acts-list-current-section';
                const label = document.createElement('div');
                label.className = 'acts-list-current-label';
                label.textContent = 'Текущий акт';
                section.appendChild(label);
                section.appendChild(this._createActListItem(currentAct, true));
                listContainer.appendChild(section);
            }

            if (otherActs.length > 0) {
                const section = document.createElement('div');
                section.className = 'acts-list-other-section';
                const label = document.createElement('div');
                label.className = 'acts-list-other-label';
                label.textContent = 'Другие акты';
                section.appendChild(label);
                otherActs.forEach(act =>
                    section.appendChild(this._createActListItem(act, false))
                );
                listContainer.appendChild(section);
            }
        } catch (err) {
            console.error('Ошибка загрузки актов:', err);
            this._showErrorState(listContainer);
            if (typeof Notifications !== 'undefined')
                Notifications.error('Ошибка загрузки списка актов');
        }
    }

    static _formatKmDisplay(km, part, total, serviceNote) {
        if (serviceNote) return `${km}_${part}`;
        if (total > 1) return `${km}_${part}`;
        return km;
    }

    static _createActListItem(act, isCurrent) {
        const item = this._cloneTemplate('actsMenuItemTemplate');
        if (!item) return document.createElement('li');
        const lastEdited = this._formatDateTime(act.last_edited_at);
        const start = this._formatDate(act.inspection_start_date);
        const end = this._formatDate(act.inspection_end_date);
        const data = {
            inspection_name: act.inspection_name,
            user_role: act.user_role,
            km_display: this._formatKmDisplay(
                act.km_number,
                act.part_number,
                act.total_parts,
                act.service_note
            ),
            order_number: act.order_number,
            inspection_start_date: start,
            inspection_end_date: end,
            last_edited_at: lastEdited
        };
        this._fillFields(item, data);

        const li = item.querySelector('.acts-menu-list-item');
        if (li) {
            li.dataset.actId = act.id;
            if (isCurrent) li.classList.add('current');
            if (act.is_locked && !isCurrent) {
                li.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    Notifications?.warning(
                        `Акт редактируется пользователем ${act.locked_by}.`
                    );
                });
            } else {
                li.addEventListener('click', e => this._handleActClick(e, act.id));
            }
        }
        return item;
    }

    static _showLoading(c) {
        const l = this._cloneTemplate('actsLoadingTemplate');
        if (l) {
            c.innerHTML = '';
            c.appendChild(l);
        }
    }

    static _showEmptyState(c) {
        const e = this._cloneTemplate('actsEmptyStateTemplate');
        if (e) {
            c.innerHTML = '';
            c.appendChild(e);
        }
    }

    static _showErrorState(c) {
        const e = this._cloneTemplate('actsErrorStateTemplate');
        if (e) {
            c.innerHTML = '';
            c.appendChild(e);
        }
    }

    static _handleActClick(e, actId) {
        e.preventDefault();
        e.stopPropagation();
        if (this._clickTimer !== null) {
            clearTimeout(this._clickTimer);
            this._clickTimer = null;
            this._switchToAct(actId);
            return;
        }
        this._clickTimer = setTimeout(() => {
            this._clickTimer = null;
        }, this._clickDelay);
    }

    /**
     * Переключается на другой акт
     * @private
     * @param {number} actId - ID акта для переключения
     */
    static async _switchToAct(actId) {
        if (actId === this.currentActId) {
            this.hide();
            return;
        }

        if (StorageManager.hasUnsyncedChanges() && window.currentActId) {
            this.hide();
            const confirmed = await DialogManager.show({
                title: 'Несохраненные изменения',
                message:
                    'У вас есть несохраненные изменения в текущем акте. Сохранить перед переключением?',
                icon: '⚠️',
                confirmText: 'Сохранить и переключить',
                cancelText: 'Переключить без сохранения'
            });
            if (confirmed) {
                try {
                    ItemsRenderer?.syncDataToState();
                    await APIClient.saveActContent(window.currentActId, { saveType: 'manual' });
                    Notifications.success('Изменения сохранены');
                } catch (err) {
                    console.error('Ошибка сохранения:', err);
                    Notifications.error('Не удалось сохранить изменения');
                    return;
                }
            }
        } else {
            this.hide();
        }

        try {
            console.log('Переключаемся на акт:', actId);
            if (window.currentActId && typeof LockManager !== 'undefined') {
                try {
                    await APIClient.unlockAct(window.currentActId);
                    LockManager.destroy();
                } catch (err) {
                    console.warn('Не удалось снять блокировку:', err);
                }
            }

            if (typeof LockManager !== 'undefined' && LockManager.init) {
                try {
                    await LockManager.init(actId);
                } catch (lockError) {
                    if (lockError.message === 'ACT_LOCKED') {
                        console.log('Акт занят другим пользователем');
                        return;
                    }
                    throw lockError;
                }
            }

            await APIClient.loadActContent(actId);

            // Сохраняем дефолтную структуру после блокировки (для новых актов)
            if (APIClient._pendingDefaultStructureSave) {
                APIClient._pendingDefaultStructureSave = false;
                const username = AuthManager?.getCurrentUser?.() || null;
                if (username) {
                    await APIClient._saveDefaultStructure(actId, username);
                }
            }

            this.currentActId = actId;
            window.currentActId = actId;
            if (typeof ChangelogTracker !== 'undefined') ChangelogTracker.init(actId);
            window.history.pushState({actId}, '', AppConfig.api.getUrl(`/constructor?act_id=${actId}`));
            StorageManager.markAsSyncedWithDB();
            this._clearCache();
            Notifications.success('Акт успешно загружен');
        } catch (error) {
            console.error('Ошибка переключения на акт:', error);
            if (error.message === 'ACT_LOCKED') return;
            Notifications.error('Не удалось загрузить акт');
            if (window.currentActId && LockManager.init) {
                try {
                    await LockManager.init(window.currentActId);
                } catch {
                    this._redirectToActsManager();
                }
            } else this._redirectToActsManager();
        }
    }

    /**
     * Применяет ограничения для read-only режима к кнопкам меню.
     * Вызывается после загрузки контента акта.
     */
    static applyReadOnlyRestrictions() {
        if (!AppConfig.readOnlyMode?.isReadOnly) return;

        const editBtn = document.getElementById('editMetadataBtn');
        const deleteBtn = document.getElementById('deleteActBtn');
        const tooltip = 'Недоступно для роли "Участник"';

        if (editBtn) {
            editBtn.disabled = true;
            editBtn.classList.add('disabled');
            editBtn.title = tooltip;
        }

        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.classList.add('disabled');
            deleteBtn.title = tooltip;
        }

        console.log('ActsMenuManager: применены ограничения read-only для кнопок меню');
    }

    static async showEditMetadataDialog() {
        // Проверка read-only режима
        if (AppConfig.readOnlyMode?.isReadOnly) {
            Notifications.warning('Редактирование метаданных недоступно для роли "Участник"');
            return;
        }

        const actId = this.currentActId; // Теперь ВСЕГДА текущий акт
        if (!actId) {
            Notifications.warning('Нет открытого акта');
            return;
        }

        try {
            const username = AuthManager.getCurrentUser();
            const response = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${actId}`), {
                headers: {'X-JupyterHub-User': username}
            });
            if (!response.ok) throw new Error('Ошибка загрузки данных акта');
            const actData = await response.json();
            this.hide();

            // Вычисляем статус для подсветки незаполненных полей
            const hasValidationIssues = actData.needs_created_date || actData.needs_directive_number || actData.needs_service_note;
            const needsInvoice = actData.needs_invoice_check;
            const status = (hasValidationIssues || needsInvoice)
                ? { needsHighlight: true, isCritical: !!needsInvoice }
                : null;

            CreateActDialog.showEdit(actData, status);
        } catch (err) {
            console.error('Ошибка загрузки данных акта:', err);
            Notifications.error('Не удалось загрузить данные акта');
        }
    }

    static async duplicateCurrentAct() {
        const actId = this.currentActId; // Теперь ВСЕГДА текущий акт
        if (!actId) {
            Notifications.warning('Нет открытого акта');
            return;
        }

        this.hide();
        const confirmed = await DialogManager.show({
            title: 'Дублирование акта',
            message: 'Будет создана копия текущего акта. Продолжить?',
            icon: '📋',
            confirmText: 'Создать копию',
            cancelText: 'Отмена'
        });
        if (!confirmed) return;

        try {
            const username = AuthManager.getCurrentUser();
            const response = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${actId}/duplicate`), {
                method: 'POST',
                headers: {'X-JupyterHub-User': username}
            });
            if (!response.ok) {
                let error;
                try {
                    error = await response.json();
                } catch {
                    error = {};
                }
                throw new Error(error.detail || 'Ошибка дублирования');
            }
            const newAct = await response.json();
            this._clearCache();
            Notifications.success(`Копия создана: ${newAct.inspection_name}`);

            const openNewAct = await DialogManager.show({
                title: 'Копия создана',
                message: 'Хотите открыть новый акт сейчас?',
                icon: '✅',
                confirmText: 'Открыть',
                cancelText: 'Остаться здесь'
            });

            if (openNewAct) {
                window.location.href = AppConfig.api.getUrl(`/constructor?act_id=${newAct.id}`);
            }
        } catch (err) {
            console.error('Ошибка дублирования акта:', err);
            Notifications.error(`Не удалось создать копию: ${err.message}`);
        }
    }

    static async deleteCurrentAct() {
        // Проверка read-only режима
        if (AppConfig.readOnlyMode?.isReadOnly) {
            Notifications.warning('Удаление недоступно для роли "Участник"');
            return;
        }

        const actId = this.currentActId; // Теперь ВСЕГДА текущий акт
        if (!actId) {
            Notifications.warning('Нет открытого акта');
            return;
        }

        this.hide();
        const confirmed = await DialogManager.show({
            title: 'Удаление акта',
            message:
                'Вы уверены, что хотите удалить текущий акт? Это действие необратимо.',
            icon: '🗑️',
            confirmText: 'Удалить',
            cancelText: 'Отмена'
        });
        if (!confirmed) return;

        try {
            await APIClient.deleteAct(actId);
            this._clearCache();
            StorageManager.clearStorage();
            this._redirectToActsManager();
        } catch (err) {
            console.error('Ошибка удаления акта:', err);
            Notifications.error(`Не удалось удалить акт: ${err.message}`);
        }
    }

    static _redirectToActsManager() {
        setTimeout(() => (window.location.href = AppConfig.api.getUrl('/acts')), 1500);
    }

    static async _autoLoadAct(actId) {
        if (this._initialLoadInProgress) return;
        this._initialLoadInProgress = true;
        this.currentActId = actId;
        window.currentActId = actId;
        if (typeof ChangelogTracker !== 'undefined') ChangelogTracker.init(actId);

        try {
            // Сначала загружаем контент - это установит readOnlyMode на основе прав пользователя
            await APIClient.loadActContent(actId);

            // Инициализируем LockManager только после загрузки контента
            // В режиме read-only блокировка будет пропущена
            if (LockManager?.init) await LockManager.init(actId);

            // Сохраняем дефолтную структуру ПОСЛЕ блокировки (для новых актов)
            if (APIClient._pendingDefaultStructureSave) {
                APIClient._pendingDefaultStructureSave = false;
                const username = AuthManager?.getCurrentUser?.() || null;
                if (username) {
                    await APIClient._saveDefaultStructure(actId, username);
                }
            }

            Notifications.success('Акт загружен');
        } catch (error) {
            console.error('Ошибка загрузки акта:', error);
            this._redirectToActsManager();
        } finally {
            this._initialLoadInProgress = false;
        }
    }

    static init() {
        const menuBtn = document.getElementById('actsMenuBtn');
        const closeBtn = document.getElementById('closeActsMenuBtn');
        const createBtn = document.getElementById('createNewActBtn');
        const editBtn = document.getElementById('editMetadataBtn');
        const duplicateBtn = document.getElementById('duplicateActBtn');
        const deleteBtn = document.getElementById('deleteActBtn');

        this._setupEscapeHandler();

        menuBtn?.addEventListener('click', e => {
            e.stopPropagation();
            this.toggle();
        });
        closeBtn?.addEventListener('click', () => this.hide());
        createBtn?.addEventListener('click', () => {
            this.hide();
            CreateActDialog.show();
        });

        editBtn?.addEventListener('click', () => this.showEditMetadataDialog());
        duplicateBtn?.addEventListener('click', () => this.duplicateCurrentAct());
        deleteBtn?.addEventListener('click', () => this.deleteCurrentAct());

        document.addEventListener('click', e => {
            const menu = document.getElementById('actsMenuDropdown');
            if (menu && !menu.contains(e.target) && !menuBtn?.contains(e.target))
                this.hide();
        });
        const menu = document.getElementById('actsMenuDropdown');
        menu?.addEventListener('click', e => e.stopPropagation());

        window.addEventListener('popstate', async event => {
            const actId = event.state?.actId;
            if (actId) await APIClient.loadActContent(actId);
        });

        const param = new URLSearchParams(window.location.search).get('act_id');
        if (param) this._autoLoadAct(parseInt(param));
        else setTimeout(() => this.show(), 500);
    }
}

window.ActsMenuManager = ActsMenuManager;
document.addEventListener('DOMContentLoaded', () => ActsMenuManager.init());
