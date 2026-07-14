"""
Фактуры в снимке версии (#8, решение Q2): колонка `invoices_data`.

Снимок версии наполняется реквизитами фактур акта на момент создания версии
(привязка node_id → фактура). Тесты проверяют:
  - create_version пишет invoices_data в INSERT (SQL-колонка + JSON-аргумент);
  - get_version читает и парсит invoices_data (JSON-строка → dict);
  - акт без фактур → пустой блоб {}, без падений;
  - ActContentService.save_content наполняет снимок из get_invoices_for_act.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.domains.acts.repositories.act_content_version import (
    ActContentVersionRepository,
)
from app.domains.acts.schemas.act_content import ActDataSchema
from app.domains.acts.services.act_content_service import ActContentService


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


# --- репозиторий: запись ---------------------------------------------------

async def test_create_version_writes_invoices_data(mock_conn):
    """INSERT снимка содержит колонку invoices_data и её JSON-аргумент."""
    mock_conn.fetchrow.return_value = {"version_number": 1}
    mock_conn.execute.return_value = "DELETE 0"
    repo = ActContentVersionRepository(mock_conn)

    invoices = {"n5": {"node_id": "n5", "db_type": "hive", "table_name": "t1"}}
    await repo.create_version(
        act_id=1, username="12345", save_type="manual",
        tree={}, tables={}, textblocks={}, violations={}, invoices=invoices,
    )

    sql = mock_conn.fetchrow.call_args.args[0]
    assert "invoices_data" in sql
    # invoices_json — последний позиционный аргумент запроса
    args = mock_conn.fetchrow.call_args.args
    assert json.loads(args[-1]) == invoices


async def test_create_version_defaults_invoices_to_empty(mock_conn):
    """Без параметра invoices → пустой блоб {} (акт без фактур не падает)."""
    mock_conn.fetchrow.return_value = {"version_number": 1}
    mock_conn.execute.return_value = "DELETE 0"
    repo = ActContentVersionRepository(mock_conn)

    await repo.create_version(
        act_id=1, username="12345", save_type="manual",
        tree={}, tables={}, textblocks={}, violations={},
    )

    args = mock_conn.fetchrow.call_args.args
    assert json.loads(args[-1]) == {}


# --- репозиторий: чтение ---------------------------------------------------

async def test_get_version_parses_invoices_data_json_string(mock_conn):
    """get_version парсит invoices_data из JSON-строки в dict."""
    invoices = {"n5": {"node_id": "n5", "db_type": "greenplum"}}
    mock_conn.fetchrow.return_value = {
        "id": 7, "version_number": 3, "save_type": "manual", "username": "12345",
        "tree_data": "{}", "tables_data": "{}", "textblocks_data": "{}",
        "violations_data": "{}", "invoices_data": json.dumps(invoices),
        "created_at": "2026-07-14T00:00:00",
    }
    repo = ActContentVersionRepository(mock_conn)

    result = await repo.get_version(act_id=1, version_id=7)
    assert result["invoices_data"] == invoices

    sql = mock_conn.fetchrow.call_args.args[0]
    assert "invoices_data" in sql


async def test_get_version_passes_through_dict_invoices_data(mock_conn):
    """asyncpg вернул уже dict → get_version не ломает его."""
    invoices = {"n5": {"node_id": "n5"}}
    mock_conn.fetchrow.return_value = {
        "id": 7, "version_number": 3, "save_type": "manual", "username": "12345",
        "tree_data": {}, "tables_data": {}, "textblocks_data": {},
        "violations_data": {}, "invoices_data": invoices,
        "created_at": "2026-07-14T00:00:00",
    }
    repo = ActContentVersionRepository(mock_conn)

    result = await repo.get_version(act_id=1, version_id=7)
    assert result["invoices_data"] == invoices


# --- сервис: наполнение снимка из фактур акта -------------------------------

def _make_service():
    conn = AsyncMock()
    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=tx)
    tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx)
    acts_settings = MagicMock()
    acts_settings.resource.max_tree_depth = 50
    acts_settings.audit_log.max_diff_elements = 100
    acts_settings.audit_log.max_diff_cells_per_table = 100
    acts_settings.audit_log.max_content_versions = 50
    svc = ActContentService(
        conn=conn, settings=MagicMock(), acts_settings=acts_settings,
        access=MagicMock(), lock=MagicMock(), crud=MagicMock(),
        content=MagicMock(), invoice=MagicMock(),
    )
    svc.guard = MagicMock()
    svc.guard.require_edit_permission = AsyncMock()
    svc.guard.require_lock_owner = AsyncMock()
    svc._content = MagicMock()
    svc._content.save_content = AsyncMock(
        return_value={"status": "success", "message": "ok", "dropped_orphans": 0}
    )
    svc._audit = MagicMock()
    svc._audit.log = AsyncMock()
    svc._audit.compute_content_diff = AsyncMock(return_value={})
    svc._audit.compute_field_diffs = AsyncMock(return_value=None)
    svc._versions = MagicMock()
    svc._versions.create_version = AsyncMock(return_value=1)
    svc._invoice = MagicMock()
    return svc


async def test_save_content_populates_invoices_from_repo():
    """manual-сохранение: снимок получает {node_id: фактура} из get_invoices_for_act."""
    svc = _make_service()
    svc._invoice.get_invoices_for_act = AsyncMock(return_value=[
        {"node_id": "n5", "db_type": "hive", "table_name": "t1"},
        {"node_id": "n6", "db_type": "greenplum", "table_name": "t2"},
    ])
    data = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": []}, saveType="manual",
    )
    await svc.save_content(act_id=1, data=data, username="12345")

    svc._invoice.get_invoices_for_act.assert_awaited_once_with(1)
    kwargs = svc._versions.create_version.await_args.kwargs
    assert kwargs["invoices"] == {
        "n5": {"node_id": "n5", "db_type": "hive", "table_name": "t1"},
        "n6": {"node_id": "n6", "db_type": "greenplum", "table_name": "t2"},
    }


async def test_save_content_no_invoices_empty_blob():
    """Акт без фактур → снимок получает пустой блоб {}."""
    svc = _make_service()
    svc._invoice.get_invoices_for_act = AsyncMock(return_value=[])
    data = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": []}, saveType="manual",
    )
    await svc.save_content(act_id=1, data=data, username="12345")
    kwargs = svc._versions.create_version.await_args.kwargs
    assert kwargs["invoices"] == {}


async def test_save_content_auto_does_not_fetch_invoices():
    """auto-сохранение снимок не создаёт → фактуры не запрашиваются."""
    svc = _make_service()
    svc._invoice.get_invoices_for_act = AsyncMock(return_value=[])
    data = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": []}, saveType="auto",
    )
    await svc.save_content(act_id=1, data=data, username="12345")
    svc._invoice.get_invoices_for_act.assert_not_awaited()
    svc._versions.create_version.assert_not_awaited()
