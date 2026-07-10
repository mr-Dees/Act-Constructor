# Удаление колонки `formatting` из `act_textblocks`

Ручная миграция для **уже развёрнутых БД**. Директива владельца: контейнерный
объект форматирования текстблока (`{fontSize, alignment}`) вырезан целиком —
размер, выравнивание и начертание живут в inline-HTML поля `content`. Колонка
`formatting` и её CHECK-констрейнт (`check_formatting_is_object`) убраны из обеих
схем-миграций (`postgresql/schema.sql`, `greenplum/schema.sql`) и из репозитория
(`app/domains/acts/repositories/act_content.py`: `SELECT`/`INSERT` её не
упоминают).

**Префикс**: `t_db_oarb_audit_act_` (`DATABASE__TABLE_PREFIX` по умолчанию).
Если в `.env` префикс другой — подставить свой.
**Схема для PG**: без квалификатора (схема `public`).
**Схема для GP**: `s_grnplm_ld_audit_da_project_4` (`DATABASE__GP__SCHEMA`;
подставить своё при отличии).

## Зачем это нужно (обязательно на развёрнутых БД)

`create_tables_if_not_exist` на старте создаёт только **отсутствующие таблицы
целиком** и **не делает ALTER** существующих. Поэтому на БД, созданной прежней
схемой, таблица `act_textblocks` сохранит колонку `formatting JSONB NOT NULL`.
Новый код при сохранении акта делает `INSERT` **без** этой колонки — а так как
она `NOT NULL` и без `DEFAULT`, вставка упадёт (`NotNullViolationError`). Пока
колонку не снять `ALTER`-ом (или не пересоздать таблицу), запись текстблоков на
таких БД будет отклоняться. Диагностика дрейфа колонок при старте (WARNING,
см. `developer-guide.md` §6.5.4) поймает только **недостающие** колонки, лишнюю
`formatting` она не подсветит — отслеживать по этому документу.

Снятие безопасно: после вырезания поля колонку не читает и не пишет ни один путь —
загрузка/сохранение текстблоков (`repositories/act_content.py`), копирование при
дублировании акта (`repositories/act_crud.py::copy_textblocks`), а экспортёры
(DOCX/text/markdown) и рендер берут форматирование из `content`. Исторические
значения `formatting` не нужны (обратная совместимость не требуется).

## PostgreSQL (dev-инсталляция)

```sql
ALTER TABLE t_db_oarb_audit_act_act_textblocks DROP COLUMN IF EXISTS formatting;
```

`DROP COLUMN` в PG снимает и связанный `CHECK (check_formatting_is_object)`
автоматически. `IF EXISTS` делает команду идемпотентной (на БД, созданной уже
новой схемой, колонки нет — команда просто ничего не делает).

## Greenplum (прод)

GP 6.x = PostgreSQL 9.4: `DROP COLUMN IF EXISTS` поддерживается. CHECK-констрейнт
снимается вместе с колонкой.

```sql
ALTER TABLE s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_act_textblocks
    DROP COLUMN IF EXISTS formatting;
```

## Проверка

```sql
-- PG
SELECT column_name FROM information_schema.columns
WHERE table_name = 't_db_oarb_audit_act_act_textblocks' AND column_name = 'formatting';
-- ожидается 0 строк
```
