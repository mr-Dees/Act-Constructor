"""
Параметризованные тесты для DatabaseAdapter (PostgreSQL и Greenplum).

Фокус: контрактное поведение, общее для обоих адаптеров (через @pytest.fixture(params=...)),
а также adapter-specific ветки (дубликаты для GP, batch-execute для PG).

Дополняет (не дублирует) `tests/test_db_adapters.py` и `tests/test_gp_compatibility.py`.
"""

from __future__ import annotations

import logging
from pathlib import Path
from unittest.mock import AsyncMock

import asyncpg
import pytest

from app.db.adapters.base import DatabaseAdapter
from app.db.adapters.greenplum import GreenplumAdapter
from app.db.adapters.postgresql import PostgreSQLAdapter

_REPO_ROOT = Path(__file__).resolve().parents[2]
_ACTS_PG_SCHEMA = _REPO_ROOT / "app/domains/acts/migrations/postgresql/schema.sql"

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
# 6. Контракт capabilities (sanity): расхождение между адаптерами.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 7. _get_existing_tables учитывает схему имени, а не одну фиксированную.
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


# ---------------------------------------------------------------------------
# 8. _extract_columns_from_sql — парсер колонок для диагностики дрейфа схемы.
#    Должен извлекать ИМЕНА КОЛОНОК и отсекать строки-ограничения таблицы,
#    игнорируя инлайн-комментарии, строковые литералы и вложенные скобки.
# ---------------------------------------------------------------------------

class TestExtractColumns:

    def test_simple_table(self):
        cols = DatabaseAdapter._extract_columns_from_sql(
            "CREATE TABLE public.foo (id INT, name TEXT);"
        )
        assert cols == {"public.foo": {"id", "name"}}

    def test_excludes_table_constraints(self):
        sql = (
            "CREATE TABLE t (\n"
            "  id BIGSERIAL PRIMARY KEY,\n"
            "  a INT,\n"
            "  CONSTRAINT chk_a CHECK (a > 0),\n"
            "  UNIQUE(a),\n"
            "  PRIMARY KEY (id),\n"
            "  FOREIGN KEY (a) REFERENCES other(id)\n"
            ");"
        )
        # id и a — колонки; CONSTRAINT/UNIQUE/PRIMARY/FOREIGN — нет.
        assert DatabaseAdapter._extract_columns_from_sql(sql)["t"] == {"id", "a"}

    def test_inline_check_with_commas_parens_strings(self):
        # Запятые и скобки внутри инлайн-CHECK/строк не должны дробить сегмент.
        sql = (
            "CREATE TABLE t (\n"
            "  pt VARCHAR(50) NOT NULL CHECK (pt ~ '^5\\.([0-9]+\\.)*[0-9]+$'),\n"
            "  status VARCHAR(20) DEFAULT 'ok' CHECK (status IN ('ok','bad')),\n"
            "  val JSONB\n"
            ");"
        )
        assert DatabaseAdapter._extract_columns_from_sql(sql)["t"] == {"pt", "status", "val"}

    def test_column_preceded_by_inline_comment(self):
        # Колонка с ведущим '--'-комментарием в сегменте — частый кейс в schema.sql.
        sql = (
            "CREATE TABLE t (\n"
            "  id INT,\n"
            "  -- Состояние валидации (вычисляется при сохранении)\n"
            "  validation_status VARCHAR(20) NOT NULL DEFAULT 'ok'\n"
            ");"
        )
        assert DatabaseAdapter._extract_columns_from_sql(sql)["t"] == {"id", "validation_status"}

    def test_leading_statement_comment_ignored(self):
        sql = (
            "-- комментарий c CREATE TABLE внутри, который не должен сбивать парсер\n"
            "CREATE TABLE IF NOT EXISTS public.bar (x INT);"
        )
        assert DatabaseAdapter._extract_columns_from_sql(sql) == {"public.bar": {"x"}}

    def test_real_acts_schema_has_validation_columns(self):
        """Регрессия: парсер обязан видеть validation_status/validation_issues
        в реальной acts-схеме (иначе дрейф этой таблицы не отловится)."""
        sql = _ACTS_PG_SCHEMA.read_text(encoding="utf-8")
        sql = sql.replace("{PREFIX}", "t_").replace("{SCHEMA}.", "")
        sql = sql.replace("{REF_HADOOP_TABLES}", "ref_hadoop")
        cols = DatabaseAdapter._extract_columns_from_sql(sql)["t_acts"]
        assert {"validation_status", "validation_issues"} <= cols
        # ключевые «обычные» колонки на месте
        assert {"id", "km_number", "created_by"} <= cols
        # имена CHECK-ограничений НЕ просочились как колонки
        assert not any(c.startswith("check_") for c in cols)


# ---------------------------------------------------------------------------
# 9. _warn_on_stale_tables — startup-диагностика дрейфа колонок.
#    Только WARNING (старт не блокируется), пропускает отсутствующие таблицы,
#    не падает на ошибке диагностики.
# ---------------------------------------------------------------------------

class TestStaleTableWarning:

    @staticmethod
    def _rows(*pairs):
        return [{"table_name": t, "column_name": c} for t, c in pairs]

    async def test_warns_on_missing_column(self, mock_conn, caplog):
        a = PostgreSQLAdapter(table_prefix="t_")
        # В БД у таблицы t_acts есть только id (нет validation_status).
        mock_conn.fetch.return_value = self._rows(("t_acts", "id"))
        schema = "CREATE TABLE t_acts (id INT, validation_status VARCHAR(20));"

        with caplog.at_level(logging.WARNING, logger="audit_workstation.db.adapters.base"):
            await a._warn_on_stale_tables(
                mock_conn, schema, "acts", db_label="PostgreSQL", default_schema="public",
            )

        assert any(
            "validation_status" in r.getMessage() and "устарела" in r.getMessage()
            for r in caplog.records
        )

    async def test_no_warning_when_all_columns_present(self, mock_conn, caplog):
        a = PostgreSQLAdapter(table_prefix="t_")
        mock_conn.fetch.return_value = self._rows(("t_acts", "id"), ("t_acts", "validation_status"))
        schema = "CREATE TABLE t_acts (id INT, validation_status VARCHAR(20));"

        with caplog.at_level(logging.WARNING, logger="audit_workstation.db.adapters.base"):
            await a._warn_on_stale_tables(
                mock_conn, schema, "acts", db_label="PostgreSQL", default_schema="public",
            )

        assert not [r for r in caplog.records if r.levelno >= logging.WARNING]

    async def test_skips_table_absent_from_db(self, mock_conn, caplog):
        # Таблицы нет в БД (actual пуст) → это ветка create_tables, не дрейф.
        a = PostgreSQLAdapter(table_prefix="t_")
        mock_conn.fetch.return_value = []
        schema = "CREATE TABLE t_new (id INT, foo TEXT);"

        with caplog.at_level(logging.WARNING, logger="audit_workstation.db.adapters.base"):
            await a._warn_on_stale_tables(
                mock_conn, schema, "x", db_label="PostgreSQL", default_schema="public",
            )

        assert not [r for r in caplog.records if r.levelno >= logging.WARNING]

    async def test_never_raises_on_diagnostic_error(self, mock_conn):
        # Если диагностика падает (например, fetch кинул) — старт не должен упасть.
        a = PostgreSQLAdapter(table_prefix="t_")
        mock_conn.fetch.side_effect = asyncpg.PostgresError("boom")
        # не должно бросить
        await a._warn_on_stale_tables(
            mock_conn, "CREATE TABLE t_acts (id INT, x TEXT);", "acts",
            db_label="PostgreSQL", default_schema="public",
        )

    async def test_create_tables_warns_when_existing_table_stale(self, mock_conn, caplog, tmp_path):
        """Интеграция: когда все таблицы существуют, но одна устарела,
        create_tables логирует WARNING (а не молча проходит)."""
        a = PostgreSQLAdapter(table_prefix="t_")
        schema = tmp_path / "dom" / "migrations" / "postgresql" / "schema.sql"
        schema.parent.mkdir(parents=True)
        schema.write_text(
            "CREATE TABLE {PREFIX}acts (id INT, validation_status VARCHAR(20));",
            encoding="utf-8",
        )
        mock_conn.fetch.side_effect = [
            [{"tablename": "t_acts"}],                 # pre-check: таблица существует → missing=[]
            self._rows(("t_acts", "id")),              # actual columns: нет validation_status
        ]

        with caplog.at_level(logging.WARNING, logger="audit_workstation.db.adapters.base"):
            await a.create_tables(mock_conn, [schema])

        # Схема НЕ исполнялась (все таблицы есть), но предупреждение о дрейфе вышло.
        mock_conn.execute.assert_not_called()
        assert any("validation_status" in r.getMessage() for r in caplog.records)
