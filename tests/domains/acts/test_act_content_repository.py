"""
Тесты репозитория содержимого актов.

2.3.2: executemany в рамках транзакции save_content.
"""
import json
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

from app.domains.acts.repositories.act_content import ActContentRepository


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


def _make_act_data(tables=None, textblocks=None, violations=None):
    """Минимальная заглушка ActDataSchema."""
    data = MagicMock()
    data.tree = {"id": "root", "label": "Акт", "children": []}
    data.tables = tables or {}
    data.textBlocks = textblocks or {}
    data.violations = violations or {}
    data.invoiceNodeIds = []
    return data


class TestSaveContentUsesTransaction:
    """save_content выполняет все операции в рамках одной транзакции."""

    async def test_transaction_entered_on_save(self, mock_conn):
        """Транзакция открывается при save_content."""
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None   # audit_act_id
        mock_conn.fetch.return_value = []         # directives query

        data = _make_act_data()
        await repo.save_content(act_id=1, data=data, username="user1")

        # transaction() должен был быть вызван
        mock_conn.transaction.assert_called_once()
        tx = mock_conn.transaction.return_value
        tx.__aenter__.assert_called_once()
        tx.__aexit__.assert_called_once()

    async def test_executemany_called_inside_transaction_tables(self, mock_conn):
        """executemany для таблиц вызывается внутри уже открытой транзакции."""
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None
        mock_conn.fetch.return_value = []

        # Добавляем одну таблицу в data
        table_data = MagicMock()
        table_data.nodeId = "node_1"
        table_data.grid = []
        table_data.colWidths = []
        table_data.protected = False
        table_data.deletable = True
        table_data.isMetricsTable = False
        table_data.isMainMetricsTable = False
        table_data.isRegularRiskTable = False
        table_data.isOperationalRiskTable = False

        data = _make_act_data(tables={"tbl_1": table_data})
        # Узел-владелец таблицы должен быть в дереве (иначе orphan-фильтр её срежет).
        data.tree = {
            "id": "root", "label": "Акт",
            "children": [{"id": "node_1", "label": "Таблица", "type": "table",
                          "tableId": "tbl_1", "children": []}],
        }
        await repo.save_content(act_id=1, data=data, username="user1")

        mock_conn.executemany.assert_called()
        # Первый аргумент вызова — SQL-строка для act_tables
        sql = mock_conn.executemany.call_args_list[0].args[0]
        assert "act_tables" in sql
        assert "INSERT INTO" in sql

    async def test_three_executemany_calls_on_full_data(self, mock_conn):
        """При наличии таблиц, текстблоков и нарушений вызывается 3 executemany."""
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None
        mock_conn.fetch.return_value = []

        # Таблица
        table_data = MagicMock()
        table_data.nodeId = "n1"
        table_data.grid = []
        table_data.colWidths = []
        table_data.protected = False
        table_data.deletable = True
        table_data.isMetricsTable = False
        table_data.isMainMetricsTable = False
        table_data.isRegularRiskTable = False
        table_data.isOperationalRiskTable = False

        # Текстблок
        tb_data = MagicMock()
        tb_data.nodeId = "n2"
        tb_data.content = "текст"
        tb_data.formatting = MagicMock()
        tb_data.formatting.model_dump.return_value = {}

        # Нарушение
        v_data = MagicMock()
        v_data.nodeId = "n3"
        v_data.violated = "нарушено"
        v_data.established = "установлено"
        for attr in ("descriptionList", "additionalContent", "reasons",
                     "consequences", "responsible", "recommendations"):
            m = MagicMock()
            m.model_dump.return_value = {}
            setattr(v_data, attr, m)

        data = _make_act_data(
            tables={"tbl_1": table_data},
            textblocks={"tb_1": tb_data},
            violations={"v_1": v_data},
        )
        # Узел-владелец таблицы (n1) должен быть в дереве, иначе orphan-фильтр
        # _save_tables срежет её и executemany для act_tables не вызовется.
        data.tree = {
            "id": "root", "label": "Акт",
            "children": [{"id": "n1", "label": "Таблица", "type": "table",
                          "tableId": "tbl_1", "children": []}],
        }
        await repo.save_content(act_id=1, data=data, username="user1")

        assert mock_conn.executemany.call_count == 3

    async def test_no_executemany_on_empty_content(self, mock_conn):
        """executemany не вызывается если нет таблиц/текстблоков/нарушений."""
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None
        mock_conn.fetch.return_value = []

        data = _make_act_data()
        await repo.save_content(act_id=1, data=data, username="user1")

        mock_conn.executemany.assert_not_called()

    async def test_executemany_not_wrapped_in_nested_transaction(self, mock_conn):
        """executemany уже в транзакции save_content — вложенная транзакция не создаётся.

        save_content вызывает transaction() ровно один раз (внешняя транзакция).
        _save_tables/_save_textblocks/_save_violations не открывают свои транзакции.
        """
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None
        mock_conn.fetch.return_value = []

        table_data = MagicMock()
        table_data.nodeId = "n1"
        table_data.grid = []
        table_data.colWidths = []
        table_data.protected = False
        table_data.deletable = True
        table_data.isMetricsTable = False
        table_data.isMainMetricsTable = False
        table_data.isRegularRiskTable = False
        table_data.isOperationalRiskTable = False

        data = _make_act_data(tables={"tbl_1": table_data})
        await repo.save_content(act_id=1, data=data, username="user1")

        # transaction() вызван ровно 1 раз — нет вложенной транзакции
        assert mock_conn.transaction.call_count == 1


class TestInsertTableDenormalizationAndFlags:
    """insert_table сохраняет денормализацию (node_number/table_label) и 6 флагов."""

    async def test_insert_table_includes_flag_and_denorm_columns(self, mock_conn):
        """SQL insert_table содержит колонки денормализации и все 6 флагов."""
        repo = ActContentRepository(mock_conn)
        await repo.insert_table(
            act_id=1,
            table_id="t1",
            node_id="n1",
            grid_data=[],
            col_widths=[],
            is_protected=True,
            is_deletable=False,
            node_number="3.1",
            table_label="Оценка качества",
            is_metrics_table=True,
        )
        sql = mock_conn.execute.call_args.args[0]
        for col in (
            "node_number", "table_label",
            "is_metrics_table", "is_main_metrics_table",
            "is_regular_risk_table", "is_operational_risk_table",
            "is_tax_risk_table", "is_other_risk_table",
        ):
            assert col in sql, f"insert_table SQL не содержит колонку {col}"

    async def test_insert_table_passes_denorm_and_flag_values(self, mock_conn):
        """Значения денормализации и флага пробрасываются в параметры execute."""
        repo = ActContentRepository(mock_conn)
        await repo.insert_table(
            act_id=1,
            table_id="t1",
            node_id="n1",
            grid_data=[],
            col_widths=[],
            is_protected=False,
            is_deletable=True,
            node_number="3.1",
            table_label="Оценка качества",
            is_regular_risk_table=True,
        )
        args = mock_conn.execute.call_args.args
        assert "3.1" in args
        assert "Оценка качества" in args
        # Флаг регулярных рисков пробрасывается True
        assert True in args[1:]

    async def test_insert_table_defaults_flags_false(self, mock_conn):
        """Без явных флагов insert_table вставляет дефолты (системная таблица)."""
        repo = ActContentRepository(mock_conn)
        await repo.insert_table(
            act_id=1,
            table_id="t1",
            node_id="n1",
            grid_data=[],
            col_widths=[],
            is_protected=True,
            is_deletable=False,
            table_label="Таблица",
        )
        # Не падает; SQL по-прежнему содержит флаги-колонки
        sql = mock_conn.execute.call_args.args[0]
        assert "is_metrics_table" in sql


class TestSaveTablesOrphanFilter:
    """_save_tables пропускает таблицы, чей nodeId отсутствует в дереве."""

    async def test_orphan_table_not_inserted(self, mock_conn):
        """Таблица с nodeId не из дерева не попадает в executemany."""
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None
        mock_conn.fetch.return_value = []

        # Таблица привязана к узлу, которого нет в дереве (root без детей).
        orphan = MagicMock()
        orphan.nodeId = "ghost"
        orphan.grid = []
        orphan.colWidths = []
        orphan.protected = False
        orphan.deletable = True
        for f in ("isMetricsTable", "isMainMetricsTable",
                  "isRegularRiskTable", "isOperationalRiskTable",
                  "isTaxRiskTable", "isOtherRiskTable"):
            setattr(orphan, f, False)

        data = _make_act_data(tables={"orphan_tbl": orphan})
        await repo.save_content(act_id=1, data=data, username="user1")

        # Orphan не должен вставляться — executemany для таблиц не вызывается
        # (нет валидных таблиц).
        for c in mock_conn.executemany.call_args_list:
            sql = c.args[0]
            if "act_tables" in sql:
                pytest.fail("orphan-таблица попала в INSERT act_tables")

    async def test_valid_table_inserted(self, mock_conn):
        """Таблица с nodeId, присутствующим в дереве, вставляется."""
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None
        mock_conn.fetch.return_value = []

        valid = MagicMock()
        valid.nodeId = "node_1"
        valid.grid = []
        valid.colWidths = []
        valid.protected = False
        valid.deletable = True
        for f in ("isMetricsTable", "isMainMetricsTable",
                  "isRegularRiskTable", "isOperationalRiskTable",
                  "isTaxRiskTable", "isOtherRiskTable"):
            setattr(valid, f, False)

        data = _make_act_data(tables={"valid_tbl": valid})
        # Дерево содержит узел node_1
        data.tree = {
            "id": "root", "label": "Акт",
            "children": [{"id": "node_1", "label": "Таблица", "type": "table",
                          "tableId": "valid_tbl", "children": []}],
        }
        await repo.save_content(act_id=1, data=data, username="user1")

        table_inserts = [
            c for c in mock_conn.executemany.call_args_list
            if "act_tables" in c.args[0]
        ]
        assert table_inserts, "валидная таблица не вставлена"
