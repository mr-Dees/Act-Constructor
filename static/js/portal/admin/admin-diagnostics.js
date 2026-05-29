/**
 * Раздел "Диагностика" админ-страницы.
 *
 * Подгружает снимок состояния батчеров и фоновых задач через
 * `APIClient.loadDiagnostics()` и рендерит read-only представление:
 *   - сводные таблицы batchers / background_tasks с ключевыми полями;
 *   - raw-JSON под details/summary для полного снимка.
 *
 * Reload по кнопке #adminDiagRefreshBtn; авто-обновления нет, чтобы
 * не нагружать БД-пулы фоновым polling'ом на каждом открытии вкладки.
 */
import { APIClient } from '../../shared/api.js';

export class AdminDiagnostics {
    static _container = null;
    static _refreshBtn = null;
    static _loading = false;

    static init() {
        this._container = document.getElementById('adminDiagnosticsContent');
        this._refreshBtn = document.getElementById('adminDiagRefreshBtn');
        if (!this._container) return;

        if (this._refreshBtn) {
            this._refreshBtn.addEventListener('click', () => this.refresh());
        }

        this.refresh();
    }

    static async refresh() {
        if (this._loading || !this._container) return;
        this._loading = true;
        this._container.textContent = 'Загрузка...';

        try {
            const data = await APIClient.loadDiagnostics();
            this._render(data);
        } catch (err) {
            console.error('AdminDiagnostics: ошибка загрузки', err);
            this._container.textContent = '';
            const msg = document.createElement('div');
            msg.className = 'admin-diagnostics-error';
            msg.textContent = `Не удалось загрузить диагностику: ${err.message || err}`;
            this._container.appendChild(msg);
        } finally {
            this._loading = false;
        }
    }

    /**
     * @param {{batchers: Object, background_tasks: Object}} data
     * @private
     */
    static _render(data) {
        this._container.textContent = '';

        const batchers = data && data.batchers ? data.batchers : {};
        const tasks = data && data.background_tasks ? data.background_tasks : {};

        this._container.appendChild(this._renderBatchers(batchers));
        this._container.appendChild(this._renderTasks(tasks));
        this._container.appendChild(this._renderRaw(data));
    }

    /** @private */
    static _renderBatchers(batchers) {
        const wrap = document.createElement('div');
        wrap.className = 'admin-diagnostics-section';

        const h = document.createElement('h2');
        h.className = 'admin-diagnostics-section-title';
        h.textContent = `Батчеры (${Object.keys(batchers).length})`;
        wrap.appendChild(h);

        const names = Object.keys(batchers).sort();
        if (names.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'admin-diagnostics-empty';
            empty.textContent = 'Нет зарегистрированных батчеров.';
            wrap.appendChild(empty);
            return wrap;
        }

        const table = document.createElement('table');
        table.className = 'admin-diagnostics-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Имя</th>
                    <th>Running</th>
                    <th>Buffer</th>
                    <th>Max batch</th>
                    <th>Interval (s)</th>
                    <th>Last flush ago (s)</th>
                    <th>Dropped</th>
                    <th>Last error</th>
                </tr>
            </thead>
        `;
        const tbody = document.createElement('tbody');
        for (const name of names) {
            const b = batchers[name] || {};
            const tr = document.createElement('tr');
            tr.appendChild(this._cell(name));
            tr.appendChild(this._cellBool(b.running));
            tr.appendChild(this._cell(
                `${this._num(b.buffer_size)} / ${this._num(b.max_buffer_size)}`
            ));
            tr.appendChild(this._cell(this._num(b.max_batch_size)));
            tr.appendChild(this._cell(this._num(b.flush_interval_sec)));
            tr.appendChild(this._cell(this._numOrDash(b.last_flush_ago_sec)));
            tr.appendChild(this._cell(this._num(b.dropped_count)));
            tr.appendChild(this._cell(b.last_error || '—'));
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    /** @private */
    static _renderTasks(tasks) {
        const wrap = document.createElement('div');
        wrap.className = 'admin-diagnostics-section';

        const h = document.createElement('h2');
        h.className = 'admin-diagnostics-section-title';
        h.textContent = `Фоновые задачи (${Object.keys(tasks).length})`;
        wrap.appendChild(h);

        const names = Object.keys(tasks).sort();
        if (names.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'admin-diagnostics-empty';
            empty.textContent = 'Нет зарегистрированных фоновых задач.';
            wrap.appendChild(empty);
            return wrap;
        }

        for (const name of names) {
            const t = tasks[name] || {};
            const card = document.createElement('div');
            card.className = 'admin-diagnostics-card';

            const title = document.createElement('div');
            title.className = 'admin-diagnostics-card-title';
            title.textContent = name;
            card.appendChild(title);

            const statusLine = document.createElement('div');
            statusLine.className = 'admin-diagnostics-card-status';
            statusLine.textContent = `running: ${t.running ? 'true' : 'false'}`;
            card.appendChild(statusLine);

            const pre = document.createElement('pre');
            pre.className = 'admin-diagnostics-card-json';
            pre.textContent = JSON.stringify(t, null, 2);
            card.appendChild(pre);

            wrap.appendChild(card);
        }
        return wrap;
    }

    /** @private */
    static _renderRaw(data) {
        const details = document.createElement('details');
        details.className = 'admin-diagnostics-raw';
        const summary = document.createElement('summary');
        summary.textContent = 'Полный JSON-снимок';
        details.appendChild(summary);
        const pre = document.createElement('pre');
        pre.className = 'admin-diagnostics-raw-json';
        pre.textContent = JSON.stringify(data, null, 2);
        details.appendChild(pre);
        return details;
    }

    /** @private */
    static _cell(text) {
        const td = document.createElement('td');
        td.textContent = text == null ? '—' : String(text);
        return td;
    }

    /** @private */
    static _cellBool(v) {
        const td = document.createElement('td');
        td.textContent = v ? 'true' : 'false';
        td.className = v ? 'admin-diagnostics-ok' : 'admin-diagnostics-warn';
        return td;
    }

    /** @private */
    static _num(v) {
        return v == null ? '0' : String(v);
    }

    /** @private */
    static _numOrDash(v) {
        if (v == null) return '—';
        return typeof v === 'number' ? v.toFixed(1) : String(v);
    }
}

window.AdminDiagnostics = AdminDiagnostics;
