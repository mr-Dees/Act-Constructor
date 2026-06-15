# DROP-команды для всех таблиц приложения

Скрипт для **ручной очистки БД** под Audit Workstation.
**Без `CASCADE`**: таблицы дропаются в обратном порядке FK-зависимостей.

**Префикс**: `t_db_oarb_audit_act_` (значение `DATABASE__TABLE_PREFIX` по умолчанию).
Если в `.env` префикс другой — подставить руками (`s/t_db_oarb_audit_act_/<your_prefix>/g`).

**Схема для PG**: без квалификатора (схема `public`).
**Схема для GP**: `s_grnplm_ld_audit_da_project_4` (значение `DATABASE__GP__SCHEMA` из `.env`; подставить своё при отличии).

**Внимание**:
- **Намеренно без `CASCADE`.** От рабочих таблиц могли быть сделаны зависимые
  объекты — вью, исторические копии/снимки. `CASCADE` снёс бы их вместе с
  таблицей, в т.ч. исторические данные. Поэтому дропаем строго в обратном
  порядке FK-зависимостей. Если на таблице висит чужой зависимый объект, `DROP`
  упадёт с ошибкой зависимости — это **сигнал разобраться вручную**, а не молча
  потерять данные. Запускать в инструменте, который НЕ останавливает весь
  батч на первой ошибке (psql без `ON_ERROR_STOP`, DBeaver «Execute script»),
  чтобы единичная зависимость не оборвала остальной сброс.
- В GP-разделе таблицы доменов `ck_fin_res`, `ck_client_exp`, `ua_data` **НЕ перечислены** — это внешние данные, управляемые ETL. На PG-инсталляции (dev-режим) они есть в виде реплики и присутствуют в PG-разделе ниже.
- Если задан `CHAT__SCHEMA_NAME` и/или `CHAT__AGENT_CHANNEL__SCHEMA_NAME`, таблицы чата / bus-таблица создаются в указанной схеме — дропать их в ней, а не в основной.
- **Bus-таблица — без app-префикса**: её имя задаётся `CHAT__AGENT_CHANNEL__TABLE_NAME` целиком (дефолт `chat_agent_messages_bus`, **без** `DATABASE__TABLE_PREFIX`). Здесь подставлено фактическое имя из `.env` (`t_db_oarb_audit_act_chat_agent_messages_bus`). Если задано другое — подставить его.
- **Legacy-таблицы** (`agent_messages` — старая bus до переименования, `chat_message_feedback`) могли остаться от прежних версий схемы. Они в списках ниже, дропаются тем же `DROP TABLE IF EXISTS` (без `CASCADE`). Если в них лежат нужные исторические данные — закомментируйте эти строки.
- VIEW дропаются ДО таблиц, на которые они ссылаются.
- Sequences дропаются ПОСЛЕ таблиц, у которых они в DEFAULT.

> **Важно про пересоздание.** Приложение на старте (`create_tables_if_not_exist`)
> создаёт только **ОТСУТСТВУЮЩИЕ таблицы целиком** и НЕ добавляет новые колонки в
> уже существующую таблицу (проверяется лишь наличие таблиц). Поэтому при
> изменении схемы существующей таблицы нужен либо полный дроп этой таблицы (этот
> скрипт) и пересоздание, либо ручной `ALTER TABLE`. Чтобы такое расхождение не
> всплывало рантайм-ошибкой (`UndefinedColumnError`), при старте работает
> диагностика: если таблица существует, но устарела по колонкам, в лог пишется
> WARNING со списком недостающих колонок (см. `developer-guide.md` §6.5.4).

---

## 1. PostgreSQL (dev-инсталляция)

```sql
-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  VIEW (ck_fin_res, ck_client_exp)                                    ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP VIEW IF EXISTS v_db_oarb_ck_fr_validation;
DROP VIEW IF EXISTS v_db_oarb_ck_cs_validation;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Домен CHAT (зависимые → родительские)                              ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP TABLE IF EXISTS t_db_oarb_audit_act_chat_audit_log;
DROP TABLE IF EXISTS t_db_oarb_audit_act_chat_tool_metrics;
DROP TABLE IF EXISTS t_db_oarb_audit_act_chat_agent_messages_bus;
DROP TABLE IF EXISTS t_db_oarb_audit_act_chat_files;
DROP TABLE IF EXISTS t_db_oarb_audit_act_chat_messages;
DROP TABLE IF EXISTS t_db_oarb_audit_act_chat_conversations;
-- Legacy chat-таблицы (от прежних версий схемы)
DROP TABLE IF EXISTS t_db_oarb_audit_act_agent_messages;
DROP TABLE IF EXISTS t_db_oarb_audit_act_chat_message_feedback;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Домен NOTIFICATIONS (центр уведомлений)                            ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP TABLE IF EXISTS t_db_oarb_audit_act_notification_state;
DROP TABLE IF EXISTS t_db_oarb_audit_act_notifications;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Домен ACTS (зависимые → родительские)                              ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP TABLE IF EXISTS t_db_oarb_audit_act_audit_log;
DROP TABLE IF EXISTS t_db_oarb_audit_act_act_content_versions;
DROP TABLE IF EXISTS t_db_oarb_audit_act_act_invoices;
DROP TABLE IF EXISTS t_db_oarb_audit_act_act_violations;
DROP TABLE IF EXISTS t_db_oarb_audit_act_act_textblocks;
DROP TABLE IF EXISTS t_db_oarb_audit_act_act_tables;
DROP TABLE IF EXISTS t_db_oarb_audit_act_act_tree;
DROP TABLE IF EXISTS t_db_oarb_audit_act_act_directives;
DROP TABLE IF EXISTS t_db_oarb_audit_act_audit_team_members;
DROP TABLE IF EXISTS t_db_oarb_audit_act_acts;

-- Реестр Hive-таблиц (PG-реплика; на GP управляется ETL)
DROP TABLE IF EXISTS t_db_oarb_ua_hadoop_tables;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Домен ADMIN (зависимые → родительские)                             ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP TABLE IF EXISTS t_db_oarb_audit_act_admin_http_metrics;
DROP TABLE IF EXISTS t_db_oarb_audit_act_admin_audit_log;
DROP TABLE IF EXISTS t_db_oarb_audit_act_access_denied_audit;
DROP TABLE IF EXISTS t_db_oarb_audit_act_app_singleton_lock;
DROP TABLE IF EXISTS t_db_oarb_audit_act_user_roles;
DROP TABLE IF EXISTS t_db_oarb_audit_act_roles;

-- Standalone sequence admin-домена (не owned через BIGSERIAL → DROP TABLE её не удаляет)
DROP SEQUENCE IF EXISTS t_db_oarb_audit_act_access_denied_audit_id_seq;

-- Справочник пользователей (PG-реплика; на GP управляется ETL)
DROP TABLE IF EXISTS t_db_oarb_ua_user;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Домен CK_FIN_RES                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP TABLE IF EXISTS t_db_oarb_ck_fr_validation;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Домен CK_CLIENT_EXP                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP TABLE IF EXISTS t_db_oarb_ck_cs_validation;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Домен UA_DATA (справочники и факты)                                ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP TABLE IF EXISTS t_db_oarb_ua_violation_ior_metric;
DROP TABLE IF EXISTS t_db_oarb_ua_violation_mkr_metric;
DROP TABLE IF EXISTS t_db_oarb_ua_violation_cs_metric;
DROP TABLE IF EXISTS t_db_oarb_ua_violation_fr_metric;
DROP TABLE IF EXISTS t_db_oarb_ua_violation_facts;
DROP TABLE IF EXISTS t_db_oarb_ua_violation_clients;
DROP TABLE IF EXISTS t_db_oarb_ua_sub_number;
DROP TABLE IF EXISTS t_db_oarb_ua_team_member_by_km;
DROP TABLE IF EXISTS t_db_oarb_ua_team_dict;
DROP TABLE IF EXISTS t_db_oarb_ua_violation_risk_type_dict;
DROP TABLE IF EXISTS t_db_oarb_ua_violation_metric_dict;
DROP TABLE IF EXISTS t_db_oarb_ua_departments;
DROP TABLE IF EXISTS t_db_oarb_ua_subsidiary_dict;
DROP TABLE IF EXISTS t_db_oarb_ua_product_dict;
DROP TABLE IF EXISTS t_db_oarb_ua_channel_dict;
DROP TABLE IF EXISTS t_db_oarb_ua_vsp_dict;
DROP TABLE IF EXISTS t_db_oarb_ua_gosb_dict;
DROP TABLE IF EXISTS t_db_oarb_ua_terbank_dict;
DROP TABLE IF EXISTS t_db_oarb_ua_process_dict;
```

---

## 2. Greenplum (прод-инсталляция)

> Схема `s_grnplm_ld_audit_da_project_4` (значение `DATABASE__GP__SCHEMA` из `.env`; подставить своё при отличии).
> Таблицы доменов `ck_fin_res`, `ck_client_exp`, `ua_data` НЕ дропать — это внешние данные ETL.

```sql
-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Домен CHAT (зависимые → родительские)                              ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_chat_audit_log;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_chat_tool_metrics;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_chat_agent_messages_bus;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_chat_files;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_chat_messages;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_chat_conversations;
-- Legacy chat-таблицы (от прежних версий схемы)
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_agent_messages;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_chat_message_feedback;

-- Sequences chat-домена
DROP SEQUENCE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_chat_tool_metrics_id_seq;
DROP SEQUENCE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_chat_audit_log_id_seq;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Домен NOTIFICATIONS (центр уведомлений)                            ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_notification_state;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_notifications;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Домен ACTS (зависимые → родительские)                              ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_audit_log;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_act_content_versions;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_act_invoices;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_act_violations;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_act_textblocks;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_act_tables;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_act_tree;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_act_directives;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_audit_team_members;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_acts;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Домен ADMIN (зависимые → родительские)                             ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_admin_http_metrics;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_admin_audit_log;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_access_denied_audit;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_app_singleton_lock;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_user_roles;
DROP TABLE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_roles;

-- Sequences admin-домена (standalone: PK+DISTRIBUTED BY (id) не допускает BIGSERIAL)
DROP SEQUENCE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_admin_http_metrics_id_seq;
DROP SEQUENCE IF EXISTS s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_access_denied_audit_id_seq;
```

---

## Проверка после дропа

```sql
-- PG
SELECT tablename FROM pg_tables
WHERE tablename LIKE 't_db_oarb_audit_act_%'
ORDER BY tablename;
-- Ожидается: 0 строк.

-- GP
SELECT tablename FROM pg_tables
WHERE schemaname = 's_grnplm_ld_audit_da_project_4'
  AND tablename LIKE 't_db_oarb_audit_act_%'
ORDER BY tablename;
-- Ожидается: 0 строк.
```

После дропа при следующем старте `uvicorn` приложение пересоздаст все таблицы из миграций
(`app/domains/*/migrations/{postgresql,greenplum}/schema.sql` через `create_tables_if_not_exist`).
