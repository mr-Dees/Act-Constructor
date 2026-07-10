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
import { extractMplBreakdown, mergeTbBreakdowns } from './fr-breakdown-logic.js';

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
        // Pivot-колонки (одна на ТБ словаря) добавляются к базовым — переключаются
        // видимостью вместе с чипами через вид развертки (_applyTbView).
        const columns = [...cfg.columns, ...cfg.tbPivotColumns(this._dictionaries)];

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
            ColumnVisibility.mount({
                anchorEl: colvisBtn,
                columns,
                viewState: this._viewState,
                onChange: () => this._dataTable.refresh(),
                preContent: this._buildTbViewSection(columns),
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

        // Активность поля MPL зависит от выбранной метрики. Форма пересоздаёт
        // DOM при fill()/clear() — слушатель на самом select умер бы после
        // первого рендера, поэтому вешаем делегированный change на стабильный
        // контейнер формы.
        this._formContainerEl.addEventListener('change', (e) => {
            if (e.target && e.target.id === 'ck-field-metric_code') {
                this._syncMplField({ notifyOnClear: true });
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
            mpl_breakdown: extractMplBreakdown(g.tb_breakdown || []),
            total_amount: g.total_amount,
            total_mpl_amount: g.total_mpl_amount,
            total_counts: g.total_counts,
            tb_count: g.tb_count,
            divergent_fields: g.divergent_fields || [],
            updated_at: g.updated_at,
        };
    }

    /** Секция «Развертка по ТБ» для панели видимости колонок. */
    static _buildTbViewSection(columns) {
        const box = document.createElement('div');
        box.className = 'dt-colvis-tbview';
        box.innerHTML = `
            <div class="dt-colvis-tbview__title">Развертка по ТБ</div>
            <label><input type="radio" name="ckFrTbView" value="chips"> Чипы с суммами</label>
            <label><input type="radio" name="ckFrTbView" value="pivot"> Колонки по ТБ</label>`;
        const current = this._viewState.getExtra('tbView', 'chips');
        // Битое персист-значение (не chips/pivot) не должно ронять страницу — фолбэк на чипы.
        const el = box.querySelector(`input[value="${current}"]`) || box.querySelector('input[value="chips"]');
        el.checked = true;
        box.querySelectorAll('input[name=ckFrTbView]').forEach(r => {
            r.addEventListener('change', () => this._applyTbView(r.value, columns));
        });
        return box;
    }

    /** Переключение вида: chips ↔ pivot (видимость управляется штатным view-state). */
    static _applyTbView(view, columns) {
        this._viewState.setExtra('tbView', view);
        const pivKeys = columns.filter(c => String(c.key).startsWith('piv:')).map(c => c.key);
        if (view === 'pivot') {
            this._viewState.setVisible('tb_breakdown', false);
            // Если все pivot-колонки скрыты (первое включение) — показать все
            if (pivKeys.every(k => !this._viewState.isVisible(k))) {
                pivKeys.forEach(k => this._viewState.setVisible(k, true));
            }
        } else {
            pivKeys.forEach(k => this._viewState.setVisible(k, false));
            this._viewState.setVisible('tb_breakdown', true);
        }
        this._dataTable.refresh();
    }

    static _onRowSelect(record) {
        CkForm.fill(record);
        this._syncMplField();
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
        this._syncMplField();
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
        const isMpl = CkFinResConfig.MPL_METRIC_CODES.has(String(data.metric_code || '').trim());
        const mplItems = data.mpl_breakdown || [];
        delete data.mpl_breakdown;
        if (isMpl && !mplItems.length) {
            Notifications.error('Для метрики 602 требуется распределение «MPL 90+» по ТБ');
            return;
        }
        // Развертка по ТБ (основная + MPL) уходит отдельным полем breakdown
        // группового запроса — из common её убираем (common описывает только
        // общегрупповые поля). Вне метрики 602 MPL в слияние не идёт — все
        // строки уходят с mpl_amount_rubles='0.00' независимо от того, что
        // осталось в dataset формы.
        const breakdown = mergeTbBreakdowns(data.tb_breakdown || [], isMpl ? mplItems : []);
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
        const isMpl = field.key === 'mpl_breakdown';
        if (isMpl && !this._isMplMetric()) {
            Notifications.warning('Поле «MPL 90+» доступно только для метрики 602');
            return;
        }
        const current = CkForm.getBreakdownValue(field.key);
        const lossEl = document.getElementById('ck-field-real_loss');
        const nsEl = document.getElementById('ck-field-is_sent_to_top_brass');
        const rec = CkForm.getCurrentRecord();
        FRBreakdownEditor.show({
            subtitle: isMpl
                ? 'MPL 90+, руб.'
                : (rec
                    ? `Пункт ${rec.act_item_number || '—'} · ${rec.metric_code || ''} «${rec.metric_name || ''}»`
                    : 'Новая запись'),
            terbanks: this._dictionaries.terbanks || [],
            colorOf: (id) => cfg.tbColor(id),
            breakdown: current,
            flags: { loss: !!(lossEl && lossEl.checked), ns: !!(nsEl && nsEl.checked) },
            showCounts: !isMpl,
            showFlags: !isMpl,
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

    static _isMplMetric() {
        return CkFinResConfig.MPL_METRIC_CODES.has(this._currentMetricCode());
    }

    /** Активность поля MPL: вне метрики 602 поле приглушено, значение очищается. */
    static _syncMplField({ notifyOnClear = false } = {}) {
        const input = document.getElementById('ck-field-mpl_breakdown');
        if (!input) return;
        const wrap = input.closest('.ck-form__field') || input.parentElement;
        const enabled = this._isMplMetric();
        wrap.classList.toggle('ck-form__field--mpl-disabled', !enabled);
        if (!enabled && (CkForm.getBreakdownValue('mpl_breakdown') || []).length) {
            CkForm.setBreakdownValue('mpl_breakdown', []);
            if (notifyOnClear) {
                Notifications.warning('Метрика изменена: распределение «MPL 90+» очищено');
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
