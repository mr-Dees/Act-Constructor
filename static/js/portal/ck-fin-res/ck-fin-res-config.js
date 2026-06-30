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
    static storageKey = 'ck:ck-fin-res:view:v1';
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
                { key: 'id', label: 'ID', type: 'id', width: 60 },
                { key: 'created_at', label: 'Создано', type: 'date', format: (v) => CkFinResConfig.formatDate(v) },
                { key: 'metric_name', label: 'Метрика', type: 'text' },
                { key: 'act_sub_number', label: '№ суб-акта', type: 'text' },
            ],
            overrides: {
                metric_code: { label: 'Код метрики', type: 'text' },
                neg_finder_tb_id: { label: 'ТБ', format: (v, dicts) => CkFinResConfig.formatTerbank(v, dicts) },
                metric_amount_rubles: { align: 'right', format: (v) => CkFinResConfig.formatNumber(v) },
                dt_sz: { format: (v) => CkFinResConfig.formatDate(v) },
                rev_start_dt: { format: (v) => CkFinResConfig.formatDate(v) },
                rev_end_dt: { format: (v) => CkFinResConfig.formatDate(v) },
                execution_deadline: { format: (v) => CkFinResConfig.formatDate(v) },
            },
            // Логический порядок: идентификаторы и метрика впереди (код метрики
            // вплотную к названию), затем суммы/риск, процесс, описания отклонения,
            // поручения; системные поля — в конце.
            order: [
                'id', 'metric_code', 'metric_name', 'km_id', 'act_sub_number', 'act_item_number',
                'neg_finder_tb_id', 'num_sz', 'dt_sz',
                'metric_element_counts', 'metric_amount_rubles', 'real_loss', 'is_sent_to_top_brass', 'risk',
                'process_number', 'block_owner', 'department_owner', 'pocket',
                'deviation_description', 'deviation_reason', 'deviation_consequence',
                'rev_start_dt', 'rev_end_dt', 'inspection_name', 'sberdocs_ctrl_assgn_number',
                'assigment_id', 'assigment_format', 'assigment_recommendation', 'execution_deadline',
                'used_pm_lib', 'ck_comment', 'reestr_metric_id', 'created_at',
            ],
        });
    }

    static fields = [
        { key: 'metric_code', label: 'Метрика', type: 'dictionary', dict: 'metrics', required: true },
        { key: 'neg_finder_tb_id', label: 'ТБ-руководитель проверки', type: 'dictionary', dict: 'terbanks' },
        { row: [
            { key: 'num_sz', label: '№ с/з', type: 'text', required: true,
              pattern: '^\\d{3,4}$', patternMessage: '№ с/з: 3 или 4 цифры' },
            { key: 'dt_sz', label: 'Дата с/з', type: 'date', width: '140px', required: true },
        ]},
        { key: 'km_id', label: '№ КМ', type: 'text', required: true, mask: 'km' },
        { row: [
            { key: 'metric_element_counts', label: 'Кол-во (шт.)', type: 'number', min: 0, width: '90px' },
            { key: 'metric_amount_rubles', label: 'Сумма (руб.)', type: 'number', min: 0 },
        ]},
        { row: [
            { key: 'real_loss', label: 'Реальные потери', type: 'checkbox' },
            { key: 'is_sent_to_top_brass', label: 'На НС', type: 'checkbox' },
        ]},
        { key: 'ck_comment', label: 'Комментарий ЦК ФР', type: 'textarea', rows: 2 },
        { key: 'process_number', label: 'Процесс', type: 'process-picker', required: true, paired: 'process_name', paired_extras: [
            { key: 'block_owner', source: 'block_owner' },
            { key: 'department_owner', source: 'department_owner' },
        ]},
        { row: [
            { key: 'block_owner', label: 'Блок', type: 'readonly-text' },
            { key: 'department_owner', label: 'Подразделение', type: 'readonly-text' },
        ]},
        { row: [
            { key: 'pocket', label: 'Карман', type: 'text' },
            { key: 'risk', label: 'Вид риска', type: 'dictionary', dict: 'risk_types' },
        ]},
        { key: 'act_item_number', label: 'Пункт акта', type: 'text' },
        { key: 'deviation_description', label: 'Описание отклонения', type: 'textarea', rows: 3 },
        { key: 'deviation_reason', label: 'Причина отклонения', type: 'textarea', rows: 2 },
        { key: 'deviation_consequence', label: 'Последствия отклонения', type: 'textarea', rows: 2 },
        { row: [
            { key: 'rev_start_dt', label: 'Начало ревизуемого периода', type: 'date' },
            { key: 'rev_end_dt', label: 'Конец ревизуемого периода', type: 'date' },
        ]},
        { key: 'inspection_name', label: 'Наименование проверки', type: 'text' },
        { key: 'sberdocs_ctrl_assgn_number', label: '№ контр. поручения SberDocs', type: 'text' },
        { row: [
            { key: 'assigment_id', label: 'ИД поручения УВА', type: 'number' },
            { key: 'assigment_format', label: 'Формат поручения', type: 'dictionary', dict: 'assignment_formats' },
        ]},
        { key: 'assigment_recommendation', label: 'Формулировка поручения', type: 'textarea', rows: 2 },
        { key: 'execution_deadline', label: 'Срок контроля исполнения поручения', type: 'date' },
        { key: 'used_pm_lib', label: 'Использование PM', type: 'dictionary', dict: 'used_pm_options' },
        { key: 'reestr_metric_id', label: 'ID реестра метрики', type: 'readonly-text' },
    ];

    static dictNames = [
        'metrics', 'terbanks', 'processes', 'risk_types',
        'assignment_formats', 'used_pm_options',
    ];
}

window.CkFinResConfig = CkFinResConfig;
