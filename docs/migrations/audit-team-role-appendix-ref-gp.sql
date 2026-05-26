-- Greenplum 6.x — расширяем CHECK на audit_team_members.role значением 'AppendixRef'
-- и выравниваем имя констрейнта с PG (check_role_values → check_audit_team_role_values),
-- чтобы CHECK_CONSTRAINT_MESSAGES возвращал понятный текст пользователю.

ALTER TABLE {SCHEMA}.{PREFIX}audit_team_members
    DROP CONSTRAINT IF EXISTS check_role_values;

ALTER TABLE {SCHEMA}.{PREFIX}audit_team_members
    DROP CONSTRAINT IF EXISTS check_audit_team_role_values;

ALTER TABLE {SCHEMA}.{PREFIX}audit_team_members
    ADD CONSTRAINT check_audit_team_role_values
    CHECK (role IN ('Куратор', 'Руководитель', 'Редактор', 'Участник', 'AppendixRef'));
