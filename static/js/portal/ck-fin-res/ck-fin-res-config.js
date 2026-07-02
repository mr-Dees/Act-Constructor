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
    static storageKey = 'ck:ck-fin-res:view:v2';
    static sectionStateKey = 'ck:ck-fin-res:form-sections:v2';
    static workingSetCap = 1000;

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

    /**
     * Колонки таблицы выводятся из `fields` (один источник правды) + read-only
     * display-колонки. Заголовки/форматтеры/выравнивание уточняются overrides.
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
            ],
            overrides: {
                metric_code: { label: 'Код метрики', type: 'text' },
                neg_finder_tb_id: {
                    label: 'ТБ',
                    format: (v, dicts) => CkFinResConfig.formatTerbank(v, dicts),
                    // Словарный резолвер для F1-фильтра: имя ТБ → массив сырых tb_id.
                    filterResolve: (q, dicts) => (dicts.terbanks || [])
                        .filter(t => String(t.short_name).toLowerCase().includes(String(q).toLowerCase()))
                        .map(t => String(t.tb_id)),
                },
                metric_amount_rubles: { align: 'right', format: (v) => CkFinResConfig.formatNumber(v) },
                dt_sz: { format: (v) => CkFinResConfig.formatDate(v) },
                rev_start_dt: { format: (v) => CkFinResConfig.formatDate(v) },
                rev_end_dt: { format: (v) => CkFinResConfig.formatDate(v) },
                execution_deadline: { format: (v) => CkFinResConfig.formatDate(v) },
            },
            // Порядок колонок повторяет порядок секций формы (без группировки в
            // самой таблице): идентификация → процесс → отклонение → метрика
            // (код метрики вплотную к названию) → поручения → системное.
            order: [
                'id',
                'km_id', 'act_sub_number', 'num_sz', 'dt_sz', 'inspection_name', 'pocket', 'rev_start_dt', 'rev_end_dt', 'neg_finder_tb_id',
                'process_number', 'block_owner', 'department_owner',
                'act_item_number', 'deviation_description', 'deviation_reason', 'deviation_consequence', 'risk', 'used_pm_lib',
                'metric_code', 'metric_name', 'metric_element_counts', 'metric_amount_rubles', 'real_loss', 'is_sent_to_top_brass', 'ck_comment',
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
            { key: 'neg_finder_tb_id', label: 'ТБ-руководитель проверки', type: 'dictionary', dict: 'terbanks' },
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
        // 4. Метрика — показатели + код метрики и её название.
        { section: 'Метрика', key: 'metric', fields: [
            { key: 'metric_code', label: 'Метрика', type: 'dictionary', dict: 'metrics', required: true },
            { row: [
                { key: 'metric_element_counts', label: 'Кол-во (шт.)', type: 'number', min: 0, width: '90px' },
                { key: 'metric_amount_rubles', label: 'Сумма (руб.)', type: 'number', min: 0,
                  description: 'Сумма выявленных возможностей финансового результата банка' },
            ]},
            { row: [
                { key: 'real_loss', label: 'Реальные потери', type: 'checkbox' },
                { key: 'is_sent_to_top_brass', label: 'На НС', type: 'checkbox' },
            ]},
            { key: 'ck_comment', label: 'Комментарий ЦК ФР', type: 'textarea', rows: 2 },
        ]},
        // 5. Поручения — без «Использования PM».
        { section: 'Поручения', key: 'assignment', fields: [
            { key: 'sberdocs_ctrl_assgn_number', label: '№ контр. поручения SberDocs', type: 'text' },
            { row: [
                { key: 'assigment_id', label: 'ИД поручения УВА', type: 'number' },
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
