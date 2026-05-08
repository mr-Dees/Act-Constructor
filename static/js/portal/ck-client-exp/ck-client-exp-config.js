/**
 * Конфигурация страницы ЦК Клиентский опыт.
 */
class CkClientExpConfig {
    static apiPrefix = 'ck-client-exp';
    static domainName = 'ck_client_exp';
    static pageTitle = 'ЦК Клиентский опыт';

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
        { key: 'created_at', label: 'Создано', format: (v) => CkClientExpConfig.formatDate(v) },
        { key: 'metric_name', label: 'Метрика' },
        { key: 'km_id', label: '№ КМ' },
        { key: 'metric_amount_rubles', label: 'Сумма (руб.)', align: 'right', format: (v) => CkClientExpConfig.formatNumber(v) },
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
            { key: 'metric_unic_clients', label: 'Уник. клиенты', type: 'number', min: 0 },
            { key: 'metric_element_counts', label: 'Кол-во (шт.)', type: 'number', min: 0, width: '90px' },
        ]},
        { key: 'metric_amount_rubles', label: 'Сумма (руб.)', type: 'number', min: 0 },
        { row: [
            { key: 'is_sent_to_top_brass', label: 'На НС', type: 'checkbox', width: '120px' },
            { key: 'ck_comment', label: 'Комментарий ЦК', type: 'textarea', rows: 2 },
        ]},
        { key: 'km_id', label: '№ КМ', type: 'text', required: true, mask: 'km' },
        { key: 'act_item_number', label: 'Пункт акта', type: 'text' },
        { key: 'process_number', label: 'Процесс', type: 'process-picker', required: true, paired: 'process_name', paired_extras: [
            { key: 'block_owner', source: 'block_owner' },
            { key: 'department_owner', source: 'department_owner' },
        ]},
        { row: [
            { key: 'block_owner', label: 'Блок', type: 'readonly-text', computed: true },
            { key: 'department_owner', label: 'Подразделение', type: 'readonly-text', computed: true },
        ]},
        { key: 'reestr_metric_id', label: 'ID реестра метрики', type: 'readonly-text' },
    ];

    static dictNames = ['metrics', 'terbanks', 'processes'];
}

window.CkClientExpConfig = CkClientExpConfig;
