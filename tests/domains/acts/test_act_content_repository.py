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
