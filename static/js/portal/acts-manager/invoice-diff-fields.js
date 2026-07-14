/**
 * Декларативный контракт полей диффа фактуры (#9, по образцу violation-fields.js).
 *
 * Раньше список реквизитов дублировался: `_diffInvoices` (diff-engine.js) и
 * `_INVOICE_FIELD_LABELS` (diff-renderer.js) хранили параллельные копии одних
 * и тех же 8 ключей в одном и том же порядке — риск рассинхрона при
 * добавлении нового реквизита фактуры. Порядок и метки — из diff-engine.js
 * `_diffInvoices`/diff-renderer.js `_INVOICE_FIELD_LABELS` без изменений
 * (диффа/рендер порядок — user-visible).
 */
export const INVOICE_DIFF_FIELDS = Object.freeze([
    { key: 'db_type', label: 'Источник (БД)' },
    { key: 'schema_name', label: 'Схема' },
    { key: 'table_name', label: 'Таблица' },
    { key: 'node_number', label: 'Пункт' },
    { key: 'profile_div', label: 'Подразделение профиля' },
    { key: 'verification_status', label: 'Статус верификации' },
    { key: 'metrics', label: 'Метрики' },
    { key: 'process', label: 'Процессы' },
]);

export const INVOICE_DIFF_FIELD_KEYS = INVOICE_DIFF_FIELDS.map(f => f.key);

export const INVOICE_FIELD_LABELS = Object.freeze(
    Object.fromEntries(INVOICE_DIFF_FIELDS.map(f => [f.key, f.label]))
);
