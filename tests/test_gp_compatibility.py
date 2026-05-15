"""Тесты совместимости Greenplum-схем с PostgreSQL 9.4 и SQL-сплиттер."""

import re

import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import asyncpg

from app.db.adapters.base import DatabaseAdapter
from app.db.adapters.greenplum import GreenplumAdapter


# ---------------------------------------------------------------------------
# 1. Статический анализ: совместимость GP-схем с PostgreSQL 9.4
# ---------------------------------------------------------------------------


class TestGreenplumSchemaCompatibility:
    """Статический анализ Greenplum-схем на совместимость с PostgreSQL 9.4."""

    @pytest.fixture
    def gp_schema_files(self):
        """Находит все greenplum schema.sql файлы (непустые)."""
        base = Path(__file__).parent.parent / "app" / "domains"
        schemas = list(base.glob("*/migrations/greenplum/schema.sql"))
        # Фильтруем только непустые (не заглушки)
        return [s for s in schemas if s.stat().st_size > 100]

    def _find_violations(self, gp_schema_files, pattern):
        """Общий хелпер для поиска нарушений по regex-паттерну."""
        violations = []
        for schema in gp_schema_files:
            content = schema.read_text(encoding='utf-8')
            matches = pattern.findall(content)
            if matches:
                violations.append(f"{schema}: {len(matches)} вхождений")
        return violations

    def test_no_create_index_if_not_exists(self, gp_schema_files):
        """CREATE INDEX IF NOT EXISTS не поддерживается в PostgreSQL 9.4 / Greenplum 6."""
        pattern = re.compile(r'CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS', re.IGNORECASE)
        violations = self._find_violations(gp_schema_files, pattern)
        assert not violations, (
            f"CREATE INDEX IF NOT EXISTS не поддерживается в GP 6:\n"
            + "\n".join(violations)
        )

    def test_no_on_conflict(self, gp_schema_files):
        """ON CONFLICT (INSERT ... ON CONFLICT DO NOTHING/UPDATE) не поддерживается в PG 9.4."""
        pattern = re.compile(r'ON\s+CONFLICT', re.IGNORECASE)
        violations = self._find_violations(gp_schema_files, pattern)
        assert not violations, (
            f"ON CONFLICT не поддерживается в GP 6:\n"
            + "\n".join(violations)
        )

    def test_no_add_column_if_not_exists(self, gp_schema_files):
        """ALTER TABLE ... ADD COLUMN IF NOT EXISTS не поддерживается в PG 9.4."""
        pattern = re.compile(r'ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS', re.IGNORECASE)
        violations = self._find_violations(gp_schema_files, pattern)
        assert not violations, (
            f"ADD COLUMN IF NOT EXISTS не поддерживается в GP 6:\n"
            + "\n".join(violations)
        )

    def test_no_create_sequence_if_not_exists(self, gp_schema_files):
        """CREATE SEQUENCE IF NOT EXISTS не поддерживается в PG 9.4."""
        pattern = re.compile(r'CREATE\s+SEQUENCE\s+IF\s+NOT\s+EXISTS', re.IGNORECASE)
        violations = self._find_violations(gp_schema_files, pattern)
        assert not violations, (
            f"CREATE SEQUENCE IF NOT EXISTS не поддерживается в GP 6:\n"
            + "\n".join(violations)
        )

    def test_no_jsonb_set(self, gp_schema_files):
        """Функция jsonb_set() не поддерживается в PG 9.4."""
        pattern = re.compile(r'jsonb_set\s*\(', re.IGNORECASE)
        violations = self._find_violations(gp_schema_files, pattern)
        assert not violations, (
            f"jsonb_set() не поддерживается в GP 6:\n"
            + "\n".join(violations)
        )

    def test_no_jsonb_pretty(self, gp_schema_files):
        """Функция jsonb_pretty() не поддерживается в PG 9.4."""
        pattern = re.compile(r'jsonb_pretty\s*\(', re.IGNORECASE)
        violations = self._find_violations(gp_schema_files, pattern)
        assert not violations, (
            f"jsonb_pretty() не поддерживается в GP 6:\n"
            + "\n".join(violations)
        )

    def test_no_tablesample(self, gp_schema_files):
        """TABLESAMPLE не поддерживается в PG 9.4."""
        pattern = re.compile(r'TABLESAMPLE', re.IGNORECASE)
        violations = self._find_violations(gp_schema_files, pattern)
        assert not violations, (
            f"TABLESAMPLE не поддерживается в GP 6:\n"
            + "\n".join(violations)
        )

    def test_no_on_delete_cascade(self, gp_schema_files):
        """ON DELETE CASCADE / ON DELETE SET NULL на REFERENCES не поддерживается в GP 6."""
        pattern = re.compile(r'ON\s+DELETE\s+(CASCADE|SET\s+NULL)', re.IGNORECASE)
        violations = self._find_violations(gp_schema_files, pattern)
        assert not violations, (
            f"ON DELETE CASCADE/SET NULL не поддерживается в GP 6:\n"
            + "\n".join(violations)
        )

    def test_distributed_by_subset_of_primary_key(self, gp_schema_files):
        """GP 6: если у таблицы есть и PRIMARY KEY, и DISTRIBUTED BY,
        то столбцы DISTRIBUTED BY обязаны быть подмножеством PRIMARY KEY
        (то же правило для UNIQUE-констрейнтов). Нарушение → InvalidTableDefinitionError
        при CREATE TABLE."""
        pk_pattern = re.compile(r'PRIMARY\s+KEY\s*\(([^)]+)\)', re.IGNORECASE)
        uq_pattern = re.compile(r'\bUNIQUE\s*\(([^)]+)\)', re.IGNORECASE)
        dist_pattern = re.compile(r'DISTRIBUTED\s+BY\s*\(([^)]+)\)', re.IGNORECASE)
        name_pattern = re.compile(
            r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)',
            re.IGNORECASE,
        )

        def _cols(s):
            return {c.strip().lower() for c in s.split(',') if c.strip()}

        violations = []
        for schema in gp_schema_files:
            content = schema.read_text(encoding='utf-8')
            # _split_sql_statements корректно игнорирует ; внутри комментариев
            # и строковых литералов — нельзя резать regex'ом по ';'.
            for raw_stmt in DatabaseAdapter._split_sql_statements(content):
                # Вырезаем line-комментарии: они могут содержать
                # документацию вида "-- DISTRIBUTED BY (col)" и сбить регекс.
                stmt = re.sub(r'--[^\n]*', '', raw_stmt)
                if not re.search(r'\bCREATE\s+TABLE\b', stmt, re.IGNORECASE):
                    continue
                dist_match = dist_pattern.search(stmt)
                if not dist_match:
                    continue
                dist_cols = _cols(dist_match.group(1))
                name_match = name_pattern.search(stmt)
                table = name_match.group(1) if name_match else '?'

                pk_match = pk_pattern.search(stmt)
                if pk_match:
                    pk_cols = _cols(pk_match.group(1))
                    if not dist_cols.issubset(pk_cols):
                        violations.append(
                            f"{schema.parent.parent.parent.name}/{table}: "
                            f"DIST {sorted(dist_cols)} ⊄ PK {sorted(pk_cols)}"
                        )
                for uq_match in uq_pattern.finditer(stmt):
                    uq_cols = _cols(uq_match.group(1))
                    if not dist_cols.issubset(uq_cols):
                        violations.append(
                            f"{schema.parent.parent.parent.name}/{table}: "
                            f"DIST {sorted(dist_cols)} ⊄ UNIQUE {sorted(uq_cols)}"
                        )

        assert not violations, (
            "GP-правило: DISTRIBUTED BY должен быть подмножеством PRIMARY KEY "
            "и каждого UNIQUE-констрейнта.\n" + "\n".join(violations)
        )

    def test_chat_domain_migration_discovered(self, gp_schema_files):
        """GP-миграция домена chat обнаруживается автоматически."""
        domain_names = {s.parent.parent.parent.name for s in gp_schema_files}
        assert "chat" in domain_names, (
            f"Миграция chat не найдена среди GP-схем. "
            f"Обнаруженные домены: {sorted(domain_names)}"
        )

    def test_chat_gp_schema_has_agent_bridge_tables(self):
        """Новые agent_* таблицы добавлены в GP-схему чата и используют {SCHEMA}.{PREFIX}."""
        schema_path = (
            Path(__file__).parent.parent
            / "app" / "domains" / "chat" / "migrations" / "greenplum" / "schema.sql"
        )
        content = schema_path.read_text(encoding="utf-8")

        # Все 3 таблицы должны присутствовать с placeholder'ами схемы и префикса
        for table in ("agent_requests", "agent_response_events", "agent_responses"):
            assert f"CREATE TABLE IF NOT EXISTS {{SCHEMA}}.{{PREFIX}}{table}" in content, \
                f"Таблица {table} не найдена с {{SCHEMA}}.{{PREFIX}}-префиксом в GP-схеме"

        # Sequence для events
        assert "CREATE SEQUENCE {SCHEMA}.{PREFIX}agent_response_events_id_seq" in content

        # Все индексы используют idx_{PREFIX}*.
        # idx_{PREFIX}agent_responses_request не нужен: UNIQUE(request_id) уже создаёт индекс.
        for idx_name in (
            "idx_{PREFIX}agent_requests_status_created",
            "idx_{PREFIX}agent_requests_message",
            "idx_{PREFIX}agent_response_events_request",
        ):
            assert idx_name in content, f"Индекс {idx_name} не найден в GP-схеме"


# ---------------------------------------------------------------------------
# 2. SQL Statement Splitter (_split_sql_statements)
# ---------------------------------------------------------------------------


class TestSplitSqlStatements:
    """Тесты разделения SQL на отдельные операторы."""

    def test_simple_statements(self):
        """Разделяет простые операторы по точке с запятой."""
        sql = "CREATE TABLE t (id INT); CREATE INDEX idx ON t(id);"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 2

    def test_dollar_quoting(self):
        """Не разбивает внутри $$ ... $$."""
        sql = """
CREATE FUNCTION f() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE t (id INT);
"""
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 2
        assert 'CREATE FUNCTION' in stmts[0]
        assert 'CREATE TABLE' in stmts[1]

    def test_single_quotes(self):
        """Не разбивает внутри строковых литералов."""
        sql = "INSERT INTO t (v) VALUES ('hello; world');"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 1

    def test_escaped_quotes(self):
        """Обрабатывает экранированные кавычки ''."""
        sql = "INSERT INTO t (v) VALUES ('it''s; fine');"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 1

    def test_line_comments(self):
        """Игнорирует ; в однострочных комментариях."""
        sql = "-- comment; with semicolon\nCREATE TABLE t (id INT);"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 1

    def test_empty_input(self):
        """Пустая строка возвращает пустой список."""
        stmts = DatabaseAdapter._split_sql_statements("")
        assert stmts == []

    def test_comments_only(self):
        """Только комментарии — нет операторов."""
        sql = "-- just a comment\n-- another comment"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert stmts == []

    def test_multiline_statement(self):
        """Многострочный оператор — один результат."""
        sql = """
CREATE TABLE t (
    id INT,
    name VARCHAR(50)
);
"""
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 1

    def test_real_greenplum_schema_pattern(self):
        """Проверяет разбиение типичного GP-паттерна."""
        sql = """
CREATE TABLE IF NOT EXISTS schema.prefix_acts (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

COMMENT ON TABLE schema.prefix_acts IS 'Test table';

CREATE INDEX idx_test ON schema.prefix_acts(name);

CREATE OR REPLACE FUNCTION schema.update_fn()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_test ON schema.prefix_acts;
CREATE TRIGGER trg_test
    BEFORE UPDATE ON schema.prefix_acts
    FOR EACH ROW
    EXECUTE PROCEDURE schema.update_fn();
"""
        stmts = DatabaseAdapter._split_sql_statements(sql)
        # CREATE TABLE, COMMENT, CREATE INDEX, CREATE FUNCTION, DROP TRIGGER, CREATE TRIGGER
        assert len(stmts) == 6

    def test_no_trailing_semicolon(self):
        """Обрабатывает SQL без финального ;"""
        sql = "CREATE TABLE t (id INT)"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 1

    def test_where_clause_with_semicolon_in_string(self):
        """Не разбивает при ; внутри строк в WHERE."""
        sql = "INSERT INTO t (v) VALUES ('a;b'); SELECT 1;"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 2

    def test_comment_on_with_quotes(self):
        """COMMENT ON с кавычками и ; внутри строки."""
        sql = "COMMENT ON TABLE t IS 'It''s a; table';"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 1

    def test_multiple_dollar_quoted_functions(self):
        """Несколько функций с $$ блоками."""
        sql = """
CREATE FUNCTION f1() RETURNS VOID AS $$
BEGIN
    RAISE NOTICE 'hello;';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION f2() RETURNS VOID AS $$
BEGIN
    RAISE NOTICE 'world;';
END;
$$ LANGUAGE plpgsql;
"""
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 2
        assert 'f1' in stmts[0]
        assert 'f2' in stmts[1]

    def test_whitespace_only(self):
        """Пробелы и переносы строк — нет операторов."""
        sql = "   \n\n   \t  "
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert stmts == []

    def test_semicolons_only(self):
        """Только точки с запятой — нет реальных операторов."""
        sql = ";;;"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert stmts == []

    def test_tagged_dollar_quoting(self):
        """Не разбивает внутри $tag$ ... $tag$."""
        sql = """
CREATE FUNCTION f() RETURNS TRIGGER AS $body$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$body$ LANGUAGE plpgsql;

CREATE TABLE t (id INT);
"""
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 2
        assert 'CREATE FUNCTION' in stmts[0]
        assert '$body$' in stmts[0]
        assert 'CREATE TABLE' in stmts[1]

    def test_block_comments(self):
        """Игнорирует ; внутри блочных комментариев /* ... */."""
        sql = "/* comment; with semicolon */\nCREATE TABLE t (id INT);"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 1
        assert 'CREATE TABLE' in stmts[0]

    def test_block_comments_only(self):
        """Только блочные комментарии — нет операторов."""
        sql = "/* just a comment; here */ /* another */;"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert stmts == []

    def test_block_comment_multiline(self):
        """Многострочный блочный комментарий с ;."""
        sql = """
/* This is a
   multi-line comment;
   with semicolons; everywhere */
CREATE TABLE t (id INT);
"""
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 1


# ---------------------------------------------------------------------------
# 3. Извлечение имени домена из пути к schema.sql
# ---------------------------------------------------------------------------


class TestDomainNameExtraction:
    """Проверяет корректное извлечение имени домена из пути к schema.sql."""

    def test_domain_name_from_schema_path(self):
        """schema_path.parent.parent.parent.name == имя домена."""
        base = Path(__file__).parent.parent / "app" / "domains"
        found_any = False
        for domain_dir in base.iterdir():
            if not domain_dir.is_dir():
                continue
            for db_type in ("postgresql", "greenplum"):
                schema = domain_dir / "migrations" / db_type / "schema.sql"
                if schema.exists():
                    found_any = True
                    domain_name = schema.parent.parent.parent.name
                    assert domain_name == domain_dir.name, (
                        f"Имя домена из {schema} = '{domain_name}', "
                        f"ожидалось '{domain_dir.name}'"
                    )
        assert found_any, "Не найдено ни одного schema.sql для проверки"

    def test_path_structure_depth(self):
        """Проверяет что все schema.sql расположены на ожидаемой глубине."""
        base = Path(__file__).parent.parent / "app" / "domains"
        for schema in base.glob("*/migrations/*/schema.sql"):
            # schema.parent = postgresql/ или greenplum/
            # schema.parent.parent = migrations/
            # schema.parent.parent.parent = domain_dir/
            assert schema.parent.parent.name == "migrations", (
                f"Родительская директория должна быть 'migrations', "
                f"получено '{schema.parent.parent.name}' для {schema}"
            )
            assert schema.parent.name in ("postgresql", "greenplum"), (
                f"Тип БД должен быть 'postgresql' или 'greenplum', "
                f"получено '{schema.parent.name}' для {schema}"
            )


# ---------------------------------------------------------------------------
# 4. Пооператорное выполнение SQL в Greenplum-адаптере
# ---------------------------------------------------------------------------


class TestGreenplumStatementExecution:
    """Тесты пооператорного выполнения SQL в Greenplum-адаптере."""

    @pytest.fixture
    def adapter(self):
        return GreenplumAdapter(schema="test_schema", table_prefix="test_")

    @pytest.fixture
    def conn(self):
        """Mock asyncpg connection."""
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(return_value=None)
        mock_conn.fetch = AsyncMock(return_value=[])
        return mock_conn

    async def test_duplicate_index_continues(self, adapter, conn, tmp_path):
        """DuplicateObjectError на одном индексе не останавливает выполнение остальных."""
        schema_dir = tmp_path / "testdomain" / "migrations" / "greenplum"
        schema_dir.mkdir(parents=True)
        schema = schema_dir / "schema.sql"
        schema.write_text(
            "CREATE TABLE test_schema.test_t (id INT);\n"
            "CREATE INDEX idx_1 ON test_schema.test_t(id);\n"
            "CREATE INDEX idx_2 ON test_schema.test_t(id);\n",
            encoding='utf-8'
        )

        call_count = 0

        async def side_effect(sql):
            nonlocal call_count
            call_count += 1
            if 'idx_1' in sql:
                raise asyncpg.DuplicateObjectError("already exists")
            return None

        conn.execute = AsyncMock(side_effect=side_effect)
        # pre-check: нет таблиц; post-verify: таблица создана
        conn.fetch.side_effect = [
            [],                                         # pre-check
            [{"tablename": "test_t"}],                  # post-verify
        ]

        await adapter.create_tables(conn, [schema])

        # Все 3 оператора должны быть выполнены
        assert call_count == 3

    async def test_duplicate_table_continues(self, adapter, conn, tmp_path):
        """DuplicateTableError не останавливает выполнение остальных операторов."""
        schema_dir = tmp_path / "testdomain" / "migrations" / "greenplum"
        schema_dir.mkdir(parents=True)
        schema = schema_dir / "schema.sql"
        schema.write_text(
            "CREATE TABLE test_schema.test_t1 (id INT);\n"
            "CREATE TABLE test_schema.test_t2 (id INT);\n",
            encoding='utf-8'
        )

        call_count = 0

        async def side_effect(sql):
            nonlocal call_count
            call_count += 1
            if 'test_t1' in sql:
                raise asyncpg.DuplicateTableError("already exists")
            return None

        conn.execute = AsyncMock(side_effect=side_effect)
        conn.fetch.side_effect = [
            [],
            [{"tablename": "test_t1"}, {"tablename": "test_t2"}],
        ]

        await adapter.create_tables(conn, [schema])
        assert call_count == 2

    async def test_syntax_error_propagates(self, adapter, conn, tmp_path):
        """Реальные синтаксические ошибки пробрасываются."""
        schema_dir = tmp_path / "testdomain" / "migrations" / "greenplum"
        schema_dir.mkdir(parents=True)
        schema = schema_dir / "schema.sql"
        schema.write_text(
            "CREATE TABLE test_schema.test_t (id INT);\n"
            "INVALID SQL STATEMENT;\n",
            encoding='utf-8'
        )

        async def side_effect(sql):
            if 'INVALID' in sql:
                raise asyncpg.PostgresSyntaxError("syntax error")
            return None

        conn.execute = AsyncMock(side_effect=side_effect)
        conn.fetch.side_effect = [
            [],   # pre-check
        ]

        with pytest.raises(asyncpg.PostgresSyntaxError):
            await adapter.create_tables(conn, [schema])

    async def test_generic_exception_propagates(self, adapter, conn, tmp_path):
        """Неожиданные исключения пробрасываются."""
        schema_dir = tmp_path / "testdomain" / "migrations" / "greenplum"
        schema_dir.mkdir(parents=True)
        schema = schema_dir / "schema.sql"
        schema.write_text(
            "CREATE TABLE test_schema.test_err (id INT);\n",
            encoding='utf-8'
        )

        conn.execute = AsyncMock(side_effect=RuntimeError("unexpected failure"))
        conn.fetch.side_effect = [[], []]

        with pytest.raises(RuntimeError, match="unexpected failure"):
            await adapter.create_tables(conn, [schema])

    async def test_all_statements_executed_in_order(self, adapter, conn, tmp_path):
        """Все операторы выполняются последовательно."""
        schema_dir = tmp_path / "testdomain" / "migrations" / "greenplum"
        schema_dir.mkdir(parents=True)
        schema = schema_dir / "schema.sql"
        schema.write_text(
            "CREATE TABLE test_schema.test_t (id INT);\n"
            "CREATE INDEX idx_t ON test_schema.test_t(id);\n"
            "COMMENT ON TABLE test_schema.test_t IS 'Test';\n",
            encoding='utf-8'
        )

        executed = []

        async def side_effect(sql):
            executed.append(sql)
            return None

        conn.execute = AsyncMock(side_effect=side_effect)
        conn.fetch.side_effect = [
            [],                               # pre-check
            [{"tablename": "test_t"}],        # post-verify
        ]

        await adapter.create_tables(conn, [schema])

        assert len(executed) == 3
        assert 'CREATE TABLE' in executed[0]
        assert 'CREATE INDEX' in executed[1]
        assert 'COMMENT ON' in executed[2]

    async def test_schema_prefix_substitution_per_statement(self, adapter, conn, tmp_path):
        """Плейсхолдеры {SCHEMA} и {PREFIX} подставляются до разбиения."""
        schema_dir = tmp_path / "testdomain" / "migrations" / "greenplum"
        schema_dir.mkdir(parents=True)
        schema = schema_dir / "schema.sql"
        schema.write_text(
            "CREATE TABLE {SCHEMA}.{PREFIX}tbl (id INT);\n"
            "CREATE INDEX idx_tbl ON {SCHEMA}.{PREFIX}tbl(id);\n",
            encoding='utf-8'
        )

        executed = []

        async def side_effect(sql):
            executed.append(sql)
            return None

        conn.execute = AsyncMock(side_effect=side_effect)
        conn.fetch.side_effect = [
            [],
            [{"tablename": "test_tbl"}],
        ]

        await adapter.create_tables(conn, [schema])

        assert len(executed) == 2
        for stmt in executed:
            assert '{SCHEMA}' not in stmt
            assert '{PREFIX}' not in stmt
            assert 'test_schema.test_tbl' in stmt

    async def test_function_with_dollar_quoting_single_statement(self, adapter, conn, tmp_path):
        """Функция с $$ блоком выполняется как один оператор."""
        schema_dir = tmp_path / "testdomain" / "migrations" / "greenplum"
        schema_dir.mkdir(parents=True)
        schema = schema_dir / "schema.sql"
        schema.write_text(
            "CREATE TABLE test_schema.test_t (id INT);\n"
            "\n"
            "CREATE OR REPLACE FUNCTION test_schema.update_fn()\n"
            "RETURNS TRIGGER AS $$\n"
            "BEGIN\n"
            "    NEW.updated_at = CURRENT_TIMESTAMP;\n"
            "    RETURN NEW;\n"
            "END;\n"
            "$$ LANGUAGE plpgsql;\n",
            encoding='utf-8'
        )

        executed = []

        async def side_effect(sql):
            executed.append(sql)
            return None

        conn.execute = AsyncMock(side_effect=side_effect)
        conn.fetch.side_effect = [
            [],
            [{"tablename": "test_t"}],
        ]

        await adapter.create_tables(conn, [schema])

        assert len(executed) == 2
        # Функция должна быть единым оператором с $$ блоком
        assert '$$' in executed[1]
        assert 'CREATE OR REPLACE FUNCTION' in executed[1]
