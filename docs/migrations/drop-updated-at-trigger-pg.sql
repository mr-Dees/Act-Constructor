-- Cleanup для существующих PostgreSQL-БД: снять триггеры updated_at и функцию.
--
-- Применять ОДИН РАЗ после деплоя кода без триггера. В новых развёртываниях
-- `schema.sql` уже не создаёт ни функцию, ни триггеры — этот файл нужен только
-- для существующих БД, где они были раньше. PG- и GP-схемы синхронизированы:
-- updated_at выставляется явно в SQL репозиториев.
--
-- Подставь {SCHEMA} и {PREFIX} вручную перед выполнением. Например:
--   {SCHEMA} = public
--   {PREFIX} = t_db_oarb_audit_act_

DROP TRIGGER IF EXISTS update_{PREFIX}acts_updated_at        ON {SCHEMA}.{PREFIX}acts;
DROP TRIGGER IF EXISTS update_{PREFIX}act_tree_updated_at    ON {SCHEMA}.{PREFIX}act_tree;
DROP TRIGGER IF EXISTS update_{PREFIX}act_tables_updated_at  ON {SCHEMA}.{PREFIX}act_tables;
DROP TRIGGER IF EXISTS update_{PREFIX}act_textblocks_updated_at ON {SCHEMA}.{PREFIX}act_textblocks;
DROP TRIGGER IF EXISTS update_{PREFIX}act_violations_updated_at ON {SCHEMA}.{PREFIX}act_violations;
DROP TRIGGER IF EXISTS update_{PREFIX}act_invoices_updated_at   ON {SCHEMA}.{PREFIX}act_invoices;

DROP FUNCTION IF EXISTS update_updated_at_column();
