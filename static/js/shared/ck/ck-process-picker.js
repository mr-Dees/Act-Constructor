/**
 * Popup-диалог выбора бизнес-процесса.
 * Extends DialogBase — использует overlay, анимации, Escape.
 */
class CkProcessPicker extends DialogBase {
    static _overlay = null;
    static _processes = [];
    static _onSelect = null;
    static _selectedProcess = null;
    static _escHandler = null;

    /**
     * @param {Array} processes - [{process_code, process_name, block_owner, department_owner}]
     * @param {Function} onSelect - callback({process_number, process_name, block_owner, department_owner})
     */
    static show(processes, onSelect) {
        this._processes = processes || [];
        this._onSelect = onSelect;
        this._selectedProcess = null;

        const overlay = this._createOverlay();
        this._overlay = overlay;

        const dialog = document.createElement('div');
        dialog.className = 'custom-dialog ck-process-picker';

        // Заголовок
        const header = document.createElement('div');
        header.className = 'dialog-header';
        header.innerHTML = '<h3>Выберите бизнес-процесс</h3>';
        dialog.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'dialog-body';

        // Поиск
        const search = document.createElement('input');
        search.className = 'ck-process-picker__search';
        search.placeholder = 'Поиск по названию или номеру...';
        search.addEventListener('input', () => this._onSearch(search.value));
        body.appendChild(search);

        // Таблица
        const tableWrap = document.createElement('div');
        tableWrap.className = 'ck-process-picker__table-wrap';
        tableWrap.id = 'ckProcessPickerTable';
        body.appendChild(tableWrap);

        dialog.appendChild(body);

        // Кнопки
        const buttons = document.createElement('div');
        buttons.className = 'ck-process-picker__buttons';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.textContent = 'Отмена';
        cancelBtn.addEventListener('click', () => this._close());
        buttons.appendChild(cancelBtn);

        const selectBtn = document.createElement('button');
        selectBtn.className = 'btn btn-primary';
        selectBtn.textContent = 'Выбрать';
        selectBtn.id = 'ckProcessPickerSelectBtn';
        selectBtn.disabled = true;
        selectBtn.addEventListener('click', () => this._onConfirm());
        buttons.appendChild(selectBtn);

        dialog.appendChild(buttons);
        overlay.appendChild(dialog);

        this._setupOverlayClickHandler(overlay, dialog, () => this._close());
        this._escHandler = this._setupEscapeHandler(overlay, () => this._close());
        this._showDialog(overlay);

        this._renderTable(this._processes);
        search.focus();
    }

    static _renderTable(processes) {
        const container = document.getElementById('ckProcessPickerTable');
        if (!container) return;

        if (processes.length === 0) {
            container.innerHTML = '<div class="ck-process-picker__empty">Процессы не найдены</div>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'ck-process-picker__table';

        const thead = document.createElement('thead');
        thead.innerHTML = `<tr>
            <th>Номер</th>
            <th>Блок</th>
            <th>Подразделение</th>
            <th>Наименование</th>
        </tr>`;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const proc of processes) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${this._esc(proc.process_code)}</td>
                <td>${this._esc(proc.block_owner)}</td>
                <td>${this._esc(proc.department_owner)}</td>
                <td>${this._esc(proc.process_name)}</td>
            `;
            tr.addEventListener('click', () => {
                this._selectedProcess = proc;
                // Выделение
                tbody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
                tr.classList.add('selected');
                const btn = document.getElementById('ckProcessPickerSelectBtn');
                if (btn) btn.disabled = false;
            });
            tr.addEventListener('dblclick', () => {
                this._selectedProcess = proc;
                this._onConfirm();
            });
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        container.innerHTML = '';
        container.appendChild(table);
    }

    static _onSearch(query) {
        const q = query.toLowerCase().trim();
        if (!q) {
            this._renderTable(this._processes);
            return;
        }
        const filtered = this._processes.filter(p =>
            p.process_code.toLowerCase().includes(q) ||
            p.process_name.toLowerCase().includes(q) ||
            (p.block_owner || '').toLowerCase().includes(q) ||
            (p.department_owner || '').toLowerCase().includes(q)
        );
        this._renderTable(filtered);
    }

    static _onConfirm() {
        if (!this._selectedProcess || !this._onSelect) return;
        this._onSelect({
            process_number: this._selectedProcess.process_code,
            process_name: this._selectedProcess.process_name,
            block_owner: this._selectedProcess.block_owner || '',
            department_owner: this._selectedProcess.department_owner || ''
        });
        this._close();
    }

    static _close() {
        if (this._overlay) {
            this._removeEscapeHandler(this._overlay);
            this._hideDialog(this._overlay);
            this._overlay = null;
        }
    }

    static _esc(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

window.CkProcessPicker = CkProcessPicker;
