"""
Параметризованные тесты для DatabaseAdapter (PostgreSQL и Greenplum).

Фокус: контрактное поведение, общее для обоих адаптеров (через @pytest.fixture(params=...)),
а также adapter-specific ветки (дубликаты для GP, batch-execute для PG).

Дополняет (не дублирует) `tests/test_db_adapters.py` и `tests/test_gp_compatibility.py`.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import asyncpg
import pytest

from app.db.adapters.base import DatabaseAdapter
from app.db.adapters.greenplum import GreenplumAdapter
from app.db.adapters.postgresql import PostgreSQLAdapter

PG_PREFIX = "test_"
GP_SCHEMA = "public_test"
GP_PREFIX = "test_"


# ---------------------------------------------------------------------------
# Параметризованная фикстура: один и тот же тест-кейс прогоняется для обоих
# адаптеров. Каждый параметр несёт ожидаемое имя таблицы и подставленный SQL.
# ---------------------------------------------------------------------------

@pytest.fixture(params=["postgresql", "greenplum"])
def adapter(request):
    """Возвращает PG- или GP-адаптер с фиксированными параметрами."""
    if request.param == "postgresql":
        return PostgreSQLAdapter(table_prefix=PG_PREFIX)
    return GreenplumAdapter(schema=GP_SCHEMA, table_prefix=GP_PREFIX)


@pytest.fixture
def mock_conn():
    """AsyncMock-conn с дефолтными возвратами."""
    c = AsyncMock()
    c.fetch = AsyncMock(return_value=[])
    c.fetchval = AsyncMock()
    c.execute = AsyncMock()
    return c


# ---------------------------------------------------------------------------
# 1. Контракт get_table_name: префикс всегда применяется, схема — только GP.
# ---------------------------------------------------------------------------

class TestGetTableNameContract:

    def test_pg_applies_prefix_only(self):
        a = PostgreSQLAdapter(table_prefix=PG_PREFIX)
        assert a.get_table_name("foo") == "test_foo"

    def test_gp_applies_schema_and_prefix(self):
        a = GreenplumAdapter(schema=GP_SCHEMA, table_prefix=GP_PREFIX)
        assert a.get_table_name("foo") == "public_test.test_foo"

    def test_pg_empty_prefix(self):
        a = PostgreSQLAdapter(table_prefix="")
        assert a.get_table_name("acts") == "acts"

    def test_gp_qualify_table_name_uses_default_schema(self):
        a = GreenplumAdapter(schema=GP_SCHEMA, table_prefix=GP_PREFIX)
        # qualify_table_name НЕ добавляет префикс, только схему
        assert a.qualify_table_name("ref_dict") == "public_test.ref_dict"

    def test_pg_qualify_table_name_no_schema_no_change(self):
        a = PostgreSQLAdapter(table_prefix=PG_PREFIX)
        assert a.qualify_table_name("ref_dict") == "ref_dict"


# ---------------------------------------------------------------------------
# 2. _split_sql_statements — статический метод базового класса.
#    Тестируем общие инварианты: разделение, инлайн-комментарии, строки,
#    dollar-quoting. Эти кейсы переиспользует и PG, и GP.
# ---------------------------------------------------------------------------

class TestSplitSqlStatements:

    def test_basic_split(self):
        stmts = DatabaseAdapter._split_sql_statements("A; B;")
        assert [s.rstrip(";").strip() for s in stmts] == ["A", "B"]

    def test_trailing_no_semicolon(self):
        stmts = DatabaseAdapter._split_sql_statements("A; B")
        assert len(stmts) == 2
        assert "B" in stmts[1]

    def test_empty_input(self):
        assert DatabaseAdapter._split_sql_statements("") == []

    def test_only_whitespace(self):
        assert DatabaseAdapter._split_sql_statements("  \n  ") == []

    def test_inline_comment_with_semicolon_not_split(self):
        # Точка с запятой внутри inline-комментария НЕ должна делить оператор.
        sql = "CREATE TABLE a (id INT) -- inline ; comment\n;\nCREATE TABLE b ();"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 2
        assert "CREATE TABLE a" in stmts[0]
        assert "CREATE TABLE b" in stmts[1]

    def test_block_comment_with_semicolon_not_split(self):
        sql = "CREATE TABLE a (id INT) /* block ; comment */;\nCREATE TABLE b ();"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 2

    def test_string_literal_with_semicolon_not_split(self):
        sql = "INSERT INTO t VALUES ('a;b'); SELECT 1;"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 2
        assert "'a;b'" in stmts[0]

    def test_escaped_quote_in_string(self):
        # Экранированная кавычка '' внутри строки — продолжение литерала.
        sql = "INSERT INTO t VALUES ('a''b;c'); SELECT 1;"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 2

    def test_dollar_quoting_simple(self):
        sql = (
            "CREATE FUNCTION f() RETURNS void AS $$\n"
            "BEGIN\n"
            "  SELECT 1;  -- inside dollar quote\n"
            "  RAISE NOTICE 'hi';\n"
            "END;\n"
            "$$ LANGUAGE plpgsql;"
        )
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 1
        assert "CREATE FUNCTION" in stmts[0]

    def test_dollar_quoting_tagged(self):
        sql = (
            "CREATE FUNCTION f() RETURNS void AS $tag$\n"
            "  SELECT 1; SELECT 2;\n"
            "$tag$ LANGUAGE plpgsql;\n"
            "CREATE TABLE t ();"
        )
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert len(stmts) == 2

    def test_only_comments_skipped(self):
        sql = "-- only a comment;\n/* and another; */"
        stmts = DatabaseAdapter._split_sql_statements(sql)
        assert stmts == []


# ---------------------------------------------------------------------------
# 3. Подстановка {SCHEMA}/{PREFIX} плейсхолдеров: параметризованно для
#    обоих адаптеров. Проверяем, что итоговый SQL содержит ожидаемое
#    квалифицированное имя.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "adapter_kind,expected_qualified",
    [
        ("postgresql", "test_foo"),                 # {SCHEMA}. стирается
        ("greenplum", "public_test.test_foo"),
    ],
)
async def test_schema_prefix_substitution(adapter_kind, expected_qualified, mock_conn, tmp_path):
    """{SCHEMA}.{PREFIX}foo → корректно подставляется под каждый адаптер."""
    if adapter_kind == "postgresql":
        a = PostgreSQLAdapter(table_prefix=PG_PREFIX)
    else:
        a = GreenplumAdapter(schema=GP_SCHEMA, table_prefix=GP_PREFIX)

    schema = tmp_path / "domain" / "migrations" / "x" / "schema.sql"
    schema.parent.mkdir(parents=True)
    schema.write_text("CREATE TABLE {SCHEMA}.{PREFIX}foo (id INT);", encoding="utf-8")

    # pre-check: таблицы нет → пойдёт execute; post-verify: таблица есть.
    mock_conn.fetch.side_effect = [
        [],                                   # pre-check
        [{"tablename": "test_foo"}],          # post-verify (по simple-имени)
    ]

    await a.create_tables(mock_conn, [schema])

    # Собираем все вызовы execute в один SQL-текст и проверяем подстановку
    executed_sql = " ".join(
        call.args[0] for call in mock_conn.execute.call_args_list
    )
    assert expected_qualified in executed_sql
    assert "{SCHEMA}" not in executed_sql
    assert "{PREFIX}" not in executed_sql


# ---------------------------------------------------------------------------
# 4. GP-специфика: ловит DuplicateTableError / DuplicateObjectError,
#    но пробрасывает прочие PostgresError.
# ---------------------------------------------------------------------------

class TestGreenplumDuplicateHandling:

    @pytest.fixture
    def gp_adapter(self):
        return GreenplumAdapter(schema=GP_SCHEMA, table_prefix=GP_PREFIX)

    @pytest.fixture
    def schema_file(self, tmp_path):
        f = tmp_path / "dom" / "migrations" / "greenplum" / "schema.sql"
        f.parent.mkdir(parents=True)
        f.write_text(
            "CREATE TABLE {SCHEMA}.{PREFIX}dup (id INT);\n"
            "CREATE INDEX idx_dup ON {SCHEMA}.{PREFIX}dup (id);",
            encoding="utf-8",
        )
        return f

    async def test_ignores_duplicate_table(self, gp_adapter, mock_conn, schema_file):
        # Pre-check: ничего нет; post-verify: таблица "появилась" (как будто из прошлого запуска).
        mock_conn.fetch.side_effect = [
            [],
            [{"tablename": "test_dup"}],
        ]
        # Первый execute (CREATE TABLE) кидает DuplicateTableError — адаптер должен проглотить.
        # Второй execute (CREATE INDEX) — успешен.
        mock_conn.execute.side_effect = [
            asyncpg.DuplicateTableError("relation already exists"),
            None,
        ]

        await gp_adapter.create_tables(mock_conn, [schema_file])

        assert mock_conn.execute.call_count == 2

    async def test_ignores_duplicate_object(self, gp_adapter, mock_conn, schema_file):
        mock_conn.fetch.side_effect = [
            [],
            [{"tablename": "test_dup"}],
        ]
        # Например, индекс уже существует
        mock_conn.execute.side_effect = [
            None,
            asyncpg.DuplicateObjectError("index already exists"),
        ]

        await gp_adapter.create_tables(mock_conn, [schema_file])

        assert mock_conn.execute.call_count == 2

    async def test_propagates_other_postgres_errors(self, gp_adapter, mock_conn, schema_file):
        mock_conn.fetch.side_effect = [
            [],
            [{"tablename": "test_dup"}],
        ]
        # Любая другая asyncpg-ошибка должна пробрасываться.
        mock_conn.execute.side_effect = asyncpg.PostgresSyntaxError("syntax error")

        with pytest.raises(asyncpg.PostgresSyntaxError):
            await gp_adapter.create_tables(mock_conn, [schema_file])

    async def test_propagates_runtime_error(self, gp_adapter, mock_conn, schema_file):
        mock_conn.fetch.side_effect = [[], []]
        mock_conn.execute.side_effect = RuntimeError("boom")

        with pytest.raises(RuntimeError, match="boom"):
            await gp_adapter.create_tables(mock_conn, [schema_file])


# ---------------------------------------------------------------------------
# 5. PG-специфика: batch-execute (один вызов execute на всю схему) и
#    проброс ошибок синтаксиса.
# ---------------------------------------------------------------------------

class TestPostgreSQLBatchExecute:

    @pytest.fixture
    def pg_adapter(self):
        return PostgreSQLAdapter(table_prefix=PG_PREFIX)

    @pytest.fixture
    def multi_stmt_schema(self, tmp_path):
        f = tmp_path / "dom" / "migrations" / "postgresql" / "schema.sql"
        f.parent.mkdir(parents=True)
        f.write_text(
            "CREATE TABLE {PREFIX}a (id INT);\n"
            "CREATE TABLE {PREFIX}b (id INT);\n"
            "CREATE INDEX idx_a ON {PREFIX}a (id);",
            encoding="utf-8",
        )
        return f

    async def test_batch_executes_multi_statement(self, pg_adapter, mock_conn, multi_stmt_schema):
        """PG выполняет всю schema.sql одним вызовом conn.execute()."""
        # pre-check: ни одной таблицы; post-verify: обе появились.
        mock_conn.fetch.side_effect = [
            [],
            [{"tablename": "test_a"}, {"tablename": "test_b"}],
        ]

        await pg_adapter.create_tables(mock_conn, [multi_stmt_schema])

        # Главный инвариант: PG отправляет схему ОДНИМ батчем.
        assert mock_conn.execute.call_count == 1
        executed_sql = mock_conn.execute.call_args.args[0]
        assert "CREATE TABLE " in executed_sql
        assert "CREATE INDEX " in executed_sql

    async def test_propagates_syntax_error(self, pg_adapter, mock_conn, tmp_path):
        schema = tmp_path / "dom" / "migrations" / "postgresql" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text("CREATE TABLE {PREFIX}fail (id INT);", encoding="utf-8")

        mock_conn.fetch.side_effect = [[], []]
        mock_conn.execute.side_effect = asyncpg.PostgresSyntaxError("syntax")

        with pytest.raises(asyncpg.PostgresSyntaxError):
            await pg_adapter.create_tables(mock_conn, [schema])

    async def test_propagates_duplicate_object_swallowed_then_postverify_fails(
        self, pg_adapter, mock_conn, tmp_path
    ):
        """
        PG ловит DuplicateObjectError (как для повторного создания триггера),
        но post-verify всё равно проверяет таблицы — если их нет, RuntimeError.
        """
        schema = tmp_path / "dom" / "migrations" / "postgresql" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text("CREATE TABLE {PREFIX}only_trigger (id INT);", encoding="utf-8")

        mock_conn.fetch.side_effect = [
            [],   # pre-check
            [],   # post-verify — таблица так и не появилась
        ]
        mock_conn.execute.side_effect = asyncpg.DuplicateObjectError("trigger exists")

        with pytest.raises(RuntimeError, match="test_only_trigger"):
            await pg_adapter.create_tables(mock_conn, [schema])


# ---------------------------------------------------------------------------
# 6. _companion_target_table: распознавание операторов-«спутников» создания
#    таблицы (CREATE INDEX / COMMENT ON) и их целевой таблицы.
# ---------------------------------------------------------------------------

class TestCompanionTargetTable:

    def test_create_index_simple(self):
        assert DatabaseAdapter._companion_target_table(
            "CREATE INDEX idx_x ON tab(id);"
        ) == "tab"

    def test_create_index_qualified_unique_if_not_exists(self):
        assert DatabaseAdapter._companion_target_table(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_x\n    ON s.tab (id, name);"
        ) == "s.tab"

    def test_create_index_with_leading_comment(self):
        assert DatabaseAdapter._companion_target_table(
            "-- индекс под выборку\nCREATE INDEX idx_x ON s.tab(id);"
        ) == "s.tab"

    def test_comment_on_table(self):
        assert DatabaseAdapter._companion_target_table(
            "COMMENT ON TABLE s.tab IS 'описание';"
        ) == "s.tab"

    def test_comment_on_column(self):
        assert DatabaseAdapter._companion_target_table(
            "COMMENT ON COLUMN s.tab.col IS 'описание';"
        ) == "s.tab"

    def test_comment_on_column_unqualified(self):
        assert DatabaseAdapter._companion_target_table(
            "COMMENT ON COLUMN tab.col IS 'описание';"
        ) == "tab"

    @pytest.mark.parametrize("stmt", [
        "CREATE TABLE IF NOT EXISTS s.tab (id INT);",
        "ALTER TABLE s.tab ADD COLUMN x INT;",
        "CREATE SEQUENCE s.tab_id_seq;",
        "INSERT INTO s.tab VALUES (1);",
        "DO $$ BEGIN PERFORM 1; END$$;",
    ])
    def test_non_companion_statements_return_none(self, stmt):
        """CREATE TABLE / ALTER / SEQUENCE / INSERT / DO — не «спутники»."""
        assert DatabaseAdapter._companion_target_table(stmt) is None


# ---------------------------------------------------------------------------
# 7. Пропуск «спутников» уже существующих таблиц. Регрессия ПРОМ-инцидента:
#    bus-таблица канала агента создана внешней стороной (мы не владелец) —
#    CREATE INDEX / COMMENT ON на ней падали с «must be owner of relation»
#    и валили старт приложения, когда любая другая таблица домена отсутствовала.
# ---------------------------------------------------------------------------

class TestSkipCompanionsForExistingTables:

    async def test_gp_skips_index_and_comments_on_foreign_existing_table(
        self, mock_conn, tmp_path,
    ):
        a = GreenplumAdapter(schema=GP_SCHEMA, table_prefix=GP_PREFIX)
        f = tmp_path / "dom" / "migrations" / "greenplum" / "schema.sql"
        f.parent.mkdir(parents=True)
        f.write_text(
            "CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}own (id INT);\n"
            "CREATE INDEX idx_own ON {SCHEMA}.{PREFIX}own (id);\n"
            "CREATE TABLE IF NOT EXISTS integ.bus (id INT);\n"
            "CREATE INDEX idx_bus ON integ.bus(id);\n"
            "COMMENT ON TABLE integ.bus IS 'чужая таблица';\n"
            "COMMENT ON COLUMN integ.bus.id IS 'uid';",
            encoding="utf-8",
        )
        # bus существует (создана внешней стороной), own отсутствует.
        # pre-check/post-verify идут по запросу на схему (public_test, integ).
        mock_conn.fetch.side_effect = [
            [],                            # pre-check public_test
            [{"tablename": "bus"}],        # pre-check integ
            [{"tablename": "test_own"}],   # post-verify public_test
            [{"tablename": "bus"}],        # post-verify integ
        ]

        await a.create_tables(mock_conn, [f])

        executed = [c.args[0] for c in mock_conn.execute.call_args_list]
        assert any("idx_own" in s for s in executed)
        # «Спутники» чужой существующей таблицы не исполнялись.
        assert not any("idx_bus" in s for s in executed)
        assert not any("COMMENT ON" in s for s in executed)

    async def test_pg_skips_index_on_foreign_existing_table(
        self, mock_conn, tmp_path,
    ):
        a = PostgreSQLAdapter(table_prefix=PG_PREFIX)
        f = tmp_path / "dom" / "migrations" / "postgresql" / "schema.sql"
        f.parent.mkdir(parents=True)
        f.write_text(
            "CREATE TABLE IF NOT EXISTS {PREFIX}own (id INT);\n"
            "CREATE INDEX IF NOT EXISTS idx_own ON {PREFIX}own (id);\n"
            "CREATE TABLE IF NOT EXISTS bus (id INT);\n"
            "CREATE INDEX IF NOT EXISTS idx_bus ON bus(id);",
            encoding="utf-8",
        )
        mock_conn.fetch.side_effect = [
            [{"tablename": "bus"}],                              # pre-check
            [{"tablename": "test_own"}, {"tablename": "bus"}],   # post-verify
        ]

        await a.create_tables(mock_conn, [f])

        assert mock_conn.execute.call_count == 1
        executed_sql = mock_conn.execute.call_args.args[0]
        assert "idx_own" in executed_sql
        # Даже CREATE INDEX IF NOT EXISTS на чужой таблице требует владения,
        # если индекса нет — оператор должен быть отфильтрован.
        assert "idx_bus" not in executed_sql

    async def test_gp_alter_table_still_executes_for_existing_table(
        self, mock_conn, tmp_path,
    ):
        """ALTER TABLE — путь эволюции существующих таблиц, не пропускается."""
        a = GreenplumAdapter(schema=GP_SCHEMA, table_prefix=GP_PREFIX)
        f = tmp_path / "dom" / "migrations" / "greenplum" / "schema.sql"
        f.parent.mkdir(parents=True)
        f.write_text(
            "CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}own (id INT);\n"
            "ALTER TABLE {SCHEMA}.{PREFIX}msgs ADD COLUMN agent_ref VARCHAR(36);\n"
            "CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}msgs (id INT);",
            encoding="utf-8",
        )
        # msgs существует (эволюция), own отсутствует.
        mock_conn.fetch.side_effect = [
            [{"tablename": "test_msgs"}],                            # pre-check
            [{"tablename": "test_own"}, {"tablename": "test_msgs"}],  # post-verify
        ]

        await a.create_tables(mock_conn, [f])

        executed = [c.args[0] for c in mock_conn.execute.call_args_list]
        assert any("ALTER TABLE" in s for s in executed)


# ---------------------------------------------------------------------------
# 8. Контракт capabilities (sanity): расхождение между адаптерами.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 9. _get_existing_tables учитывает схему имени, а не одну фиксированную.
#    Регрессия: при CHAT__SCHEMA_NAME / CHAT__AGENT_CHANNEL__SCHEMA_NAME
#    таблицы создаются в иной схеме; existence-check обязан проверять её,
#    иначе post-verify в create_tables ложно падает с RuntimeError.
# ---------------------------------------------------------------------------

class TestExistingTablesSchemaAware:

    async def test_gp_qualified_name_checks_declared_schema(self, mock_conn):
        a = GreenplumAdapter(schema="main_s", table_prefix="t_")
        mock_conn.fetch.return_value = [{"tablename": "t_bus"}]

        found = await a._get_existing_tables(mock_conn, ["integ.t_bus"])

        assert found == {"integ.t_bus"}
        # Запрос ушёл по схеме 'integ', а не по основной 'main_s'.
        args = mock_conn.fetch.call_args.args
        assert args[1] == "integ"
        assert args[2] == ["t_bus"]

    async def test_pg_qualified_name_checks_declared_schema(self, mock_conn):
        a = PostgreSQLAdapter(table_prefix="t_")
        mock_conn.fetch.return_value = [{"tablename": "t_bus"}]

        found = await a._get_existing_tables(mock_conn, ["integ.t_bus"])

        assert found == {"integ.t_bus"}
        args = mock_conn.fetch.call_args.args
        assert args[1] == "integ"
        assert args[2] == ["t_bus"]

    async def test_gp_unqualified_name_uses_main_schema(self, mock_conn):
        a = GreenplumAdapter(schema="main_s", table_prefix="t_")
        mock_conn.fetch.return_value = [{"tablename": "t_foo"}]

        found = await a._get_existing_tables(mock_conn, ["main_s.t_foo"])

        assert found == {"main_s.t_foo"}
        assert mock_conn.fetch.call_args.args[1] == "main_s"

    async def test_pg_unqualified_name_uses_public(self, mock_conn):
        a = PostgreSQLAdapter(table_prefix="t_")
        mock_conn.fetch.return_value = [{"tablename": "t_foo"}]

        found = await a._get_existing_tables(mock_conn, ["t_foo"])

        assert found == {"t_foo"}
        assert mock_conn.fetch.call_args.args[1] == "public"

    async def test_empty_input_no_query(self, mock_conn):
        a = PostgreSQLAdapter(table_prefix="t_")
        found = await a._get_existing_tables(mock_conn, [])
        assert found == set()
        mock_conn.fetch.assert_not_called()


def test_capabilities_diverge():
    pg = PostgreSQLAdapter(table_prefix="")
    gp = GreenplumAdapter(schema="s", table_prefix="p_")

    assert pg.supports_cascade_delete() is True
    assert gp.supports_cascade_delete() is False

    assert pg.supports_on_conflict() is True
    assert gp.supports_on_conflict() is False

    assert pg.get_serial_type() == "SERIAL"
    assert gp.get_serial_type() == "BIGSERIAL"
