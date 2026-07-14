# Миграция: колонка `invoices_data` в `act_content_versions`

Снимок версии содержимого акта (`act_content_versions`) раньше хранил 4 блоба
(`tree_data`, `tables_data`, `textblocks_data`, `violations_data`). Фактуры
(`act_invoices`) в снимок не попадали → диффу версий были принципиально
недоступны. Добавлен 5-й блоб `invoices_data JSONB` — привязка `node_id` →
реквизиты фактуры на момент создания версии.

## Что изменилось в схемах

В `CREATE TABLE {SCHEMA}.{PREFIX}act_content_versions` (обе схемы —
`app/domains/acts/migrations/postgresql/schema.sql` и
`app/domains/acts/migrations/greenplum/schema.sql`) добавлена колонка:

```sql
invoices_data JSONB NOT NULL DEFAULT '{}',
```

`DISTRIBUTED BY (act_id)` и первичный ключ НЕ затронуты (новая колонка —
не ключевая). JSONB поддерживается на Greenplum 6.x (= PostgreSQL 9.4).

## Ручной ALTER для УЖЕ РАЗВЁРНУТЫХ БД

`create_tables_if_not_exist` создаёт только ОТСУТСТВУЮЩИЕ таблицы целиком и
**не добавляет колонки** в существующие (ALTER-миграций в приложении нет —
см. developer-guide §6.5). На уже развёрнутой БД новая колонка сама НЕ появится:
пока её нет, стартовая диагностика дрейфа (`_warn_on_stale_tables`) напишет
WARNING про недостающую колонку (только лог, старт не блокируется), а чтение/
запись снимков упадёт `UndefinedColumnError`. Выполнить руками один раз:

### PostgreSQL

```sql
ALTER TABLE t_db_oarb_audit_act_act_content_versions
    ADD COLUMN invoices_data JSONB NOT NULL DEFAULT '{}';
```

(`t_db_oarb_audit_act_` — значение `DATABASE__TABLE_PREFIX`; схема `public`,
квалификатор не нужен.)

### Greenplum

```sql
ALTER TABLE s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_act_content_versions
    ADD COLUMN invoices_data JSONB NOT NULL DEFAULT '{}';
```

(схема — значение `DATABASE__GP__SCHEMA`, префикс — `DATABASE__TABLE_PREFIX`.)

GP 6.x НЕ поддерживает `ADD COLUMN IF NOT EXISTS` (это PG 9.6) — запускать
ровно один раз. `DEFAULT '{}' NOT NULL` заполнит существующие строки пустым
блобом: старые снимки после ALTER читаются как «версия без фактур» — при диффе
все текущие фактуры покажутся добавленными. Это приемлемо (обратная
совместимость данных снимков не требуется).

## Наполнение и дифф

- Снимок наполняется в `ActContentVersionRepository.create_version` из фактур
  акта на момент версии (`ActInvoiceRepository.get_invoices_for_act` →
  `{node_id: реквизиты}`), собираемых сервисом (`ActContentService.save_content`
  и `AuditLogService.restore_version`).
- Форма блоба совпадает с полем `invoices` из `GET /acts/{id}/content` (та же
  сторона диффа для текущего содержимого).
- Фронт: `DiffEngine._diffInvoices` сравнивает привязки по `node_id`
  (added/removed/modified по реквизитам), `DiffRenderer` рендерит их у узла-владельца.
