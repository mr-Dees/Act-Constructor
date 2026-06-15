"""Тест репозиторного метода сводки «мои акты, требующие внимания».

Проверяет SQL-форму get_user_acts_needing_attention (EXISTS по участнику,
исключение заблокированных, фильтр needs_*/validation_status) и маппинг строк в
ActAttentionItem. Стратегия — mock_conn + autouse-патч get_adapter, как в
tests/domains/notifications/test_notification_repository.py.
"""

from unittest.mock import MagicMock, patch

import pytest

from app.domains.acts.repositories.act_crud import ActCrudRepository
from app.domains.acts.schemas.act_metadata import ActAttentionItem


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name, schema="": name
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


async def test_attention_query_shape(mock_conn):
    """SQL фильтрует по участнику (EXISTS), исключает заблокированные и берёт
    только акты с незакрытыми требованиями ИЛИ validation_status <> 'ok'."""
    mock_conn.fetch.return_value = []
    repo = ActCrudRepository(mock_conn)
    await repo.get_user_acts_needing_attention("12345")

    sql, *params = mock_conn.fetch.call_args.args
    assert "FROM acts a" in sql
    # участник через EXISTS по audit_team_members
    assert "EXISTS (" in sql
    assert "FROM audit_team_members atm" in sql
    assert "atm.username = $1" in sql
    # заблокированные исключены
    assert "NOT (" in sql
    assert "a.lock_expires_at > CURRENT_TIMESTAMP" in sql
    # фильтр требований/валидации
    assert "a.needs_invoice_check" in sql
    assert "a.validation_status <> 'ok'" in sql
    assert params[0] == "12345"


async def test_attention_maps_rows_to_items(mock_conn):
    """Строки маппятся в ActAttentionItem с прокинутыми флагами/issues."""
    mock_conn.fetch.return_value = [
        {
            "id": 42, "inspection_name": "Акт А",
            "needs_created_date": False, "needs_directive_number": False,
            "needs_invoice_check": True, "needs_service_note": False,
            "validation_status": "ok", "validation_issues": None,
        },
        {
            "id": 43, "inspection_name": "Акт Б",
            "needs_created_date": False, "needs_directive_number": False,
            "needs_invoice_check": False, "needs_service_note": False,
            "validation_status": "error",
            "validation_issues": [{"code": "x", "severity": "error", "message": "M"}],
        },
    ]
    repo = ActCrudRepository(mock_conn)
    result = await repo.get_user_acts_needing_attention("12345")

    assert all(isinstance(it, ActAttentionItem) for it in result)
    assert [it.id for it in result] == [42, 43]
    assert result[0].needs_invoice_check is True
    assert result[1].validation_status == "error"
    assert result[1].validation_issues == [{"code": "x", "severity": "error", "message": "M"}]


async def test_attention_passes_limit(mock_conn):
    """limit прокидывается вторым позиционным параметром (потолок payload)."""
    mock_conn.fetch.return_value = []
    repo = ActCrudRepository(mock_conn)
    await repo.get_user_acts_needing_attention("12345", limit=50)

    _, *params = mock_conn.fetch.call_args.args
    assert params[1] == 50
