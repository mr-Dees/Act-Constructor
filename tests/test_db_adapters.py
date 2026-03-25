"""Тесты для database адаптеров: base, postgresql, greenplum."""

import pytest
from unittest.mock import AsyncMock, MagicMock

import asyncpg

from app.db.adapters.base import DatabaseAdapter
from app.db.adapters.postgresql import PostgreSQLAdapter
from app.db.adapters.greenplum import GreenplumAdapter


# ---------------------------------------------------------------------------
# _extract_table_names_from_sql (статический метод базового класса)
# ---------------------------------------------------------------------------

class TestExtractTableNames:

    def test_simple_create_table(self):
        sql = "CREATE TABLE foo (id INT);"
        assert DatabaseAdapter._extract_table_names_from_sql(sql) == ["foo"]

    def test_if_not_exists(self):
        sql = "CREATE TABLE IF NOT EXISTS bar (id INT);"
        assert DatabaseAdapter._extract_table_names_from_sql(sql) == ["bar"]

    def test_multiple_tables(self):
        sql = (
            "CREATE TABLE first (id INT);\n"
            "CREATE TABLE IF NOT EXISTS second (id INT);"
        )
        result = DatabaseAdapter._extract_table_names_from_sql(sql)
        assert result == ["first", "second"]

    def test_qualified_name(self):
        sql = "CREATE TABLE myschema.my_table (id INT);"
        assert DatabaseAdapter._extract_table_names_from_sql(sql) == ["myschema.my_table"]

    def test_no_create_table(self):
        sql = "SELECT 1; INSERT INTO foo VALUES (1);"
        assert DatabaseAdapter._extract_table_names_from_sql(sql) == []

    def test_with_comments(self):
        sql = "-- таблица актов\nCREATE TABLE acts (id INT);"
        assert DatabaseAdapter._extract_table_names_from_sql(sql) == ["acts"]

    def test_case_insensitive_lower(self):
        sql = "create table lower_t (id INT);"
        assert DatabaseAdapter._extract_table_names_from_sql(sql) == ["lower_t"]

    def test_case_insensitive_mixed(self):
        sql = "Create Table Mixed_T (id INT);"
        assert DatabaseAdapter._extract_table_names_from_sql(sql) == ["Mixed_T"]

    def test_empty_string(self):
        assert DatabaseAdapter._extract_table_names_from_sql("") == []


# ---------------------------------------------------------------------------
# PostgreSQLAdapter
# ---------------------------------------------------------------------------

class TestPostgreSQLAdapter:

    @pytest.fixture
    def adapter(self):
        return PostgreSQLAdapter()

    @pytest.fixture
    def conn(self):
        c = AsyncMock()
        c.fetchval = AsyncMock()
        c.fetch = AsyncMock(return_value=[])
        c.execute = AsyncMock()
        return c

    # --- простые методы ---

    def test_get_table_name(self, adapter):
        assert adapter.get_table_name("acts") == "acts"

    def test_get_serial_type(self, adapter):
        assert adapter.get_serial_type() == "SERIAL"

    def test_get_index_strategy_gin(self, adapter):
        assert adapter.get_index_strategy("GIN") == "GIN"

    def test_get_index_strategy_btree(self, adapter):
        assert adapter.get_index_strategy("BTREE") == "BTREE"

    def test_supports_cascade_delete(self, adapter):
        assert adapter.supports_cascade_delete() is True

    def test_supports_on_conflict(self, adapter):
        assert adapter.supports_on_conflict() is True

    # --- get_current_schema ---

    async def test_get_current_schema_returns_value(self, adapter, conn):
        conn.fetchval.return_value = "public"
        result = await adapter.get_current_schema(conn)
        assert result == "public"

    async def test_get_current_schema_none_fallback(self, adapter, conn):
        conn.fetchval.return_value = None
        result = await adapter.get_current_schema(conn)
        assert result == "public"

    # --- _get_existing_tables ---

    async def test_get_existing_tables_returns_found(self, adapter, conn):
        conn.fetch.return_value = [{"tablename": "acts"}, {"tablename": "audit_log"}]
        result = await adapter._get_existing_tables(conn, ["acts", "audit_log", "missing"])
        assert result == {"acts", "audit_log"}

    async def test_get_existing_tables_empty_list(self, adapter, conn):
        result = await adapter._get_existing_tables(conn, [])
        assert result == set()
        conn.fetch.assert_not_called()

    # --- create_tables ---

    async def test_create_tables_empty_paths(self, adapter, conn):
        await adapter.create_tables(conn, [])
        conn.execute.assert_not_called()

    async def test_create_tables_none_paths(self, adapter, conn):
        await adapter.create_tables(conn, None)
        conn.execute.assert_not_called()

    async def test_create_tables_all_exist_skip(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "postgresql" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text("CREATE TABLE foo (id INT);", encoding="utf-8")

        conn.fetch.return_value = [{"tablename": "foo"}]
        await adapter.create_tables(conn, [schema])
        conn.execute.assert_not_called()

    async def test_create_tables_missing_tables_created(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "postgresql" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text("CREATE TABLE bar (id INT);", encoding="utf-8")

        # pre-check: таблицы нет; post-verify: таблица появилась
        conn.fetch.side_effect = [
            [],                           # pre-check
            [{"tablename": "bar"}],       # post-verify
        ]

        await adapter.create_tables(conn, [schema])
        conn.execute.assert_called_once()

    async def test_create_tables_post_verify_fails(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "postgresql" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text("CREATE TABLE baz (id INT);", encoding="utf-8")

        conn.fetch.side_effect = [
            [],   # pre-check: нет таблицы
            [],   # post-verify: таблица так и не создана
        ]

        with pytest.raises(RuntimeError, match="baz"):
            await adapter.create_tables(conn, [schema])

    async def test_create_tables_duplicate_object_continues(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "postgresql" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text("CREATE TABLE dup (id INT);", encoding="utf-8")

        conn.fetch.side_effect = [
            [],                           # pre-check
            [{"tablename": "dup"}],       # post-verify
        ]
        conn.execute.side_effect = asyncpg.DuplicateObjectError("")

        await adapter.create_tables(conn, [schema])

    async def test_create_tables_file_not_found_skipped(self, adapter, conn, tmp_path):
        nonexistent = tmp_path / "no" / "such" / "schema.sql"
        await adapter.create_tables(conn, [nonexistent])
        conn.execute.assert_not_called()

    async def test_create_tables_substitutions(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "postgresql" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text(
            "CREATE TABLE {REF_TABLE} (id INT);",
            encoding="utf-8",
        )

        conn.fetch.side_effect = [
            [],                                 # pre-check
            [{"tablename": "real_table"}],      # post-verify
        ]

        await adapter.create_tables(
            conn, [schema], substitutions={"{REF_TABLE}": "real_table"}
        )

        executed_sql = conn.execute.call_args[0][0]
        assert "real_table" in executed_sql
        assert "{REF_TABLE}" not in executed_sql

    async def test_create_tables_substitutions_callable(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "postgresql" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text(
            "CREATE TABLE {DYNAMIC} (id INT);",
            encoding="utf-8",
        )

        conn.fetch.side_effect = [
            [],
            [{"tablename": "resolved_name"}],
        ]

        await adapter.create_tables(
            conn, [schema], substitutions={"{DYNAMIC}": lambda: "resolved_name"}
        )

        executed_sql = conn.execute.call_args[0][0]
        assert "resolved_name" in executed_sql

    async def test_create_tables_only_comments_skipped(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "postgresql" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text("-- только комментарии\n-- ещё строка\n", encoding="utf-8")

        await adapter.create_tables(conn, [schema])
        conn.execute.assert_not_called()

    async def test_create_tables_generic_exception_propagates(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "postgresql" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text("CREATE TABLE fail_tbl (id INT);", encoding="utf-8")

        conn.fetch.side_effect = [[], []]
        conn.execute.side_effect = RuntimeError("unexpected failure")

        with pytest.raises(RuntimeError, match="unexpected failure"):
            await adapter.create_tables(conn, [schema])

    # --- qualify_column (базовый класс) ---

    def test_qualify_column(self, adapter):
        assert adapter.qualify_column("a", "id") == "a.id"


# ---------------------------------------------------------------------------
# GreenplumAdapter
# ---------------------------------------------------------------------------

class TestGreenplumAdapter:

    @pytest.fixture
    def adapter(self):
        return GreenplumAdapter(schema="myschema", table_prefix="pfx_")

    @pytest.fixture
    def conn(self):
        c = AsyncMock()
        c.fetchval = AsyncMock()
        c.fetch = AsyncMock(return_value=[])
        c.execute = AsyncMock()
        return c

    # --- __init__ ---

    def test_init_stores_params(self):
        a = GreenplumAdapter(schema="s", table_prefix="p_")
        assert a.schema == "s"
        assert a.table_prefix == "p_"

    # --- простые методы ---

    def test_get_table_name(self, adapter):
        assert adapter.get_table_name("acts") == "myschema.pfx_acts"

    def test_get_serial_type(self, adapter):
        assert adapter.get_serial_type() == "BIGSERIAL"

    def test_get_index_strategy_gin_replaced(self, adapter):
        assert adapter.get_index_strategy("GIN") == "BTREE"

    def test_get_index_strategy_btree(self, adapter):
        assert adapter.get_index_strategy("BTREE") == "BTREE"

    def test_supports_cascade_delete(self, adapter):
        assert adapter.supports_cascade_delete() is False

    def test_supports_on_conflict(self, adapter):
        assert adapter.supports_on_conflict() is False

    # --- get_current_schema ---

    async def test_get_current_schema_returns_schema(self, adapter, conn):
        result = await adapter.get_current_schema(conn)
        assert result == "myschema"

    # --- _get_existing_tables ---

    async def test_get_existing_tables_qualified_names(self, adapter, conn):
        conn.fetch.return_value = [{"tablename": "pfx_acts"}]
        result = await adapter._get_existing_tables(
            conn, ["myschema.pfx_acts", "myschema.pfx_log"]
        )
        assert result == {"myschema.pfx_acts"}

    async def test_get_existing_tables_unqualified_names(self, adapter, conn):
        conn.fetch.return_value = [{"tablename": "simple"}]
        result = await adapter._get_existing_tables(conn, ["simple"])
        assert result == {"simple"}

    async def test_get_existing_tables_empty_list(self, adapter, conn):
        result = await adapter._get_existing_tables(conn, [])
        assert result == set()
        conn.fetch.assert_not_called()

    # --- create_tables ---

    async def test_create_tables_empty_paths(self, adapter, conn):
        await adapter.create_tables(conn, [])
        conn.execute.assert_not_called()

    async def test_create_tables_schema_prefix_substitution(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "greenplum" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text(
            "CREATE TABLE {SCHEMA}.{PREFIX}tbl (id INT);",
            encoding="utf-8",
        )

        conn.fetch.side_effect = [
            [],
            [{"tablename": "pfx_tbl"}],
        ]

        await adapter.create_tables(conn, [schema])

        executed_sql = conn.execute.call_args[0][0]
        assert "myschema.pfx_tbl" in executed_sql
        assert "{SCHEMA}" not in executed_sql
        assert "{PREFIX}" not in executed_sql

    async def test_create_tables_duplicate_table_continues(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "greenplum" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text(
            "CREATE TABLE {SCHEMA}.{PREFIX}dup (id INT);",
            encoding="utf-8",
        )

        conn.fetch.side_effect = [
            [],
            [{"tablename": "pfx_dup"}],
        ]
        conn.execute.side_effect = asyncpg.DuplicateTableError("")

        await adapter.create_tables(conn, [schema])

    async def test_create_tables_duplicate_object_continues(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "greenplum" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text(
            "CREATE TABLE {SCHEMA}.{PREFIX}dup2 (id INT);",
            encoding="utf-8",
        )

        conn.fetch.side_effect = [
            [],
            [{"tablename": "pfx_dup2"}],
        ]
        conn.execute.side_effect = asyncpg.DuplicateObjectError("")

        await adapter.create_tables(conn, [schema])

    async def test_create_tables_post_verify_fails_short_names(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "greenplum" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text(
            "CREATE TABLE {SCHEMA}.{PREFIX}miss (id INT);",
            encoding="utf-8",
        )

        conn.fetch.side_effect = [
            [],   # pre-check
            [],   # post-verify: таблица не создана
        ]

        with pytest.raises(RuntimeError, match="pfx_miss"):
            await adapter.create_tables(conn, [schema])

    async def test_create_tables_file_not_found_skipped(self, adapter, conn, tmp_path):
        nonexistent = tmp_path / "no" / "such" / "schema.sql"
        await adapter.create_tables(conn, [nonexistent])
        conn.execute.assert_not_called()

    async def test_create_tables_all_exist_skip(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "greenplum" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text(
            "CREATE TABLE {SCHEMA}.{PREFIX}ex (id INT);",
            encoding="utf-8",
        )

        conn.fetch.return_value = [{"tablename": "pfx_ex"}]

        await adapter.create_tables(conn, [schema])
        conn.execute.assert_not_called()

    async def test_create_tables_with_substitutions(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "greenplum" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text(
            "CREATE TABLE {SCHEMA}.{PREFIX}ref (id INT);\n"
            "CREATE TABLE {REF_HADOOP} (data TEXT);",
            encoding="utf-8",
        )

        conn.fetch.side_effect = [
            [],
            [{"tablename": "pfx_ref"}, {"tablename": "hadoop_tbl"}],
        ]

        await adapter.create_tables(
            conn, [schema], substitutions={"{REF_HADOOP}": "hadoop_tbl"}
        )

        executed_sql = conn.execute.call_args[0][0]
        assert "hadoop_tbl" in executed_sql
        assert "{REF_HADOOP}" not in executed_sql

    async def test_create_tables_generic_exception_propagates(self, adapter, conn, tmp_path):
        schema = tmp_path / "testdomain" / "greenplum" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text(
            "CREATE TABLE {SCHEMA}.{PREFIX}err (id INT);",
            encoding="utf-8",
        )

        conn.fetch.side_effect = [[], []]
        conn.execute.side_effect = RuntimeError("unexpected failure")

        with pytest.raises(RuntimeError, match="unexpected failure"):
            await adapter.create_tables(conn, [schema])

    def test_get_index_strategy_gin_lowercase(self, adapter):
        assert adapter.get_index_strategy("gin") == "BTREE"

    def test_qualify_column(self, adapter):
        assert adapter.qualify_column("t", "col") == "t.col"
