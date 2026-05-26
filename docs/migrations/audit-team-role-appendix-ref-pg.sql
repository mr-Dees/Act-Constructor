-- Расширяет CHECK constraint на role в audit_team_members значением 'AppendixRef'.
-- Применять на существующих PostgreSQL-инсталляциях (свежие БД получают схему из schema.sql).

ALTER TABLE {SCHEMA}.{PREFIX}audit_team_members
    DROP CONSTRAINT IF EXISTS check_audit_team_role_values;

ALTER TABLE {SCHEMA}.{PREFIX}audit_team_members
    ADD CONSTRAINT check_audit_team_role_values
    CHECK (role IN ('Куратор', 'Руководитель', 'Редактор', 'Участник', 'AppendixRef'));
