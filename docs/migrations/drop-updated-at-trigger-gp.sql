-- Cleanup для прод-Greenplum: снять PL/pgSQL-триггеры updated_at и функцию.
--
-- Применять ОДИН РАЗ после деплоя кода без триггера (см. backend-audit §5.3).
-- В новых развёртываниях `schema.sql` уже не создаёт ни функцию, ни триггеры —
-- этот файл нужен только для существующих БД, где они были раньше.
--
-- Подставь {SCHEMA} и {PREFIX} вручную перед выполнением. Например:
--   {SCHEMA} = s_grnplm_ld_audit_da_project_4
--   {PREFIX} = t_db_oarb_audit_act_

DROP TRIGGER IF EXISTS update_{PREFIX}acts_updated_at        ON {SCHEMA}.{PREFIX}acts;
DROP TRIGGER IF EXISTS update_{PREFIX}act_tree_updated_at    ON {SCHEMA}.{PREFIX}act_tree;
DROP TRIGGER IF EXISTS update_{PREFIX}act_tables_updated_at  ON {SCHEMA}.{PREFIX}act_tables;
DROP TRIGGER IF EXISTS update_{PREFIX}act_textblocks_updated_at ON {SCHEMA}.{PREFIX}act_textblocks;
DROP TRIGGER IF EXISTS update_{PREFIX}act_violations_updated_at ON {SCHEMA}.{PREFIX}act_violations;
DROP TRIGGER IF EXISTS update_{PREFIX}act_invoices_updated_at   ON {SCHEMA}.{PREFIX}act_invoices;

DROP FUNCTION IF EXISTS {SCHEMA}.update_updated_at_column();
