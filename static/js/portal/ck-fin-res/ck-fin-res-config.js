/**
 * Конфигурация страницы ЦК Фин.Рез.
 * Определяет колонки таблицы и поля формы. Все справочники — через API
 * (включая статические перечисления assignment_formats, used_pm_options).
 */

import { buildColumns } from '../../shared/datatable/build-columns.js';

export class CkFinResConfig {
    static apiPrefix = 'ck-fin-res';
    static domainName = 'ck_fin_res';
    static pageTitle = 'ЦК Финансовый Результат';
    static storageKey = 'ck:ck-fin-res:view:v3';
    static sectionStateKey = 'ck:ck-fin-res:form-sections:v3';
    static workingSetCap = 1000;

    /** Метрики с показателем «MPL 90+». Синхронизировано вручную с MPL_METRIC_CODES в fr_validation_service.py. */
    static MPL_METRIC_CODES = new Set(['602']);

    static formatDate(val) {
        if (!val) return '';
        const d = new Date(val);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    static formatNumber(val) {
        if (val == null || val === '') return '';
        return Number(val).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    static formatTerbank(val, dicts) {
        if (val == null || val === '') return '';
        const t = (dicts.terbanks || []).find(t => String(t.tb_id) === String(val));
        return t ? t.short_name : String(val);
    }

    /** Пастельная палитра ТБ (фиксирована за tb_id; см. спеку §2 п.10). */
    static TB_PALETTE = {
        '1': '#8fade5', '4': '#e5a97c', '5': '#82c9a6', '7': '#e39494',
        '8': '#a89ade', '9': '#ddc27f', '10': '#7fbeda', '11': '#97ca97',
        '12': '#dda2c2', '13': '#cf9f6d', '16': '#bf9edd', '14': '#b9c17c',
    };
    static TB_FALLBACK_COLOR = '#9aa3b5';
    static TB_ABBR = {
        '1': 'ББ', '4': 'ВВБ', '5': 'ДВБ', '7': 'МБ', '8': 'ПБ', '9': 'СЗБ',
        '10': 'СибБ', '11': 'СРБ', '12': 'УБ', '13': 'ЦЧБ', '16': 'ЮЗБ', '14': 'ЦА',
    };
    /**
     * Полные названия ТБ — тот же фиксированный набор id, что TB_PALETTE/TB_ABBR.
     * Источник filterOptions чекбокс-фильтра tb_breakdown (см. columns ниже) —
     * но только исходное значение: `columns` — геттер без параметров, ему
     * неоткуда принять dicts, поэтому изначально берётся статика отсюда.
     * После загрузки словарей страница подставляет живой список через
     * tbFilterOptions(dicts) (см. ниже).
     */
    static TB_NAMES = {
        '1': 'Байкальский банк', '4': 'Волго-Вятский банк', '5': 'Дальневосточный банк',
        '7': 'Московский банк', '8': 'Поволжский банк', '9': 'Северо-Западный банк',
        '10': 'Сибирский банк', '11': 'Среднерусский банк', '12': 'Уральский банк',
        '13': 'Центрально-Чернозёмный банк', '16': 'Юго-Западный банк', '14': 'Центральный аппарат',
    };

    static tbColor(id) { return this.TB_PALETTE[String(id)] || this.TB_FALLBACK_COLOR; }

    static tbAbbr(id, dicts) {
        const a = this.TB_ABBR[String(id)];
        if (a) return a;
        const t = ((dicts && dicts.terbanks) || []).find(t => String(t.tb_id) === String(id));
        return t ? t.short_name : String(id);
    }

    static fmtMoney(v) {
        return Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /** Ячейка «Сумма — итого»: число + мини-бар композиции по ТБ. */
    static renderTotalAmount(raw, record) {
        const wrap = document.createElement('div');
        const num = document.createElement('div');
        num.className = 'frb-cell-total';
        num.textContent = record.tb_count ? `${this.fmtMoney(raw)} ₽` : 'не распределено';
        wrap.appendChild(num);
        const list = record.tb_breakdown || [];
        const total = list.reduce((s, b) => s + Number(b.metric_amount_rubles || 0), 0);
        if (total > 0) {
            const bar = document.createElement('div');
            bar.className = 'frb-cell-minibar';
            for (const b of list) {
                const seg = document.createElement('span');
                seg.style.width = `${(Number(b.metric_amount_rubles || 0) / total) * 100}%`;
                seg.style.background = this.tbColor(b.neg_finder_tb_id);
                seg.title = `${this.tbAbbr(b.neg_finder_tb_id)} — ${this.fmtMoney(b.metric_amount_rubles)} ₽`;
                bar.appendChild(seg);
            }
            wrap.appendChild(bar);
        }
        return wrap;
    }

    /** Ячейка «ТБ, выявившие отклонение»: чипы с суммами. */
    static renderTbChips(raw, record, dicts) {
        const wrap = document.createElement('div');
        wrap.className = 'frb-cell-chips';
        const list = record.tb_breakdown || [];
        if (!list.length) { wrap.textContent = '—'; return wrap; }
        for (const b of list) {
            const chip = document.createElement('span');
            chip.className = 'frb-chip';
            chip.title = `${this.tbAbbr(b.neg_finder_tb_id, dicts)} — ${this.fmtMoney(b.metric_amount_rubles)} ₽`;
            const dot = document.createElement('span');
            dot.className = 'frb-chip-dot';
            dot.style.background = this.tbColor(b.neg_finder_tb_id);
            chip.appendChild(dot);
            chip.appendChild(document.createTextNode(
                `${this.tbAbbr(b.neg_finder_tb_id, dicts)} · ${this.fmtMoney(b.metric_amount_rubles)}`,
            ));
            wrap.appendChild(chip);
        }
        return wrap;
    }

    /** Pivot-колонки: по одной числовой колонке на каждый ТБ словаря. */
    static tbPivotColumns(dicts) {
        return ((dicts && dicts.terbanks) || []).map(t => {
            const id = String(t.tb_id);
            return {
                key: `piv:${id}`, label: this.tbAbbr(id, dicts), type: 'number',
                align: 'right', width: 120, hidden: true, noFilter: true, noSort: true,
                description: t.full_name || t.short_name,
                render: (raw, record) => {
                    const span = document.createElement('span');
                    const b = (record.tb_breakdown || []).find(x => String(x.neg_finder_tb_id) === id);
                    span.textContent = b ? this.fmtMoney(b.metric_amount_rubles) : '—';
                    if (!b) span.className = 'frb-cell-zero';
                    return span;
                },
            };
        });
    }

    /**
     * Опции чекбокс-фильтра tb_breakdown из живого словаря dicts.terbanks —
     * страница подставляет их взамен статических (см. TB_NAMES выше) после
     * загрузки словарей. Порядок — как в словаре. При отсутствии/пустоте
     * словаря — фолбэк на статику (TB_ABBR/TB_NAMES).
     */
    static tbFilterOptions(dicts) {
        const terbanks = (dicts && dicts.terbanks) || [];
        if (!terbanks.length) {
            return Object.keys(this.TB_ABBR).map((id) => ({
                value: id,
                label: `${this.TB_ABBR[id]} — ${this.TB_NAMES[id]}`,
                short: this.TB_ABBR[id],
            }));
        }
        return terbanks.map((t) => {
            const id = String(t.tb_id);
            const short = t.short_name || this.tbAbbr(id, dicts);
            const full = t.full_name || short;
            return { value: id, label: `${short} — ${full}`, short };
        });
    }

    /**
     * Колонки таблицы выводятся из `fields` (один источник правды) + read-only
     * display-колонки. Заголовки/форматтеры/выравнивание уточняются overrides.
     *
     * Групповая модель (Task 10): строка таблицы — логическая группа (пункт ×
     * метрика), а не физическая строка ТБ. `total_amount`/`tb_count`/
     * `total_counts` — чистые read-only display-колонки (extra, поля в форме
     * нет). `tb_breakdown` — ЕСТЬ как поле формы (тип `amount-breakdown`,
     * секция «Метрика»), поэтому его табличное представление (чипы ТБ,
     * словарный фильтр по ТБ, noSort, своя ширина) задаётся через `overrides`,
     * а не `extra` — иначе `buildColumns` собрал бы ДВЕ колонки с одним и тем
     * же ключом (одну — из `extra`, другую — автовыведенную из `fields`).
     */
    static get columns() {
        return buildColumns(this.fields, {
            extra: [
                // Служебные колонки скрыты по умолчанию (hidden) — включаются из панели видимости.
                { key: 'id', label: 'ID', type: 'id', width: 60, hidden: true },
                { key: 'created_at', label: 'Создано', type: 'date', hidden: true, format: (v) => CkFinResConfig.formatDate(v) },
                { key: 'updated_at', label: 'Изменено', type: 'date', hidden: true, format: (v) => CkFinResConfig.formatDate(v) },
                { key: 'metric_name', label: 'Метрика', type: 'text' },
                { key: 'act_sub_number', label: '№ суб-акта', type: 'text' },
                { key: 'total_amount', label: 'Сумма — итого, ₽', type: 'number', align: 'right', width: 200, filterPicker: 'numrange', render: (raw, record) => CkFinResConfig.renderTotalAmount(raw, record) },
                // total_mpl_amount — чистый read-only агрегат (как total_amount): бэк уже
                // отдаёт его в группе и знает и в AGG_FILTER_EXPR (диапазон-фильтр), и в
                // AGG_SORT_EXPR (сортировка) — noSort намеренно не ставим, сортировка
                // включена тем же способом, что у total_amount (по умолчанию).
                {
                    key: 'total_mpl_amount',
                    label: 'MPL 90+, руб.',
                    description: 'Итог по группе. Заполняется только для метрики 602',
                    type: 'number',
                    align: 'right',
                    width: 140,
                    filterPicker: 'numrange',
                    render: (v) => {
                        const n = Number(v || 0);
                        return document.createTextNode(n > 0 ? CkFinResConfig.fmtMoney(n) : '—');
                    },
                },
                // noFilter: ключа tb_count нет в ALLOWED_COLUMNS бэка — фильтр молча игнорировался бы; сортировка (COUNT(*)) поддержана.
                { key: 'tb_count', label: 'Кол-во ТБ', type: 'number', align: 'right', width: 90, hidden: true, noFilter: true },
                { key: 'total_counts', label: 'Кол-во — итого (шт.)', type: 'number', align: 'right', width: 120, hidden: true },
            ],
            overrides: {
                metric_code: { label: 'Код метрики', type: 'text' },
                tb_leader: {
                    label: 'ТБ-рук. проверки',
                    format: (v, dicts) => CkFinResConfig.formatTerbank(v, dicts),
                    // Словарный резолвер для F1-фильтра: имя ТБ → массив сырых tb_id.
                    filterResolve: (q, dicts) => (dicts.terbanks || [])
                        .filter(t => String(t.short_name).toLowerCase().includes(String(q).toLowerCase()))
                        .map(t => String(t.tb_id)),
                },
                // Автовыведенная из fields (type: 'amount-breakdown') колонка
                // переопределяется целиком под чипы ТБ — см. комментарий выше.
                tb_breakdown: {
                    label: 'ТБ, выявившие отклонение',
                    // Тип словаря оставлен для совместимости (align/width не зависят от
                    // него); текстовый filterResolve, ради которого он был нужен, снят —
                    // фильтр теперь чекбокс-пикер (filterPicker) и от col.type не зависит.
                    type: 'dictionary',
                    width: 320,
                    noSort: true,
                    filterPicker: 'checkbox',
                    // Опции попапа — фиксированный список тех же 12 ТБ, что TB_PALETTE/
                    // TB_ABBR (полное название — TB_NAMES, см. комментарий там же).
                    // Спек op=in уходит на бэк под ключом tb_breakdown — membership-алиас
                    // «группа содержит такой ТБ» (HAVING, итоги группы не искажаются).
                    filterOptions: Object.keys(CkFinResConfig.TB_ABBR).map((id) => ({
                        value: id,
                        label: `${CkFinResConfig.TB_ABBR[id]} — ${CkFinResConfig.TB_NAMES[id]}`,
                        short: CkFinResConfig.TB_ABBR[id],
                    })),
                    // Сырое значение для client-mode фильтрации (маленькие наборы, включая
                    // демо): record.tb_breakdown — массив ОБЪЕКТОВ, specMatches сравнил бы
                    // его как строку и никогда не совпал бы. filterValue отдаёт массив
                    // голых tb_id — по нему уже работает массивная семантика specMatches.
                    filterValue: (record) => (record.tb_breakdown || []).map(b => String(b.neg_finder_tb_id)),
                    render: (raw, record, dicts) => CkFinResConfig.renderTbChips(raw, record, dicts),
                },
                // Поле формы mpl_breakdown (amount-breakdown) тоже автовыводится в
                // колонку buildColumns — как и tb_breakdown выше. Но в отличие от него
                // MPL сознательно не получает чипы/пивот (спека §1.3: «в таблице MPL —
                // только агрегатом total_mpl_amount», колонка добавляется отдельно
                // позже). Сырую развертку прячем служебно: ключа mpl_breakdown нет ни
                // в ALLOWED_COLUMNS, ни в AGG_SORT_EXPR бэка — фильтр молча
                // проигнорировался бы, а сортировка ушла бы в ValueError.
                // hidden:true защищает только ДЕФОЛТ: «⚙ → Выбрать все» дёргает
                // TableViewState.setAllVisible(true), который обнуляет весь _hidden
                // безусловно, игнорируя _defaultHidden. Поэтому колонка обязана уметь
                // отрендериться сама — format-заглушка вместо утечки String([...]) →
                // "[object Object]" на 602-строках. Отдельный label — чтобы служебная
                // колонка не путалась в панели с настоящей «MPL 90+, руб.»
                // (total_mpl_amount из Task 6, там же будет видимой по умолчанию).
                mpl_breakdown: {
                    label: 'MPL 90+ — развёртка (служебная)',
                    hidden: true,
                    noSort: true,
                    noFilter: true,
                    format: () => '—',
                },
                real_loss: { label: 'Реальные потери' },
                is_sent_to_top_brass: { label: 'На НС', description: 'На наблюдательный совет' },
                dt_sz: { format: (v) => CkFinResConfig.formatDate(v), dateFilter: 'single' }, // Дата СЗ — одна конкретная дата, не диапазон
                rev_start_dt: { format: (v) => CkFinResConfig.formatDate(v) },
                rev_end_dt: { format: (v) => CkFinResConfig.formatDate(v) },
                execution_deadline: { format: (v) => CkFinResConfig.formatDate(v) },
            },
            // Порядок колонок повторяет порядок секций формы (без группировки в
            // самой таблице): идентификация → процесс → отклонение → метрика
            // (код метрики вплотную к названию, сумма-итог/развертка/счётчики
            // ТБ рядом) → поручения → системное.
            order: [
                'id',
                'km_id', 'act_sub_number', 'num_sz', 'dt_sz', 'inspection_name', 'pocket', 'rev_start_dt', 'rev_end_dt', 'tb_leader',
                'process_number', 'block_owner', 'department_owner',
                'act_item_number', 'deviation_description', 'deviation_reason', 'deviation_consequence', 'risk', 'used_pm_lib',
                'metric_code', 'metric_name', 'total_amount', 'total_mpl_amount', 'tb_breakdown', 'total_counts', 'tb_count', 'real_loss', 'is_sent_to_top_brass', 'ck_comment',
                'sberdocs_ctrl_assgn_number', 'assigment_id', 'assigment_format', 'assigment_recommendation', 'execution_deadline',
                'reestr_metric_id', 'created_at', 'updated_at',
            ],
        });
    }

    // Поля сгруппированы в сворачиваемые секции (см. CkForm). flattenFields в
    // build-columns раскрывает секции → колонки строятся из того же источника.
    static fields = [
        // 1. Идентификация — где конкретно и когда выявлено отклонение.
        { section: 'Идентификация', key: 'ident', fields: [
            { key: 'km_id', label: '№ КМ', type: 'text', required: true, mask: 'km' },
            { row: [
                { key: 'num_sz', label: '№ с/з', type: 'text', required: true,
                  pattern: '^\\d{3,4}$', patternMessage: '№ с/з: 3 или 4 цифры' },
                { key: 'dt_sz', label: 'Дата с/з', type: 'date', width: '140px', required: true },
            ]},
            { key: 'inspection_name', label: 'Наименование проверки', type: 'text' },
            { key: 'pocket', label: 'Карман', type: 'text' },
            { row: [
                { key: 'rev_start_dt', label: 'Начало ревизуемого периода', type: 'date' },
                { key: 'rev_end_dt', label: 'Конец ревизуемого периода', type: 'date' },
            ]},
            { key: 'tb_leader', label: 'ТБ-руководитель проверки', type: 'dictionary', dict: 'terbanks' },
        ]},
        // 2. Процесс и владельцы — без «Кармана» и «Вида риска».
        { section: 'Процесс и владельцы', key: 'process', fields: [
            { key: 'process_number', label: 'Процесс', type: 'process-picker', required: true, paired: 'process_name', paired_extras: [
                { key: 'block_owner', source: 'block_owner' },
                { key: 'department_owner', source: 'department_owner' },
            ]},
            { row: [
                { key: 'block_owner', label: 'Блок', type: 'readonly-text' },
                { key: 'department_owner', label: 'Подразделение', type: 'readonly-text' },
            ]},
        ]},
        // 3. Отклонение — описания + «Вид риска» (из процесса) и «Использование PM» (из поручения).
        { section: 'Отклонение', key: 'deviation', fields: [
            { key: 'act_item_number', label: 'Пункт акта', type: 'text' },
            { key: 'deviation_description', label: 'Описание отклонения', type: 'textarea', rows: 3 },
            { key: 'deviation_reason', label: 'Причина отклонения', type: 'textarea', rows: 2 },
            { key: 'deviation_consequence', label: 'Последствия отклонения', type: 'textarea', rows: 2 },
            { row: [
                { key: 'risk', label: 'Вид риска', type: 'dictionary', dict: 'risk_types' },
                { key: 'used_pm_lib', label: 'Использование PM', type: 'dictionary', dict: 'used_pm_options' },
            ]},
        ]},
        // 4. Метрика — код метрики и развертка суммы по ТБ.
        { section: 'Метрика', key: 'metric', fields: [
            { key: 'metric_code', label: 'Метрика', type: 'dictionary', dict: 'metrics', required: true },
            { key: 'tb_breakdown', label: 'Сумма по ТБ (руб.)', type: 'amount-breakdown', required: true,
              description: 'Сумма выявленных возможностей финансового результата банка — итог и развертка по ТБ' },
            { key: 'mpl_breakdown', label: 'MPL 90+, руб.', type: 'amount-breakdown', required: false,
              description: 'Заполняется только для метрики 602' },
            { row: [
                { key: 'real_loss', label: 'Реальные потери', type: 'checkbox' },
                { key: 'is_sent_to_top_brass', label: 'На наблюдательный совет', type: 'checkbox' },
            ]},
            { key: 'ck_comment', label: 'Комментарий ЦК ФР', type: 'textarea', rows: 2 },
        ]},
        // 5. Поручения — без «Использования PM».
        { section: 'Поручения', key: 'assignment', fields: [
            { key: 'sberdocs_ctrl_assgn_number', label: '№ контр. поручения SberDocs', type: 'text' },
            { row: [
                // nullable: пустое поле уходит как null (Optional[int] на бэке), а не 0
                { key: 'assigment_id', label: 'ИД поручения УВА', type: 'number', nullable: true },
                { key: 'assigment_format', label: 'Формат поручения', type: 'dictionary', dict: 'assignment_formats' },
            ]},
            { key: 'assigment_recommendation', label: 'Формулировка поручения', type: 'textarea', rows: 2 },
            { key: 'execution_deadline', label: 'Срок контроля исполнения поручения', type: 'date' },
        ]},
        // 6. Системное.
        { section: 'Системное', key: 'system', fields: [
            { key: 'reestr_metric_id', label: 'ID реестра метрики', type: 'readonly-text' },
        ]},
    ];

    static dictNames = [
        'metrics', 'terbanks', 'processes', 'risk_types',
        'assignment_formats', 'used_pm_options',
    ];
}

window.CkFinResConfig = CkFinResConfig;
