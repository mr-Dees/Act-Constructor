/**
 * Конфигурация страницы ЦК Клиентский опыт.
 * Определяет колонки таблицы и поля формы. Все справочники — через API.
 */

import { buildColumns } from '../../shared/datatable/build-columns.js';

export class CkClientExpConfig {
    static apiPrefix = 'ck-client-exp';
    static domainName = 'ck_client_exp';
    static pageTitle = 'ЦК Клиентский опыт';
    static storageKey = 'ck:ck-client-exp:view:v1';
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
                { key: 'created_at', label: 'Создано', type: 'date', format: (v) => CkClientExpConfig.formatDate(v) },
                { key: 'metric_name', label: 'Метрика', type: 'text' },
                { key: 'act_sub_number', label: '№ суб-акта', type: 'text' },
            ],
            overrides: {
                metric_code: { label: 'Код метрики', type: 'text' },
                neg_finder_tb_id: { label: 'ТБ', format: (v, dicts) => CkClientExpConfig.formatTerbank(v, dicts) },
                metric_amount_rubles: { align: 'right', format: (v) => CkClientExpConfig.formatNumber(v) },
                dt_sz: { format: (v) => CkClientExpConfig.formatDate(v) },
            },
            // Логический порядок: идентификаторы и метрика впереди (код метрики
            // вплотную к названию), затем показатели/процесс; системные — в конце.
            order: [
                'id', 'metric_code', 'metric_name', 'km_id', 'act_sub_number', 'act_item_number',
                'neg_finder_tb_id', 'num_sz', 'dt_sz',
                'metric_unic_clients', 'metric_element_counts', 'metric_amount_rubles', 'is_sent_to_top_brass',
                'process_number', 'block_owner', 'department_owner',
                'ck_comment', 'reestr_metric_id', 'created_at',
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
            { key: 'metric_unic_clients', label: 'Уник. клиенты', type: 'number', min: 0 },
            { key: 'metric_element_counts', label: 'Кол-во (шт.)', type: 'number', min: 0, width: '90px' },
        ]},
        { key: 'metric_amount_rubles', label: 'Сумма (руб.)', type: 'number', min: 0 },
        { row: [
            { key: 'is_sent_to_top_brass', label: 'На НС', type: 'checkbox', width: '120px' },
            { key: 'ck_comment', label: 'Комментарий ЦК', type: 'textarea', rows: 2 },
        ]},
        { key: 'act_item_number', label: 'Пункт акта', type: 'text' },
        { key: 'process_number', label: 'Процесс', type: 'process-picker', required: true, paired: 'process_name', paired_extras: [
            { key: 'block_owner', source: 'block_owner' },
            { key: 'department_owner', source: 'department_owner' },
        ]},
        { row: [
            { key: 'block_owner', label: 'Блок', type: 'readonly-text' },
            { key: 'department_owner', label: 'Подразделение', type: 'readonly-text' },
        ]},
        { key: 'reestr_metric_id', label: 'ID реестра метрики', type: 'readonly-text' },
    ];

    static dictNames = ['metrics', 'terbanks', 'processes'];
}

window.CkClientExpConfig = CkClientExpConfig;
