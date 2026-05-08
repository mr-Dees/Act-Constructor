/**
 * Конфигурация страницы ЦК Фин.Рез.
 * Определяет колонки таблицы, поля формы и hardcoded-списки.
 */

// TODO: перенести в API-справочники когда потребуется динамика
const FR_ASSIGNMENT_FORMAT_OPTIONS = [
    'Централизованный контроль',
    'Самостоятельный контроль',
    'Нет поручения',
];

// TODO: перенести в API-справочники когда потребуется динамика
const FR_USED_PM_OPTIONS = ['Да', 'Нет'];

class CkFinResConfig {
    static apiPrefix = 'ck-fin-res';
    static domainName = 'ck_fin_res';
    static pageTitle = 'ЦК Фин.Рез.';

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

    static columns = [
        { key: 'id', label: 'ID', width: '60px' },
        { key: 'neg_finder_tb_id', label: 'ТБ', width: '50px' },
        { key: 'metric_code', label: 'Код метрики', width: '90px' },
        { key: 'created_at', label: 'Создано', format: (v) => CkFinResConfig.formatDate(v) },
        { key: 'metric_name', label: 'Метрика' },
        { key: 'km_id', label: '№ КМ' },
        { key: 'metric_amount_rubles', label: 'Сумма (руб.)', align: 'right', format: (v) => CkFinResConfig.formatNumber(v) },
        { key: 'act_sub_number', label: '№ суб-акта' },
    ];

    static fields = [
        { key: 'metric_code', label: 'Метрика', type: 'dictionary', dict: 'metrics', required: true },
        { key: 'neg_finder_tb_id', label: 'ТБ-руководитель проверки', type: 'dictionary', dict: 'terbanks' },
        { row: [
            { key: 'num_sz', label: '№ с/з', type: 'text', required: true,
              pattern: '^\\d{3,4}$', patternMessage: '№ с/з: 3 или 4 цифры' },
            { key: 'dt_sz', label: 'Дата с/з', type: 'date', width: '140px', required: true },
        ]},
        { row: [
            { key: 'metric_element_counts', label: 'Кол-во (шт.)', type: 'number', min: 0, width: '90px' },
            { key: 'metric_amount_rubles', label: 'Сумма (руб.)', type: 'number', min: 0 },
        ]},
        { key: 'real_loss', label: 'Реальные потери', type: 'checkbox' },
        { row: [
            { key: 'is_sent_to_top_brass', label: 'На НС', type: 'checkbox', width: '120px' },
            { key: 'ck_comment', label: 'Комментарий ЦК ФР', type: 'textarea', rows: 2 },
        ]},
        { key: 'km_id', label: '№ КМ', type: 'text', required: true, mask: 'km' },
        { key: 'act_item_number', label: 'Пункт акта', type: 'text' },
        { key: 'process_number', label: 'Процесс', type: 'process-picker', required: true, paired: 'process_name', paired_extras: [
            { key: 'process_owner', source: 'block_owner' },
            { key: 'department_owner', source: 'department_owner' },
        ]},
        { row: [
            { key: 'process_owner', label: 'Блок', type: 'readonly-text' },
            { key: 'department_owner', label: 'Подразделение', type: 'readonly-text', computed: true },
        ]},
        { row: [
            { key: 'pocket', label: 'Карман', type: 'text' },
            { key: 'risk', label: 'Вид риска', type: 'dictionary', dict: 'risk_types' },
        ]},
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
            { key: 'assigment_format', label: 'Формат поручения', type: 'select', options: FR_ASSIGNMENT_FORMAT_OPTIONS },
        ]},
        { key: 'assigment_recommendation', label: 'Формулировка поручения', type: 'textarea', rows: 2 },
        { key: 'execution_deadline', label: 'Срок контроля исполнения поручения', type: 'date' },
        { key: 'used_pm_lib', label: 'Использование PM', type: 'select', options: FR_USED_PM_OPTIONS },
        { key: 'reestr_metric_id', label: 'ID реестра метрики', type: 'readonly-text' },
    ];

    static dictNames = ['metrics', 'terbanks', 'processes', 'risk_types'];
}

window.CkFinResConfig = CkFinResConfig;
