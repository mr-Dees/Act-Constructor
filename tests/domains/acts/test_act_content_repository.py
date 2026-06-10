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
    """save_content работает в транзакции ВЫЗЫВАЮЩЕГО сервиса (§9 зона 4).

    Репозиторий собственную транзакцию НЕ открывает: плоскую транзакцию
    вокруг контента + diff + аудит-лога + снимка версии держит
    ActContentService.save_content (вложенный conn.transaction() в asyncpg
    создал бы SAVEPOINT — на Greenplum вложенность не используем).
    """

    async def test_repo_does_not_open_own_transaction(self, mock_conn):
        """Репозиторий не открывает собственную транзакцию (контракт)."""
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None   # audit_act_id
        mock_conn.fetch.return_value = []         # directives query

        data = _make_act_data()
        await repo.save_content(act_id=1, data=data, username="user1")

        mock_conn.transaction.assert_not_called()

    async def test_executemany_called_for_tables(self, mock_conn):
        """executemany для таблиц вызывается при сохранении."""
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
        # Узлы-владельцы (n1/n2/n3) должны быть в дереве, иначе orphan-фильтр
        # отбросит записи и executemany для них не вызовется.
        data.tree = {
            "id": "root", "label": "Акт",
            "children": [
                {"id": "n1", "label": "Таблица", "type": "table",
                 "tableId": "tbl_1", "children": []},
                {"id": "n2", "label": "ТБ", "type": "textblock",
                 "textBlockId": "tb_1", "children": []},
                {"id": "n3", "label": "Нарушение", "type": "violation",
                 "violationId": "v_1", "children": []},
            ],
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

    async def test_save_helpers_do_not_open_nested_transactions(self, mock_conn):
        """_save_tables/_save_textblocks/_save_violations не открывают транзакций.

        Любой conn.transaction() внутри save_content был бы вложенным
        относительно транзакции сервиса (= SAVEPOINT) — запрещено.
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

        # Ни одной собственной транзакции
        assert mock_conn.transaction.call_count == 0


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
        """Значения денормализации и флагов стоят на правильных позициях execute.

        Сверяем КОНКРЕТНЫЕ индексы параметров $1..$15 — порядок зафиксирован
        INSERT-ом insert_table. Перестановка или инверсия любого флага ломает
        тест (только is_regular_risk_table=True, остальные 5 флагов=False).
        """
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
        # args[0] — SQL-строка; позиционные параметры $1..$15 идут с args[1].
        args = mock_conn.execute.call_args.args
        assert args[1] == 1                  # $1  act_id
        assert args[2] == "t1"               # $2  table_id
        assert args[3] == "n1"               # $3  node_id
        assert args[4] == "3.1"              # $4  node_number
        assert args[5] == "Оценка качества"  # $5  table_label
        assert args[8] is False              # $8  is_protected
        assert args[9] is True               # $9  is_deletable
        assert args[10] is False             # $10 is_metrics_table
        assert args[11] is False             # $11 is_main_metrics_table
        assert args[12] is True              # $12 is_regular_risk_table
        assert args[13] is False             # $13 is_operational_risk_table
        assert args[14] is False             # $14 is_tax_risk_table
        assert args[15] is False             # $15 is_other_risk_table

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


def _make_textblock(node_id: str) -> MagicMock:
    tb = MagicMock()
    tb.nodeId = node_id
    tb.content = "текст"
    tb.formatting = MagicMock()
    tb.formatting.model_dump.return_value = {}
    return tb


def _make_violation(node_id: str) -> MagicMock:
    v = MagicMock()
    v.nodeId = node_id
    v.violated = "нарушено"
    v.established = "установлено"
    for attr in ("descriptionList", "additionalContent", "reasons",
                 "consequences", "responsible", "recommendations"):
        m = MagicMock()
        m.model_dump.return_value = {}
        setattr(v, attr, m)
    return v


class TestSaveTextblocksViolationsOrphanFilter:
    """pbe-4 / §6 п.11: orphan-фильтр единообразен для всех словарей.

    Записи textBlocks/violations, чей nodeId отсутствует в дереве,
    отбрасываются при сохранении — как уже сделано для tables.
    """

    _TREE_WITH_NODES = {
        "id": "root", "label": "Акт",
        "children": [
            {"id": "n_tb", "label": "ТБ", "type": "textblock",
             "textBlockId": "tb_ok", "children": []},
            {"id": "n_v", "label": "Нарушение", "type": "violation",
             "violationId": "v_ok", "children": []},
        ],
    }

    async def test_orphan_textblock_not_inserted(self, mock_conn):
        """Текстблок с nodeId не из дерева не попадает в INSERT."""
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None
        mock_conn.fetch.return_value = []

        data = _make_act_data(textblocks={"tb_ghost": _make_textblock("ghost")})
        await repo.save_content(act_id=1, data=data, username="user1")

        for c in mock_conn.executemany.call_args_list:
            if "act_textblocks" in c.args[0]:
                pytest.fail("orphan-текстблок попал в INSERT act_textblocks")

    async def test_orphan_violation_not_inserted(self, mock_conn):
        """Нарушение с nodeId не из дерева не попадает в INSERT."""
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None
        mock_conn.fetch.return_value = []

        data = _make_act_data(violations={"v_ghost": _make_violation("ghost")})
        await repo.save_content(act_id=1, data=data, username="user1")

        for c in mock_conn.executemany.call_args_list:
            if "act_violations" in c.args[0]:
                pytest.fail("orphan-нарушение попало в INSERT act_violations")

    async def test_valid_textblock_and_violation_inserted(self, mock_conn):
        """Записи с узлом-владельцем в дереве сохраняются (фильтр не сверх-агрессивен)."""
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None
        mock_conn.fetch.return_value = []

        data = _make_act_data(
            textblocks={"tb_ok": _make_textblock("n_tb")},
            violations={"v_ok": _make_violation("n_v")},
        )
        data.tree = dict(self._TREE_WITH_NODES)
        await repo.save_content(act_id=1, data=data, username="user1")

        sqls = [c.args[0] for c in mock_conn.executemany.call_args_list]
        assert any("act_textblocks" in s for s in sqls), "валидный текстблок не вставлен"
        assert any("act_violations" in s for s in sqls), "валидное нарушение не вставлено"

    async def test_mixed_orphans_dropped_valid_kept(self, mock_conn):
        """Смешанный словарь: orphan отброшен, валидная запись вставлена."""
        repo = ActContentRepository(mock_conn)
        mock_conn.fetchval.return_value = None
        mock_conn.fetch.return_value = []

        data = _make_act_data(
            textblocks={
                "tb_ok": _make_textblock("n_tb"),
                "tb_ghost": _make_textblock("ghost"),
            },
        )
        data.tree = dict(self._TREE_WITH_NODES)
        await repo.save_content(act_id=1, data=data, username="user1")

        tb_inserts = [
            c for c in mock_conn.executemany.call_args_list
            if "act_textblocks" in c.args[0]
        ]
        assert len(tb_inserts) == 1
        rows = tb_inserts[0].args[1]
        # Вставлена ровно одна запись — валидная
        assert len(rows) == 1
        assert rows[0][3] == "tb_ok"  # $4 — textblock_id
