/**
 * Контроллер страницы ЦК Фин.Рез.
 * Связывает shared-компоненты с конфигом и API.
 */
class CkFinResPage {
    static _dictionaries = {};
    static _records = [];

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

        // Таблица
        CkTable.init({
            columns: cfg.columns,
            tableEl: document.getElementById('ckTablePanel'),
            dictionaries: this._dictionaries,
            onRowSelect: (record) => this._onRowSelect(record),
        });

        // Пагинация
        CkPagination.init({
            containerEl: document.getElementById('ckPaginationContainer'),
            pageSize: 50,
            onChange: () => this._onPageChange(),
        });

        // Форма
        CkForm.init({
            fields: cfg.fields,
            dictionaries: this._dictionaries,
            containerEl: document.getElementById('ckFormPanel'),
            onProcessPick: (field) => this._openProcessPicker(field),
        });

        // Поиск
        const searchInput = document.getElementById('ckSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                CkTable.filterLocal(searchInput.value);
            });
        }

        // Toolbar кнопки
        const addBtn = document.getElementById('ckAddRecordBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this._onAddRecord());
        }

        const resetBtn = document.getElementById('ckResetFiltersBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this._onResetFilters());
        }

        // Footer кнопки
        const saveBtn = document.getElementById('ckSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this._onSave());
        }

        const deleteBtn = document.getElementById('ckDeleteBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this._onDelete());
        }
    }

    static async _loadData() {
        try {
            const records = await APIClient.searchCkRecords(CkFinResConfig.apiPrefix, {});
            this._records = records;
            CkTable.setData(records);
            CkPagination.setTotal(records.length);
        } catch (error) {
            Notifications.error('Ошибка загрузки данных: ' + error.message);
        }
    }

    static _onRowSelect(record) {
        CkForm.fill(record);
        this._updateSubheader(record);
    }

    static _onAddRecord() {
        CkTable.clearSelection();
        CkForm.clear();
        this._updateSubheader(null);
    }

    static _onResetFilters() {
        const searchInput = document.getElementById('ckSearchInput');
        if (searchInput) searchInput.value = '';
        CkTable.filterLocal('');
        CkPagination.reset();
    }

    static async _onSave() {
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
                await APIClient.updateCkRecords(CkFinResConfig.apiPrefix, [{ id: record.id, ...data }]);
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

        const confirmed = await new Promise(resolve => {
            DialogManager.confirm(
                'Удалить запись?',
                `Запись #${record.id} будет удалена.`,
                () => resolve(true),
                () => resolve(false)
            );
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
            CkForm.setProcessValue(field.key, selected.process_number, selected.process_name);
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
