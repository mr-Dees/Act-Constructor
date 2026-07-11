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
import { FRBreakdownEditor } from './fr-breakdown-editor.js';
import { extractNplBreakdown, mergeTbBreakdowns } from './fr-breakdown-logic.js';

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
        // Живой набор NPL-метрик из словаря (флаг has_npl) взамен статического
        // фолбэка — тот же флаг читает бэкенд (единый источник истины).
        const nplCodes = cfg.nplCodesFromMetrics(this._dictionaries.metrics);
        if (nplCodes) cfg.NPL_METRIC_CODES = nplCodes;
    }

    static _initComponents() {
        const cfg = CkFinResConfig;
        // Pivot-пары: колонка суммы и колонка NPL каждого ТБ идут рядом (сравнение
        // показателей одного банка — в соседних ячейках).
        const sumPivots = cfg.tbPivotColumns(this._dictionaries);
        const nplPivots = cfg.tbPivotColumns(this._dictionaries, { keyPrefix: 'pivnpl', breakdownField: 'npl_breakdown', labelSuffix: ' · NPL' });
        const columns = [...cfg.columns, ...sumPivots.flatMap((c, i) => [c, nplPivots[i]])];
        // Живые опции ТБ-фильтров обеих чип-колонок (взамен статики TB_NAMES).
        for (const key of ['tb_breakdown', 'npl_breakdown']) {
            const c = columns.find(col => col.key === key);
            if (c) c.filterOptions = cfg.tbFilterOptions(this._dictionaries);
        }

        // Состояние представления (видимость/ширины) с persist в localStorage
        this._viewState = new TableViewState({
            storageKey: cfg.storageKey,
            columns,
            storage: window.localStorage,
        });

        // Адаптивный источник данных (client/server по факту полноты загрузки).
        // Ответ search — ГРУППЫ (пункт × метрика); на плоские строки таблицы
        // разворачивает _flattenGroup.
        this._dataSource = new DataSource({
            pageSize: 50,
            workingSetCap: cfg.workingSetCap,
            fetchPage: async ({ filters, sort, limit, offset }) => {
                const res = await APIClient.searchCkRecordsPage(cfg.apiPrefix, {
                    filters: filters || {},
                    sort: (sort || []).map(s => ({ by: s.key, dir: s.dir })),
                    limit,
                    offset,
                });
                return { ...res, items: (res.items || []).map(g => CkFinResPage._flattenGroup(g)) };
            },
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

        // Панель видимости колонок (кнопка ⚙ в тулбаре) + секция «Развертка по ТБ»
        const colvisBtn = document.getElementById('ckColvisBtn');
        if (colvisBtn) {
            const isPivotKey = (k) => String(k).startsWith('piv:') || String(k).startsWith('pivnpl:');
            ColumnVisibility.mount({
                anchorEl: colvisBtn,
                // Пивоты управляются секцией «Развертка по ТБ», в общем списке (и под
                // «Выбрать/Снять все») им делать нечего.
                columns: columns.filter(c => !isPivotKey(c.key)),
                viewState: this._viewState,
                onChange: () => { this._reassertTbView(columns); this._dataTable.refresh(); },
                preContent: this._buildTbViewSection(columns),
                onApi: (api) => { this._colvisApi = api; },
            });
        }

        // Применяем сохранённый вид развертки (чипы/pivot) до первого рендера таблицы.
        this._applyTbView(this._viewState.getExtra('tbView', 'chips'), columns);

        // Форма
        this._formContainerEl = document.getElementById('ckFormPanel');
        CkForm.init({
            fields: cfg.fields,
            dictionaries: this._dictionaries,
            containerEl: this._formContainerEl,
            onProcessPick: (field) => this._openProcessPicker(field),
            onBreakdownEdit: (field) => this._openBreakdownEditor(field),
            sectionStateKey: cfg.sectionStateKey,
        });

        // Активность поля NPL зависит от выбранной метрики. Форма пересоздаёт
        // DOM при fill()/clear() — слушатель на самом select умер бы после
        // первого рендера, поэтому вешаем делегированный change на стабильный
        // контейнер формы.
        this._formContainerEl.addEventListener('change', (e) => {
            if (e.target && e.target.id === 'ck-field-metric_code') {
                this._syncNplField({ notifyOnClear: true });
            }
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

    /** Группа API → плоская строка таблицы (ключ строки — сериализованный group_key). */
    static _flattenGroup(g) {
        const k = g.group_key || {};
        return {
            ...g.common,
            id: `${k.act_sub_number_id}|${k.km_id}|${k.act_item_number}|${k.metric_code}`,
            group_key: k,
            row_ids: g.row_ids || [],
            tb_breakdown: g.tb_breakdown || [],
            npl_breakdown: extractNplBreakdown(g.tb_breakdown || []),
            total_amount: g.total_amount,
            total_npl_amount: g.total_npl_amount,
            total_counts: g.total_counts,
            tb_count: g.tb_count,
            divergent_fields: g.divergent_fields || [],
            updated_at: g.updated_at,
        };
    }

    /** Секция «Развертка по ТБ» для панели видимости колонок: заголовок + радио + галочки-пары ТБ. */
    static _buildTbViewSection(columns) {
        const box = document.createElement('div');
        box.className = 'dt-colvis-tbview dt-colvis-group';
        const title = document.createElement('div');
        title.className = 'dt-colvis-grouplabel';
        title.textContent = 'Развертка по ТБ';
        box.appendChild(title);

        const radios = document.createElement('div');
        radios.className = 'dt-colvis-tbview__radios';
        radios.innerHTML = `
            <label><input type="radio" name="ckFrTbView" value="chips"> Чипы с суммами</label>
            <label><input type="radio" name="ckFrTbView" value="pivot"> Колонки по ТБ</label>`;
        box.appendChild(radios);

        // Одна галочка на ТБ — управляет ПАРОЙ колонок piv:/pivnpl: (спека §0).
        const tbGrid = document.createElement('div');
        tbGrid.className = 'dt-colvis-tbgrid';
        this._tbChecks = new Map();
        for (const t of (this._dictionaries.terbanks || [])) {
            const id = String(t.tb_id);
            const label = document.createElement('label');
            label.className = 'dt-colvis-item';
            label.title = t.full_name || t.short_name || '';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = this._viewState.isVisible(`piv:${id}`);
            cb.addEventListener('change', () => {
                this._viewState.setVisible(`piv:${id}`, cb.checked);
                this._viewState.setVisible(`pivnpl:${id}`, cb.checked);
                this._dataTable.refresh();
            });
            const span = document.createElement('span');
            span.textContent = CkFinResConfig.tbAbbr(id, this._dictionaries);
            label.appendChild(cb);
            label.appendChild(span);
            tbGrid.appendChild(label);
            this._tbChecks.set(id, cb);
        }
        box.appendChild(tbGrid);

        const current = this._viewState.getExtra('tbView', 'chips');
        // Битое персист-значение (не chips/pivot) не должно ронять страницу — фолбэк на чипы.
        const el = box.querySelector(`input[value="${current}"]`) || box.querySelector('input[value="chips"]');
        el.checked = true;
        box.querySelectorAll('input[name=ckFrTbView]').forEach(r => {
            r.addEventListener('change', () => this._applyTbView(r.value, columns));
        });
        this._syncTbChecks(current);
        return box;
    }

    /** Галочки ТБ активны только в режиме «Колонки»; состояние — из viewState. */
    static _syncTbChecks(view) {
        if (!this._tbChecks) return;
        const pivot = view === 'pivot';
        for (const [id, cb] of this._tbChecks) {
            cb.disabled = !pivot;
            cb.checked = this._viewState.isVisible(`piv:${id}`);
        }
    }

    /** «Выбрать/Снять все» и Сброс трогают весь viewState (включая пивоты, которых
     * нет в списке панели) — возвращаем видимость пивотов под контроль радио/галочек. */
    static _reassertTbView(columns) {
        const view = this._viewState.getExtra('tbView', 'chips');
        if (view !== 'pivot') {
            for (const col of columns) {
                if (String(col.key).startsWith('piv:') || String(col.key).startsWith('pivnpl:')) {
                    this._viewState.setVisible(col.key, false);
                }
            }
        }
        this._syncTbChecks(view);
    }

    /**
     * Переключение вида: chips ↔ pivot — безусловно (перетирает ручной выбор
     * пользователя по pivot-колонкам/tb_breakdown, но только в момент
     * переключения радио; вне него галочки живут как обычно).
     */
    static _applyTbView(view, columns) {
        const pivot = view === 'pivot';
        for (const col of columns) {
            const key = String(col.key);
            if (key.startsWith('piv:') || key.startsWith('pivnpl:')) this._viewState.setVisible(key, pivot);
        }
        this._viewState.setVisible('tb_breakdown', !pivot);
        this._viewState.setVisible('npl_breakdown', !pivot);
        this._viewState.setExtra('tbView', view);
        this._syncTbChecks(view);
        if (this._colvisApi) this._colvisApi.sync();
        this._dataTable.refresh();
    }

    static _onRowSelect(record) {
        CkForm.fill(record);
        this._syncNplField();
        this._updateSubheader(record);
        // Данные строк ТБ группы разошлись по общим полям (ETL-рассинхрон) —
        // предупреждаем один раз при выборе записи.
        if (Array.isArray(record.divergent_fields) && record.divergent_fields.length) {
            Notifications.warning('Данные строк ТБ расходятся по полям: ' + record.divergent_fields.join(', '));
        }
    }

    static _onAddRecord() {
        this._dataTable.clearSelection();
        CkForm.clear();
        this._syncNplField();
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
        const metricCode = String(data.metric_code || '').trim();
        const isNpl = CkFinResConfig.NPL_METRIC_CODES.has(metricCode);
        const nplItems = data.npl_breakdown || [];
        delete data.npl_breakdown;
        if (isNpl && !nplItems.length) {
            Notifications.error(`Для метрики ${metricCode} требуется распределение «NPL 90+» по ТБ`);
            return;
        }
        // Развертка по ТБ (основная + NPL) уходит отдельным полем breakdown
        // группового запроса — из common её убираем (common описывает только
        // общегрупповые поля). Вне NPL-метрики NPL в слияние не идёт — все
        // строки уходят с npl_amount_rubles='0.00' независимо от того, что
        // осталось в dataset формы.
        const breakdown = mergeTbBreakdowns(data.tb_breakdown || [], isNpl ? nplItems : []);
        delete data.tb_breakdown;
        const mode = CkForm.getMode();
        const record = CkForm.getCurrentRecord();

        const body = mode === 'create'
            ? {
                group_key: {
                    act_sub_number_id: null,
                    km_id: data.km_id || '',
                    act_item_number: data.act_item_number || '',
                    metric_code: data.metric_code || '',
                },
                expected_row_ids: [],
                common: data,
                breakdown,
            }
            : {
                group_key: record.group_key,
                expected_row_ids: record.row_ids,
                common: { ...record, ...data },
                breakdown,
            };

        try {
            await APIClient.groupSaveCkRecords(CkFinResConfig.apiPrefix, body);
            Notifications.success(mode === 'create' ? 'Запись создана' : 'Запись обновлена');
            await this._loadData();
            CkForm.renderEmpty();
            this._updateSubheader(null);
        } catch (error) {
            Notifications.error('Ошибка сохранения: ' + error.message);
            // 409: группу параллельно изменили/удалили — подтягиваем актуальное
            // состояние, чтобы expected_row_ids на следующей попытке не разъехались снова.
            if (String(error.message).includes('обновите данные')) await this._loadData();
        }
    }

    static async _onDelete() {
        const record = CkForm.getCurrentRecord();
        if (!record) return;

        const confirmed = await DialogManager.show({
            title: 'Удалить запись?',
            message: `Пункт ${record.act_item_number || '—'} · метрика ${record.metric_code || '—'}: будут удалены строки всех ТБ (${record.tb_count || 0}).`,
            type: 'warning',
        });
        if (!confirmed) return;

        try {
            await APIClient.groupDeleteCkRecord(CkFinResConfig.apiPrefix, {
                group_key: record.group_key,
                expected_row_ids: record.row_ids,
            });
            Notifications.success('Запись удалена');
            await this._loadData();
            CkForm.renderEmpty();
            this._updateSubheader(null);
        } catch (error) {
            Notifications.error('Ошибка удаления: ' + error.message);
            // 409: та же гонка, что и в _onSave — обновляем список.
            if (String(error.message).includes('обновите данные')) await this._loadData();
        }
    }

    static _openProcessPicker(field) {
        const processes = this._dictionaries.processes || [];
        CkProcessPicker.show(processes, (selected) => {
            CkForm.setProcessValue(field.key, selected.process_number, selected.process_name, selected);
        });
    }

    static _openBreakdownEditor(field) {
        const cfg = CkFinResConfig;
        const isNpl = field.key === 'npl_breakdown';
        if (isNpl && !this._isNplMetric()) {
            const codes = [...CkFinResConfig.NPL_METRIC_CODES].sort().join(', ');
            Notifications.warning(`Поле «NPL 90+» доступно только для метрики ${codes}`);
            return;
        }
        const current = CkForm.getBreakdownValue(field.key);
        const lossEl = document.getElementById('ck-field-real_loss');
        const nsEl = document.getElementById('ck-field-is_sent_to_top_brass');
        const rec = CkForm.getCurrentRecord();
        FRBreakdownEditor.show({
            subtitle: isNpl
                ? 'NPL 90+, руб.'
                : (rec
                    ? `Пункт ${rec.act_item_number || '—'} · ${rec.metric_code || ''} «${rec.metric_name || ''}»`
                    : 'Новая запись'),
            terbanks: this._dictionaries.terbanks || [],
            colorOf: (id) => cfg.tbColor(id),
            breakdown: current,
            flags: { loss: !!(lossEl && lossEl.checked), ns: !!(nsEl && nsEl.checked) },
            showCounts: !isNpl,
            showFlags: !isNpl,
            onApply: ({ breakdown, flags }) => {
                CkForm.setBreakdownValue(field.key, breakdown);
                if (lossEl) lossEl.checked = !!flags.loss;
                if (nsEl) nsEl.checked = !!flags.ns;
            },
        });
    }

    static _currentMetricCode() {
        const el = document.getElementById('ck-field-metric_code');
        return el ? String(el.value || '').trim() : '';
    }

    static _isNplMetric() {
        return CkFinResConfig.NPL_METRIC_CODES.has(this._currentMetricCode());
    }

    /** Активность поля NPL: вне NPL-метрики поле приглушено, значение очищается. */
    static _syncNplField({ notifyOnClear = false } = {}) {
        const input = document.getElementById('ck-field-npl_breakdown');
        if (!input) return;
        const wrap = input.closest('.ck-form__field') || input.parentElement;
        const enabled = this._isNplMetric();
        wrap.classList.toggle('ck-form__field--npl-disabled', !enabled);
        if (!enabled && (CkForm.getBreakdownValue('npl_breakdown') || []).length) {
            CkForm.setBreakdownValue('npl_breakdown', []);
            if (notifyOnClear) {
                Notifications.warning('Метрика изменена: распределение «NPL 90+» очищено');
            }
        }
    }

    static _updateSubheader(record) {
        const titleEl = document.getElementById('ckRecordTitle');
        const metaEl = document.getElementById('ckRecordMeta');
        if (!titleEl || !metaEl) return;

        if (record) {
            titleEl.textContent = `Пункт ${record.act_item_number || '—'} · ${record.metric_code || ''}`;
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
