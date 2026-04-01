/**
 * Конфигурация страницы ЦК Фин.Рез.
 * Определяет колонки таблицы, поля формы и hardcoded-списки.
 */

// TODO: перенести в API-справочники когда потребуется динамика
const FR_POCKET_OPTIONS = [
    'нет',
    'ОА, правовые вопросы, комплаенс',
    'Риск-менеджмент',
    'Внутренний аудит',
    'Финансы',
    'ИТ',
    'Операционный блок',
    'Розничный бизнес',
    'Корпоративный бизнес',
];

// TODO: перенести в API-справочники когда потребуется динамика
const FR_RISK_OPTIONS = [
    'Кредитный риск B2B',
    'Товарный риск Банковской книги',
    'Риск ликвидности',
    'Риск участия и вынужденной поддержки',
    'Стратегический риск',
    'Операционный риск',
    'Модельный риск',
    'Риск кибербезопасности',
    'Рыночный риск',
];

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
        { key: 'neg_finder_tb_id', label: 'ТБ-находитель', type: 'dictionary', dict: 'terbanks' },
        { row: [
            { key: 'num_sz', label: '№ с/з', type: 'text', required: true },
            { key: 'dt_sz', label: 'Дата с/з', type: 'date', width: '140px' },
        ]},
        { row: [
            { key: 'metric_amount_rubles', label: 'Сумма (руб.)', type: 'number', min: 0 },
            { key: 'metric_element_counts', label: 'Кол-во', type: 'number', min: 0, width: '70px' },
            { key: 'is_sent_to_top_brass', label: 'На НС', type: 'checkbox', width: '60px' },
        ]},
        { key: 'km_id', label: '№ КМ', type: 'text', required: true },
        { key: 'act_item_number', label: 'Пункт акта', type: 'text' },
        { key: 'process_number', label: 'Процесс', type: 'process-picker', required: true, paired: 'process_name' },
        { row: [
            { key: 'pocket', label: 'Карман', type: 'select', options: FR_POCKET_OPTIONS },
            { key: 'risk', label: 'Риск', type: 'select', options: FR_RISK_OPTIONS },
        ]},
        { key: 'deviation_description', label: 'Содержание отклонения', type: 'textarea', rows: 3 },
        { key: 'deviation_reason', label: 'Причина отклонения', type: 'textarea', rows: 2 },
        { key: 'deviation_consequence', label: 'Последствия отклонения', type: 'textarea', rows: 2 },
        { key: 'real_loss', label: 'Реальные потери', type: 'checkbox' },
        { row: [
            { key: 'rev_start_dt', label: 'Начало проверки', type: 'date' },
            { key: 'rev_end_dt', label: 'Конец проверки', type: 'date' },
        ]},
        { key: 'process_owner', label: 'Владелец процесса', type: 'text' },
        { key: 'inspection_name', label: 'Наименование проверки', type: 'text' },
        { key: 'sberdocs_ctrl_assgn_number', label: '№ контр. поручения SberDocs', type: 'text' },
        { row: [
            { key: 'assigment_id', label: 'ID поручения', type: 'number' },
            { key: 'assigment_format', label: 'Формат', type: 'text' },
        ]},
        { key: 'assigment_recommendation', label: 'Рекомендация поручения', type: 'textarea', rows: 2 },
        { key: 'execution_deadline', label: 'Срок исполнения', type: 'date' },
        { key: 'used_pm_lib', label: 'Реализуемая поставка', type: 'text' },
        { key: 'ck_comment', label: 'Комментарий ЦК', type: 'textarea', rows: 2 },
        { key: 'reestr_metric_id', label: 'ID реестра метрики', type: 'text' },
    ];

    static dictNames = ['metrics', 'terbanks', 'processes'];
}

window.CkFinResConfig = CkFinResConfig;
