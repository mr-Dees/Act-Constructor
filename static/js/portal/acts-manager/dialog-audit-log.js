/**
 * Диалог аудит-лога и версий содержимого акта.
 *
 * Наследует DialogBase для стекирования, анимаций и Escape-обработки.
 * Доступен только для ролей Куратор и Руководитель.
 */
class AuditLogDialog extends DialogBase {
    static _actId = null;
    static _actName = null;
    static _overlay = null;
    static _logOffset = 0;
    static _versionsOffset = 0;
    static _pageSize = 20;
    static _cachedLog = null;
    static _cachedVersions = null;
    static _filteredLog = [];
    static _maxLoadLimit = 2000;
    static _lockAcquired = false;

    /**
     * Открывает диалог истории для акта.
     * @param {number} actId
     * @param {string} actName
     */
    static async show(actId, actName) {
        this._actId = actId;
        this._actName = actName;
        this._logOffset = 0;
        this._versionsOffset = 0;
        this._cachedLog = null;
        this._cachedVersions = null;
        this._filteredLog = [];
        this._lockAcquired = false;

        // Блокируем акт через LockManager (activity tracking, auto-extension, inactivity detection)
        if (typeof LockManager !== 'undefined') {
            try {
                await LockManager.init(actId);
                this._lockAcquired = true;
            } catch (err) {
                if (err.message === 'ACT_LOCKED' || err.message === 'LOCK_FAILED') {
                    return; // LockManager уже показал модал и перенаправил
                }
                console.error('Ошибка блокировки:', err);
            }
        }

        const fragment = this._cloneTemplate('auditLogDialogTemplate');
        if (!fragment) return;

        // Извлекаем overlay из фрагмента ДО вставки в DOM
        this._overlay = fragment.querySelector('.custom-dialog-overlay');
        if (!this._overlay) return;

        // Заголовок
        const title = this._overlay.querySelector('.dialog-title');
        if (title) title.textContent = `История: ${actName}`;

        const dialog = this._overlay.querySelector('.custom-dialog');

        // _showDialog сам добавит overlay в DOM
        this._showDialog(this._overlay);
        this._setupOverlayClickHandler(this._overlay, dialog, () => this._close());
        this._setupEscapeHandler(this._overlay, () => this._close());

        // Кнопка закрытия
        this._overlay.querySelector('[data-action="close"]')
            ?.addEventListener('click', () => this._close());

        // Вкладки
        this._overlay.querySelectorAll('.audit-log-tab').forEach(tab => {
            tab.addEventListener('click', () => this._switchTab(tab.dataset.tab));
        });

        // Фильтры
        this._initFilters();

        // Загружаем данные
        this._loadAllData();
    }

    // =========================================================================
    // ФИЛЬТРЫ
    // =========================================================================

    static _initFilters() {
        if (!this._overlay) return;

        const filters = this._overlay.querySelector('.audit-log-filters');
        if (!filters) return;

        // Клик по чипу — переключить индивидуально
        filters.querySelectorAll('.audit-log-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                this._updateGroupState(chip.closest('.audit-log-chip-group'));
                this._updateToggleButton();
                this._onFilterChange();
            });
        });

        // Клик по названию группы — переключить всю группу
        filters.querySelectorAll('.audit-log-group-label').forEach(label => {
            label.addEventListener('click', () => {
                const group = label.closest('.audit-log-chip-group');
                const chips = group.querySelectorAll('.audit-log-chip');
                const allActive = Array.from(chips).every(c => c.classList.contains('active'));
                chips.forEach(c => c.classList.toggle('active', !allActive));
                this._updateGroupState(group);
                this._updateToggleButton();
                this._onFilterChange();
            });
        });

        // «Снять все / Выбрать все»
        const toggleBtn = filters.querySelector('[data-action="toggle-all"]');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this._toggleAllFilters());
        }

        // Дата и пользователь
        filters.querySelectorAll('input[type="date"], input[type="text"]').forEach(input => {
            input.addEventListener('input', () => this._onFilterChange());
        });

        // Сворачивание/раскрытие фильтров
        const collapseBtn = filters.querySelector('[data-action="collapse-filters"]');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', () => {
                filters.classList.toggle('collapsed');
            });
        }
    }

    static _toggleAllFilters() {
        if (!this._overlay) return;
        const chips = this._overlay.querySelectorAll('.audit-log-chip');
        const allActive = Array.from(chips).every(c => c.classList.contains('active'));

        chips.forEach(c => c.classList.toggle('active', !allActive));

        // Обновляем состояния всех групп
        this._overlay.querySelectorAll('.audit-log-chip-group').forEach(g => this._updateGroupState(g));
        this._updateToggleButton();
        this._onFilterChange();
    }

    static _updateToggleButton() {
        if (!this._overlay) return;
        const btn = this._overlay.querySelector('[data-action="toggle-all"]');
        if (!btn) return;
        const chips = this._overlay.querySelectorAll('.audit-log-chip');
        const allActive = Array.from(chips).every(c => c.classList.contains('active'));
        btn.textContent = allActive ? 'Снять все' : 'Выбрать все';
    }

    static _updateGroupState(group) {
        if (!group) return;
        const chips = group.querySelectorAll('.audit-log-chip');
        const allInactive = Array.from(chips).every(c => !c.classList.contains('active'));
        group.classList.toggle('all-inactive', allInactive);
    }

    static _onFilterChange() {
        this._logOffset = 0;
        this._applyFiltersAndRender();
    }

    // =========================================================================
    // ВКЛАДКИ
    // =========================================================================

    static _switchTab(tabName) {
        if (!this._overlay) return;

        this._overlay.querySelectorAll('.audit-log-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabName);
        });
        this._overlay.querySelectorAll('.audit-log-tab-content').forEach(c => {
            c.classList.toggle('hidden', c.dataset.tabContent !== tabName);
        });

        if (tabName === 'versions') {
            if (!this._cachedVersions) this._loadAllVersions();
            else this._renderVersionsPage(this._versionsOffset);
        } else {
            this._applyFiltersAndRender();
        }
    }

    // =========================================================================
    // ЗАГРУЗКА ДАННЫХ
    // =========================================================================

    static async _loadAllData() {
        const list = this._overlay?.querySelector('#auditLogList');
        if (!list) return;

        list.innerHTML = '<div class="audit-log-loading">Загрузка...</div>';

        try {
            const data = await APIClient.getAuditLog(this._actId, {
                limit: this._maxLoadLimit,
                offset: 0,
            });
            this._cachedLog = data.items || [];

            if (data.total > this._maxLoadLimit) {
                Notifications.info(
                    `Загружено ${this._maxLoadLimit} из ${data.total} записей.`
                );
            }

            this._applyFiltersAndRender();
        } catch (err) {
            console.error('Ошибка загрузки аудит-лога:', err);
            list.innerHTML = '<div class="audit-log-error">Ошибка загрузки</div>';
        }
    }

    static _applyFiltersAndRender() {
        if (!this._cachedLog || !this._overlay) return;
        const list = this._overlay.querySelector('#auditLogList');
        if (!list) return;

        // Собираем активные типы действий
        const chips = this._overlay.querySelectorAll('.audit-log-chip');
        const activeActions = new Set();
        chips.forEach(c => {
            if (c.classList.contains('active')) {
                c.dataset.value.split(',').forEach(v => activeActions.add(v));
            }
        });

        // Пустое состояние при снятии всех фильтров
        if (activeActions.size === 0) {
            list.innerHTML = '<div class="audit-log-empty">Выберите хотя бы один тип операции</div>';
            this._clearPagination('auditLogPagination');
            return;
        }

        // Фильтрация по типу действия
        let filtered = this._cachedLog.filter(e => activeActions.has(e.action));

        // Фильтрация по имени пользователя (регистронезависимая подстрока)
        const username = this._overlay.querySelector('[data-filter="username"]')?.value?.trim();
        if (username) {
            const lower = username.toLowerCase();
            filtered = filtered.filter(e => e.username?.toLowerCase().includes(lower));
        }

        // Фильтрация по дате
        const fromDate = this._overlay.querySelector('[data-filter="from-date"]')?.value;
        const toDate = this._overlay.querySelector('[data-filter="to-date"]')?.value;
        if (fromDate) {
            const from = new Date(fromDate);
            filtered = filtered.filter(e => new Date(e.created_at) >= from);
        }
        if (toDate) {
            const to = new Date(toDate + 'T23:59:59');
            filtered = filtered.filter(e => new Date(e.created_at) <= to);
        }

        this._filteredLog = filtered;
        this._renderFilteredPage(0);
    }

    static _renderFilteredPage(offset) {
        this._logOffset = offset;
        const list = this._overlay?.querySelector('#auditLogList');
        if (!list) return;

        if (this._filteredLog.length === 0) {
            list.innerHTML = '<div class="audit-log-empty">Нет записей</div>';
            this._clearPagination('auditLogPagination');
            return;
        }

        const page = this._filteredLog.slice(offset, offset + this._pageSize);
        list.innerHTML = page.map(entry => this._renderEntry(entry)).join('');

        // Обработчики сворачивания changelog
        list.querySelectorAll('.audit-log-changelog-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.nextElementSibling;
                if (target) {
                    target.classList.toggle('hidden');
                    btn.textContent = target.classList.contains('hidden')
                        ? 'Показать подробности'
                        : 'Скрыть подробности';
                }
            });
        });

        this._renderPagination('auditLogPagination', this._filteredLog.length, offset,
            (o) => this._renderFilteredPage(o));
    }

    static async _loadAllVersions() {
        const list = this._overlay?.querySelector('#versionsList');
        if (!list) return;

        list.innerHTML = '<div class="audit-log-loading">Загрузка...</div>';

        try {
            const data = await APIClient.getVersions(this._actId, {
                limit: this._maxLoadLimit, offset: 0,
            });
            this._cachedVersions = data.items || [];
            this._renderVersionsPage(0);
        } catch (err) {
            console.error('Ошибка загрузки версий:', err);
            list.innerHTML = '<div class="audit-log-error">Ошибка загрузки</div>';
        }
    }

    static _renderVersionsPage(offset) {
        this._versionsOffset = offset;
        const list = this._overlay?.querySelector('#versionsList');
        if (!list) return;

        if (!this._cachedVersions?.length) {
            list.innerHTML = '<div class="audit-log-empty">Нет версий</div>';
            this._clearPagination('versionsPagination');
            return;
        }

        const page = this._cachedVersions.slice(offset, offset + this._pageSize);
        list.innerHTML = page.map(v => this._renderVersion(v)).join('');

        list.querySelectorAll('[data-action="view-version"]').forEach(btn => {
            btn.addEventListener('click', () => this._viewVersion(parseInt(btn.dataset.versionId)));
        });
        list.querySelectorAll('[data-action="restore-version"]').forEach(btn => {
            btn.addEventListener('click', () => this._restoreVersion(parseInt(btn.dataset.versionId), btn.dataset.versionNumber));
        });

        if (!this._lockAcquired) this._disableRestoreButtons();

        this._renderPagination('versionsPagination', this._cachedVersions.length, offset,
            (o) => this._renderVersionsPage(o));
    }

    // =========================================================================
    // ПРОСМОТР / ВОССТАНОВЛЕНИЕ ВЕРСИЙ
    // =========================================================================

    static async _viewVersion(versionId) {
        try {
            const version = await APIClient.getVersion(this._actId, versionId);
            if (typeof VersionPreviewOverlay !== 'undefined') {
                VersionPreviewOverlay.show(version, this._actName, this._actId);
            }
        } catch (err) {
            console.error('Ошибка загрузки версии:', err);
            Notifications.error('Не удалось загрузить версию');
        }
    }

    static async _restoreVersion(versionId, versionNumber) {
        if (!this._lockAcquired) {
            Notifications.warning('Восстановление невозможно: акт не заблокирован');
            return;
        }

        const confirmed = await DialogManager.show({
            title: 'Восстановление версии',
            message: `Восстановить содержимое из версии #${versionNumber}? Текущее содержимое будет заменено.`,
            icon: '⚠️',
            confirmText: 'Восстановить',
            cancelText: 'Отмена',
            type: 'warning',
        });
        if (!confirmed) return;

        try {
            const result = await APIClient.restoreVersion(this._actId, versionId);
            Notifications.success(result.message || 'Содержимое восстановлено');

            // Инвалидация кешей и перезагрузка
            this._cachedLog = null;
            this._cachedVersions = null;
            this._loadAllData();
            this._loadAllVersions();
        } catch (err) {
            console.error('Ошибка восстановления:', err);
            Notifications.error(err.status === 409
                ? 'Акт заблокирован другим пользователем'
                : `Ошибка: ${err.message}`);
        }
    }

    static _disableRestoreButtons() {
        if (!this._overlay) return;
        this._overlay.querySelectorAll('[data-action="restore-version"]').forEach(btn => {
            btn.disabled = true;
            btn.title = 'Для восстановления необходима блокировка акта';
        });
    }

    // =========================================================================
    // РЕНДЕРИНГ
    // =========================================================================

    static _renderEntry(entry) {
        const date = this._formatDate(entry.created_at);
        const action = this._formatAction(entry.action);
        const details = this._formatDetails(entry.action, entry.details);
        const changelog = this._renderChangelog(entry.changelog, entry.details?.field_changes);

        return `
            <div class="audit-log-entry">
                <div class="audit-log-entry-header">
                    <span class="audit-log-entry-action">${action}</span>
                    <span class="audit-log-entry-meta">${entry.username} &mdash; ${date}</span>
                </div>
                ${details ? `<div class="audit-log-entry-details">${details}</div>` : ''}
                ${changelog}
            </div>
        `;
    }

    static _renderChangelog(changelog, fieldChanges) {
        if ((!changelog || !Array.isArray(changelog) || changelog.length === 0) && !fieldChanges) return '';

        const opLabels = {
            add_node: 'Добавлен узел',
            delete_node: 'Удалён узел',
            move_node: 'Перемещён узел',
            rename_node: 'Переименован узел',
            add_table: 'Добавлена таблица',
            delete_table: 'Удалена таблица',
            modify_table: 'Изменена таблица',
            add_textblock: 'Добавлен текстовый блок',
            modify_textblock: 'Изменён текстовый блок',
            add_violation: 'Добавлено нарушение',
            modify_violation: 'Изменено нарушение',
        };

        const items = (changelog || []).map(e => {
            const label = opLabels[e.op] || e.op;
            const name = e.name ? `: ${this._escapeHtml(e.name)}` : '';
            let detail = '';

            // Если есть field-level детали для этого элемента
            if (fieldChanges && e.id && fieldChanges[e.id]) {
                detail = this._renderFieldChanges(fieldChanges[e.id]);
            }

            return `<li>${label}${name}${detail}</li>`;
        }).join('');

        return `
            <button class="audit-log-changelog-toggle">Показать подробности</button>
            <ul class="audit-log-changelog-list hidden">${items}</ul>
        `;
    }

    static _renderFieldChanges(changes) {
        if (!changes) return '';

        if (changes.type === 'table' && changes.cells?.length) {
            const cellItems = changes.cells.slice(0, 10).map(c => {
                const loc = c.col_name || `кол. ${c.col + 1}`;
                const old = c.old ? `<span class="field-old">${this._escapeHtml(c.old)}</span>` : '—';
                const newVal = c.new ? `<span class="field-new">${this._escapeHtml(c.new)}</span>` : '—';
                return `<li class="field-change-item">Строка ${c.row + 1}, ${this._escapeHtml(loc)}: ${old} → ${newVal}</li>`;
            }).join('');
            const more = changes.cells.length > 10
                ? `<li class="field-change-more">...и ещё ${changes.cells.length - 10}</li>`
                : '';
            return `<ul class="field-changes-list">${cellItems}${more}</ul>`;
        }

        if (changes.type === 'textblock') {
            return `<ul class="field-changes-list"><li class="field-change-item">Содержимое: ${changes.old_length} → ${changes.new_length} символов</li></ul>`;
        }

        if (changes.type === 'violation' && changes.fields) {
            const fieldLabels = {
                violated: 'Нарушено', established: 'Установлено',
                reasons: 'Причины', consequences: 'Последствия',
                responsible: 'Ответственные', recommendations: 'Рекомендации',
            };
            const items = Object.entries(changes.fields)
                .filter(([, v]) => v.changed)
                .map(([k]) => `<li class="field-change-item">Поле «${fieldLabels[k] || k}»: изменено</li>`)
                .join('');
            return items ? `<ul class="field-changes-list">${items}</ul>` : '';
        }

        return '';
    }

    static _renderVersion(v) {
        const date = this._formatDate(v.created_at);
        const saveType = this._formatSaveType(v.save_type);

        return `
            <div class="audit-log-entry">
                <div class="audit-log-entry-header">
                    <span class="audit-log-entry-action">Версия #${v.version_number}</span>
                    <span class="audit-log-entry-meta">${saveType} &mdash; ${v.username} &mdash; ${date}</span>
                </div>
                <div class="audit-log-entry-actions">
                    <button class="btn btn-sm btn-secondary" data-action="view-version" data-version-id="${v.id}">
                        Просмотр
                    </button>
                    <button class="btn btn-sm btn-primary" data-action="restore-version" data-version-id="${v.id}" data-version-number="${v.version_number}">
                        Восстановить
                    </button>
                </div>
            </div>
        `;
    }

    static _renderPagination(containerId, total, currentOffset, onNavigate) {
        const container = this._overlay?.querySelector(`#${containerId}`);
        if (!container) return;

        const totalPages = Math.ceil(total / this._pageSize);
        const currentPage = Math.floor(currentOffset / this._pageSize) + 1;

        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = '<div class="audit-log-pages">';
        if (currentPage > 1) {
            html += `<button class="btn btn-sm" data-page="${currentPage - 1}">&laquo;</button>`;
        }
        html += `<span class="audit-log-page-info">${currentPage} / ${totalPages} (${total})</span>`;
        if (currentPage < totalPages) {
            html += `<button class="btn btn-sm" data-page="${currentPage + 1}">&raquo;</button>`;
        }
        html += '</div>';

        container.innerHTML = html;
        container.querySelectorAll('[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                onNavigate((page - 1) * this._pageSize);
            });
        });
    }

    static _clearPagination(containerId) {
        const container = this._overlay?.querySelector(`#${containerId}`);
        if (container) container.innerHTML = '';
    }

    // =========================================================================
    // ФОРМАТИРОВАНИЕ
    // =========================================================================

    static _formatAction(action) {
        const map = {
            'create': 'Создание акта',
            'update': 'Обновление метаданных',
            'delete': 'Удаление акта',
            'duplicate': 'Дублирование акта',
            'lock': 'Блокировка',
            'unlock': 'Снятие блокировки',
            'content_save': 'Сохранение содержимого',
            'save_invoice': 'Сохранение фактуры',
            'export': 'Экспорт файла',
            'download': 'Скачивание файла',
            'restore': 'Восстановление версии',
        };
        return map[action] || action;
    }

    static _formatDetails(action, details) {
        if (!details || Object.keys(details).length === 0) return '';

        switch (action) {
            case 'update': {
                const parts = [];
                if (details.changes) {
                    for (const [field, vals] of Object.entries(details.changes)) {
                        parts.push(`<b>${field}</b>: ${vals.old || '—'} → ${vals.new || '—'}`);
                    }
                }
                if (details.audit_team_replaced) parts.push('Аудиторская группа обновлена');
                if (details.directives_replaced) parts.push('Поручения обновлены');
                return parts.join('<br>');
            }
            case 'content_save': {
                const parts = [];
                const st = this._formatSaveType(details.save_type);
                parts.push(`Тип: ${st}`);
                if (details.tree) {
                    const t = details.tree;
                    if (t.nodes_added) parts.push(`Узлов добавлено: ${t.nodes_added}`);
                    if (t.nodes_removed) parts.push(`Узлов удалено: ${t.nodes_removed}`);
                }
                for (const [key, label] of [['tables', 'Таблицы'], ['textblocks', 'Текстблоки'], ['violations', 'Нарушения']]) {
                    const t = details[key];
                    if (!t) continue;
                    const s = [];
                    if (t.added) s.push(`+${t.added}`);
                    if (t.removed) s.push(`-${t.removed}`);
                    if (t.existing) s.push(`=${t.existing}`);
                    if (s.length) {
                        let line = `${label}: ${s.join(', ')}`;
                        if (t.added_names?.length) line += ` (${t.added_names.join(', ')})`;
                        parts.push(line);
                    }
                }
                return parts.join('<br>');
            }
            case 'save_invoice':
                return `Узел: ${details.node_id || '—'}, БД: ${details.db_type || '—'}, Таблица: ${details.table_name || '—'}`;
            case 'export':
                return `Формат: ${details.format || '—'}, Файл: ${details.filename || '—'}`;
            case 'download':
                return `Файл: ${details.filename || '—'}`;
            case 'restore':
                return `Из версии #${details.from_version || '—'}`;
            case 'create':
                return `КМ: ${details.km_number || '—'}, Часть: ${details.part_number || '—'}`;
            case 'duplicate':
                return `Из акта #${details.source_act_id || '—'}`;
            default:
                return `<code>${this._escapeHtml(JSON.stringify(details))}</code>`;
        }
    }

    static _formatSaveType(saveType) {
        const map = { 'manual': 'Ручное', 'periodic': 'Периодическое', 'auto': 'Авто' };
        return map[saveType] || saveType;
    }

    static _formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    }

    static _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    static async _close() {
        if (this._lockAcquired && typeof LockManager !== 'undefined') {
            try {
                await LockManager.manualUnlock();
            } catch (err) {
                console.error('Ошибка разблокировки:', err);
            }
            this._lockAcquired = false;
        }

        if (this._overlay) {
            this._removeEscapeHandler(this._overlay);
            this._hideDialog(this._overlay);
            this._overlay = null;
        }
        this._cachedLog = null;
        this._cachedVersions = null;
        this._filteredLog = [];
    }
}

// Глобальный доступ
window.AuditLogDialog = AuditLogDialog;
