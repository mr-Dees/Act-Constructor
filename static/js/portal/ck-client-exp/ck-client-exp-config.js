/**
 * Конфигурация страницы ЦК Клиентский опыт.
 * Определяет колонки таблицы и поля формы. Все справочники — через API.
 */

import { buildColumns } from '../../shared/datatable/build-columns.js';

export class CkClientExpConfig {
    static apiPrefix = 'ck-client-exp';
    static domainName = 'ck_client_exp';
    static pageTitle = 'ЦК Клиентский опыт';
    static storageKey = 'ck:ck-client-exp:view:v2';
    static sectionStateKey = 'ck:ck-client-exp:form-sections:v2';
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
                { key: 'created_at', label: 'Создано', type: 'date', hidden: true, format: (v) => CkClientExpConfig.formatDate(v) },
                { key: 'updated_at', label: 'Изменено', type: 'date', hidden: true, format: (v) => CkClientExpConfig.formatDate(v) },
                { key: 'metric_name', label: 'Метрика', type: 'text' },
                { key: 'act_sub_number', label: '№ суб-акта', type: 'text' },
            ],
            overrides: {
                metric_code: { label: 'Код метрики', type: 'text' },
                neg_finder_tb_id: {
                    label: 'ТБ',
                    format: (v, dicts) => CkClientExpConfig.formatTerbank(v, dicts),
                    // Словарный резолвер для F1-фильтра: имя ТБ → массив сырых tb_id.
                    filterResolve: (q, dicts) => (dicts.terbanks || [])
                        .filter(t => String(t.short_name).toLowerCase().includes(String(q).toLowerCase()))
                        .map(t => String(t.tb_id)),
                },
                metric_amount_rubles: { align: 'right', format: (v) => CkClientExpConfig.formatNumber(v) },
                dt_sz: { format: (v) => CkClientExpConfig.formatDate(v) },
            },
            // Порядок колонок повторяет порядок секций формы (без группировки в
            // таблице): идентификация → процесс → метрика (код метрики вплотную
            // к названию) → системное.
            order: [
                'id',
                'km_id', 'act_sub_number', 'num_sz', 'dt_sz', 'neg_finder_tb_id', 'act_item_number',
                'process_number', 'block_owner', 'department_owner',
                'metric_code', 'metric_name', 'metric_unic_clients', 'metric_element_counts', 'metric_amount_rubles', 'is_sent_to_top_brass', 'ck_comment',
                'reestr_metric_id', 'created_at', 'updated_at',
            ],
        });
    }

    // Поля сгруппированы в сворачиваемые секции (см. CkForm). flattenFields в
    // build-columns раскрывает секции → колонки строятся из того же источника.
    static fields = [
        // Группировка по аналогии с ЦКФР (у ЦККС нет блоков «Отклонение» и
        // «Поручения»): идентификация → процесс → метрика → системное.
        // 1. Идентификация — где и когда выявлено отклонение.
        { section: 'Идентификация', key: 'ident', fields: [
            { key: 'km_id', label: '№ КМ', type: 'text', required: true, mask: 'km' },
            { row: [
                { key: 'num_sz', label: '№ с/з', type: 'text', required: true,
                  pattern: '^\\d{3,4}$', patternMessage: '№ с/з: 3 или 4 цифры' },
                { key: 'dt_sz', label: 'Дата с/з', type: 'date', width: '140px', required: true },
            ]},
            { key: 'neg_finder_tb_id', label: 'ТБ-руководитель проверки', type: 'dictionary', dict: 'terbanks' },
            { key: 'act_item_number', label: 'Пункт акта', type: 'text' },
        ]},
        // 2. Процесс и владельцы.
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
        // 3. Метрика — показатели + код метрики и её название.
        { section: 'Метрика', key: 'metric', fields: [
            { key: 'metric_code', label: 'Метрика', type: 'dictionary', dict: 'metrics', required: true },
            { row: [
                { key: 'metric_unic_clients', label: 'Уник. клиенты', type: 'number', min: 0 },
                { key: 'metric_element_counts', label: 'Кол-во (шт.)', type: 'number', min: 0, width: '90px' },
            ]},
            { key: 'metric_amount_rubles', label: 'Сумма (руб.)', type: 'number', min: 0 },
            { row: [
                { key: 'is_sent_to_top_brass', label: 'На НС', type: 'checkbox', width: '120px' },
                { key: 'ck_comment', label: 'Комментарий ЦК', type: 'textarea', rows: 2 },
            ]},
        ]},
        // 4. Системное.
        { section: 'Системное', key: 'system', fields: [
            { key: 'reestr_metric_id', label: 'ID реестра метрики', type: 'readonly-text' },
        ]},
    ];

    static dictNames = ['metrics', 'terbanks', 'processes'];
}

window.CkClientExpConfig = CkClientExpConfig;
