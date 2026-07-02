/**
 * Контроллер страницы ЦК Фин.Рез.
 * Связывает generic-тулкит таблицы (datatable) с конфигом и API домена.
 */
import { CkFinResConfig } from './ck-fin-res-config.js';
import { APIClient } from '../../shared/api.js';
import { CkForm } from '../../shared/ck/ck-form.js';
import { CkProcessPicker } from '../../shared/ck/ck-process-picker.js';
import { DataTable } from '../../shared/datatable/data-table.js';
import { DataSource } from '../../shared/datatable/data-source.js';
import { TableViewState } from '../../shared/datatable/table-view-state.js';
import { ColumnVisibility } from '../../shared/datatable/column-visibility.js';
import { DialogManager } from '../../shared/dialog/dialog-confirm.js';
import { Notifications } from '../../shared/notifications.js';

export class CkFinResPage {
    static _dictionaries = {};

    static async init() {
        try {
            await this._loadDictionaries();
            this._initComponents();
            await this._loadData();
        } catch (error) {
            console.error('CkFinResPage init error:', error);
            Notifications.error('Ошибка загрузки страницы: ' + error.message);
        }
    }

    static async _loadDictionaries() {
        const cfg = CkFinResConfig;
        const results = await Promise.all(
            cfg.dictNames.map(name => APIClient.getCkDictionary(cfg.apiPrefix, name))
        );
        cfg.dictNames.forEach((name, i) => {
            this._dictionaries[name] = results[i];
        });
    }

    static _initComponents() {
        const cfg = CkFinResConfig;
        const columns = cfg.columns;

        // Состояние представления (видимость/ширины) с persist в localStorage
        this._viewState = new TableViewState({
            storageKey: cfg.storageKey,
            columns,
            storage: window.localStorage,
        });

        // Адаптивный источник данных (client/server по факту полноты загрузки)
        this._dataSource = new DataSource({
            pageSize: 50,
            workingSetCap: cfg.workingSetCap,
            fetchPage: ({ filters, sort, limit, offset }) =>
                APIClient.searchCkRecordsPage(cfg.apiPrefix, {
                    filters: filters || {},
                    sort: (sort || []).map(s => ({ by: s.key, dir: s.dir })),
                    limit,
                    offset,
                }),
        });

        // Таблица
        this._dataTable = new DataTable({
            mountEl: document.getElementById('ckTablePanel'),
            footerEl: document.getElementById('ckPaginationContainer'),
            columns,
            viewState: this._viewState,
            dataSource: this._dataSource,
            dicts: this._dictionaries,
            pageSize: 50,
            onRowSelect: (record) => this._onRowSelect(record),
        });

        // Панель видимости колонок (кнопка ⚙ в тулбаре)
        const colvisBtn = document.getElementById('ckColvisBtn');
        if (colvisBtn) {
            ColumnVisibility.mount({
                anchorEl: colvisBtn,
                columns,
                viewState: this._viewState,
                onChange: () => this._dataTable.refresh(),
            });
        }

        // Форма
        CkForm.init({
            fields: cfg.fields,
            dictionaries: this._dictionaries,
            containerEl: document.getElementById('ckFormPanel'),
            onProcessPick: (field) => this._openProcessPicker(field),
            sectionStateKey: cfg.sectionStateKey,
        });

        // Toolbar кнопки
        const addBtn = document.getElementById('ckAddRecordBtn');
        if (addBtn) addBtn.addEventListener('click', () => this._onAddRecord());

        const resetBtn = document.getElementById('ckResetFiltersBtn');
        if (resetBtn) resetBtn.addEventListener('click', () => this._onResetFilters());

        // Footer кнопки
        const saveBtn = document.getElementById('ckSaveBtn');
        if (saveBtn) saveBtn.addEventListener('click', () => this._onSave());

        const deleteBtn = document.getElementById('ckDeleteBtn');
        if (deleteBtn) deleteBtn.addEventListener('click', () => this._onDelete());
    }

    static async _loadData() {
        try {
            await this._dataSource.init();
            await this._dataTable.render();
        } catch (error) {
            Notifications.error('Ошибка загрузки данных: ' + error.message);
        }
    }

    static _onRowSelect(record) {
        CkForm.fill(record);
        this._updateSubheader(record);
    }

    static _onAddRecord() {
        this._dataTable.clearSelection();
        CkForm.clear();
        this._updateSubheader(null);
    }

    static _onResetFilters() {
        this._dataTable.clearFilters();
    }

    static async _onSave() {
        // В пустом режиме сохранять нечего — выходим до валидации,
        // API-вызова и перезагрузки данных.
        if (CkForm.getMode() === 'empty') return;

        const { valid, errors } = CkForm.validate();
        if (!valid) {
            const names = errors.map(e => e.label).join(', ');
            Notifications.error(`Заполните обязательные поля: ${names}`);
            return;
        }

        const data = CkForm.collectData();
        const mode = CkForm.getMode();

        try {
            if (mode === 'create') {
                await APIClient.createCkRecord(CkFinResConfig.apiPrefix, data);
                Notifications.success('Запись создана');
            } else if (mode === 'edit') {
                const record = CkForm.getCurrentRecord();
                await APIClient.updateCkRecords(CkFinResConfig.apiPrefix, [{ ...record, ...data }]);
                Notifications.success('Запись обновлена');
            }
            await this._loadData();
            CkForm.renderEmpty();
            this._updateSubheader(null);
        } catch (error) {
            Notifications.error('Ошибка сохранения: ' + error.message);
        }
    }

    static async _onDelete() {
        const record = CkForm.getCurrentRecord();
        if (!record) return;

        const confirmed = await DialogManager.show({
            title: 'Удалить запись?',
            message: `Запись #${record.id} будет удалена.`,
            type: 'warning',
        });
        if (!confirmed) return;

        try {
            await APIClient.deleteCkRecord(CkFinResConfig.apiPrefix, record.id);
            Notifications.success('Запись удалена');
            await this._loadData();
            CkForm.renderEmpty();
            this._updateSubheader(null);
        } catch (error) {
            Notifications.error('Ошибка удаления: ' + error.message);
        }
    }

    static _openProcessPicker(field) {
        const processes = this._dictionaries.processes || [];
        CkProcessPicker.show(processes, (selected) => {
            CkForm.setProcessValue(field.key, selected.process_number, selected.process_name, selected);
        });
    }

    static _updateSubheader(record) {
        const titleEl = document.getElementById('ckRecordTitle');
        const metaEl = document.getElementById('ckRecordMeta');
        if (!titleEl || !metaEl) return;

        if (record) {
            titleEl.textContent = `Запись #${record.id}`;
            const date = record.updated_at || record.created_at;
            const author = record.updated_by || record.created_by || '';
            metaEl.textContent = date
                ? `Изменено: ${CkFinResConfig.formatDate(date)} · Автор: ${author}`
                : '';
        } else if (CkForm.getMode() === 'create') {
            titleEl.textContent = 'Новая запись';
            metaEl.textContent = '';
        } else {
            titleEl.textContent = '';
            metaEl.textContent = '';
        }
    }
}

window.CkFinResPage = CkFinResPage;
