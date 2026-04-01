/**
 * Компонент таблицы записей ЦК.
 * Рендерит таблицу с горизонтальной прокруткой, сортировкой и выделением строк.
 */
class CkTable {
    static _config = null;
    static _data = [];
    static _filteredData = [];
    static _selectedId = null;
    static _sortField = null;
    static _sortDir = 'asc';
    static _filterQuery = '';
    static _debounceTimer = null;

    /**
     * @param {Object} config
     * @param {Array} config.columns - [{key, label, width?, align?, format?}]
     * @param {Function} config.onRowSelect - callback(record)
     * @param {HTMLElement} config.tableEl - контейнер для таблицы
     * @param {Object} config.dictionaries - справочники для format-функций
     */
    static init(config) {
        this._config = config;
        this._data = [];
        this._filteredData = [];
        this._selectedId = null;
        this._sortField = null;
        this._sortDir = 'asc';
        this._filterQuery = '';
        this._render();
    }

    static setData(records) {
        this._data = records || [];
        this._applyFilterAndSort();
        this._renderBody();
    }

    static getFilteredData() {
        return this._filteredData;
    }

    static selectRow(id) {
        this._selectedId = id;
        this._updateSelection();
    }

    static clearSelection() {
        this._selectedId = null;
        this._updateSelection();
    }

    static filterLocal(query) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            this._filterQuery = (query || '').toLowerCase().trim();
            this._applyFilterAndSort();
            this._renderBody();
        }, 300);
    }

    static _render() {
        const el = this._config.tableEl;
        if (!el) return;

        el.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'ck-table-wrapper';

        const table = document.createElement('table');
        table.className = 'ck-table';

        // Header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (const col of this._config.columns) {
            const th = document.createElement('th');
            th.textContent = col.label;
            th.dataset.key = col.key;
            if (col.width) th.style.width = col.width;
            th.addEventListener('click', () => this._onSort(col.key));
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');
        tbody.id = 'ckTableBody';
        table.appendChild(tbody);

        wrapper.appendChild(table);
        el.appendChild(wrapper);
    }

    static _renderBody() {
        const tbody = document.getElementById('ckTableBody');
        if (!tbody) return;

        if (this._filteredData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${this._config.columns.length}" class="ck-table__empty">Нет записей</td></tr>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const record of this._filteredData) {
            const tr = document.createElement('tr');
            tr.dataset.id = record.id;
            if (record.id === this._selectedId) {
                tr.classList.add('selected');
            }

            for (const col of this._config.columns) {
                const td = document.createElement('td');
                const raw = record[col.key];
                const text = col.format
                    ? col.format(raw, this._config.dictionaries || {})
                    : (raw ?? '');
                td.textContent = text;
                if (col.align === 'right') td.classList.add('align-right');
                if (col.key === 'id') td.classList.add('ck-table__id');
                if (col.key === 'created_at') td.classList.add('ck-table__date');
                tr.appendChild(td);
            }

            tr.addEventListener('click', () => {
                this._selectedId = record.id;
                this._updateSelection();
                if (this._config.onRowSelect) {
                    this._config.onRowSelect(record);
                }
            });

            fragment.appendChild(tr);
        }

        tbody.innerHTML = '';
        tbody.appendChild(fragment);
    }

    static _updateSelection() {
        const tbody = document.getElementById('ckTableBody');
        if (!tbody) return;
        for (const row of tbody.children) {
            if (row.dataset.id == this._selectedId) {
                row.classList.add('selected');
            } else {
                row.classList.remove('selected');
            }
        }
    }

    static _onSort(key) {
        if (this._sortField === key) {
            this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this._sortField = key;
            this._sortDir = 'asc';
        }
        this._updateSortIndicators();
        this._applyFilterAndSort();
        this._renderBody();
    }

    static _updateSortIndicators() {
        const ths = document.querySelectorAll('.ck-table th');
        for (const th of ths) {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.key === this._sortField) {
                th.classList.add(this._sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        }
    }

    static _applyFilterAndSort() {
        let result = [...this._data];

        // Фильтрация
        if (this._filterQuery) {
            result = result.filter(record => {
                return Object.values(record).some(val => {
                    if (val == null) return false;
                    return String(val).toLowerCase().includes(this._filterQuery);
                });
            });
        }

        // Сортировка
        if (this._sortField) {
            const dir = this._sortDir === 'asc' ? 1 : -1;
            result.sort((a, b) => {
                const va = a[this._sortField] ?? '';
                const vb = b[this._sortField] ?? '';
                if (typeof va === 'number' && typeof vb === 'number') {
                    return (va - vb) * dir;
                }
                return String(va).localeCompare(String(vb), 'ru') * dir;
            });
        }

        this._filteredData = result;
    }
}

window.CkTable = CkTable;
