"""Тесты дифференциального группового сохранения/удаления ЦКФР."""

from datetime import datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core import settings_registry
from app.domains.ck_fin_res.exceptions import FRGroupConflictError
from app.domains.ck_fin_res.repositories.fr_validation_repository import (
    _INSERT_FIELDS,
    FRValidationRepository,
)
from app.domains.ck_fin_res.settings import CkFinResSettings


@pytest.fixture(autouse=True)
def _reset_settings():
    """Сброс реестра настроек между тестами."""
    settings_registry.reset()
    settings_registry.register("ck_fin_res", CkFinResSettings)
    yield
    settings_registry.reset()


@pytest.fixture(autouse=True)
def _mock_adapter():
    """Автouse-патч get_adapter — репозиторий конструируется прямо в тестах."""
    mock_adapter = MagicMock()
    mock_adapter.qualify_table_name = lambda name, schema="": name
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


KEY = {"act_sub_number_id": 1, "km_id": "КМ-09-41726",
       "act_item_number": "5.1.1", "metric_code": "2002"}


def _db_row(rid, tb, amount, counts, **over):
    """Строка таблицы, как её вернул бы asyncpg (все _INSERT_FIELDS + системные)."""
    row = {f: "" for f in _INSERT_FIELDS}
    row.update({
        "id": rid, "is_actual": True,
        "act_sub_number_id": 1, "reestr_metric_id": None,
        "km_id": "КМ-09-41726", "act_item_number": "5.1.1", "metric_code": "2002",
        "neg_finder_tb_id": tb,
        "metric_amount_rubles": Decimal(amount), "metric_element_counts": counts,
        "mpl_amount_rubles": Decimal("0"),
        "is_sent_to_top_brass": False, "real_loss": False, "applied_into_ua": True,
        "dt_sz": None, "rev_start_dt": None, "rev_end_dt": None,
        "execution_deadline": None, "assigment_id": None,
        "etl_loading_id": 42, "row_hash": "etl-hash", "created_by": "system",
        "application_status": "На рассмотрении", "tb_leader": "14",
        "updated_at": datetime(2026, 7, 1), "created_at": datetime(2026, 6, 1),
    })
    row.update(over)
    return row


def _common_from(row):
    """common-словарь запроса из строки БД (как его собирает фронт)."""
    return {f: row[f] for f in _INSERT_FIELDS if f != "created_by"}


def _tx(mock_conn):
    """Мок контекст-менеджера транзакции."""
    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=None)
    tx.__aexit__ = AsyncMock(return_value=False)
    mock_conn.transaction = lambda: tx


@pytest.mark.asyncio
async def test_conflict_when_expected_ids_mismatch(mock_conn):
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.return_value = [_db_row(101, "7", "980000.00", 8)]
    with pytest.raises(FRGroupConflictError):
        await repo.group_save(
            group_key=KEY, expected_row_ids=[101, 999],
            common=_common_from(_db_row(101, "7", "980000.00", 8)),
            breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"), "metric_element_counts": 8}],
            username="12345",
        )


@pytest.mark.asyncio
async def test_create_conflict_when_group_already_exists(mock_conn):
    """Создание (expected_row_ids=[]), но группа с таким ключом уже есть —
    отдельное дружелюбное сообщение, не общее «изменена другим пользователем»."""
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    row = _db_row(101, "7", "980000.00", 8)
    mock_conn.fetch.return_value = [row]
    with pytest.raises(FRGroupConflictError, match="уже существует"):
        await repo.group_save(
            group_key=KEY, expected_row_ids=[],
            common=_common_from(row),
            breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"), "metric_element_counts": 8}],
            username="12345",
        )


@pytest.mark.asyncio
async def test_unchanged_rows_are_skipped(mock_conn):
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    row = _db_row(101, "7", "980000.00", 8)
    mock_conn.fetch.return_value = [row]
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101], common=_common_from(row),
        breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"), "metric_element_counts": 8}],
        username="12345",
    )
    assert res == {"deactivated": 0, "inserted": 0, "skipped": 1}
    mock_conn.execute.assert_not_called()
    mock_conn.executemany.assert_not_called()


@pytest.mark.asyncio
async def test_amount_change_versions_only_that_row(mock_conn):
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    r1, r2 = _db_row(101, "7", "980000.00", 8), _db_row(102, "8", "215000.00", 3)
    mock_conn.fetch.return_value = [r1, r2]
    mock_conn.execute.return_value = "UPDATE 1"
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101, 102], common=_common_from(r1),
        breakdown=[
            {"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("990000.00"), "metric_element_counts": 8},
            {"neg_finder_tb_id": "8", "metric_amount_rubles": Decimal("215000.00"), "metric_element_counts": 3},
        ],
        username="12345",
    )
    assert res["deactivated"] == 1 and res["inserted"] == 1 and res["skipped"] == 1
    # Деактивирована именно строка 101
    dq_args = mock_conn.execute.call_args.args
    assert 101 in dq_args and 102 not in dq_args
    # Вставленная версия: сумма новая, row_hash сброшен в '', etl_loading_id в NULL,
    # applied_into_ua скопирован, created_by = username
    inserted = mock_conn.executemany.call_args.args[1][0]
    values = dict(zip(_INSERT_FIELDS, inserted))
    assert values["metric_amount_rubles"] == Decimal("990000.00")
    assert values["row_hash"] == "" and values["etl_loading_id"] is None
    assert values["applied_into_ua"] is True
    assert values["application_status"] == "На рассмотрении"
    assert values["created_by"] == "12345"


@pytest.mark.asyncio
async def test_add_and_remove_tb(mock_conn):
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    r1, r2 = _db_row(101, "7", "980000.00", 8), _db_row(102, "8", "215000.00", 3)
    mock_conn.fetch.return_value = [r1, r2]
    mock_conn.execute.return_value = "UPDATE 1"  # деактивируется только 102 (ТБ 8 убран)
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101, 102], common=_common_from(r1),
        breakdown=[
            {"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"), "metric_element_counts": 8},
            {"neg_finder_tb_id": "10", "metric_amount_rubles": Decimal("55000.00"), "metric_element_counts": 1},
        ],
        username="12345",
    )
    # ТБ 8 удалён (деактивация без вставки), ТБ 10 добавлен (вставка),
    # ТБ 7 не изменился (skip). Деактивации: [102]... + добавленный ТБ не деактивирует ничего
    assert res == {"deactivated": 1, "inserted": 1, "skipped": 1}
    inserted = mock_conn.executemany.call_args.args[1][0]
    values = dict(zip(_INSERT_FIELDS, inserted))
    assert values["neg_finder_tb_id"] == "10"
    assert values["applied_into_ua"] is False  # новая строка — не из ETL


@pytest.mark.asyncio
async def test_group_field_change_rewrites_all_rows(mock_conn):
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    r1, r2 = _db_row(101, "7", "980000.00", 8), _db_row(102, "8", "215000.00", 3)
    mock_conn.fetch.return_value = [r1, r2]
    mock_conn.execute.return_value = "UPDATE 2"
    common = _common_from(r1)
    common["ck_comment"] = "Новый комментарий пункта"
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101, 102], common=common,
        breakdown=[
            {"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"), "metric_element_counts": 8},
            {"neg_finder_tb_id": "8", "metric_amount_rubles": Decimal("215000.00"), "metric_element_counts": 3},
        ],
        username="12345",
    )
    assert res["deactivated"] == 2 and res["inserted"] == 2 and res["skipped"] == 0


@pytest.mark.asyncio
async def test_deactivation_rowcount_mismatch_raises_conflict(mock_conn):
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    r1 = _db_row(101, "7", "980000.00", 8)
    mock_conn.fetch.return_value = [r1]
    mock_conn.execute.return_value = "UPDATE 0"  # кто-то успел деактивировать
    with pytest.raises(FRGroupConflictError):
        await repo.group_save(
            group_key=KEY, expected_row_ids=[101], common=_common_from(r1),
            breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("1.00"), "metric_element_counts": 0}],
            username="12345",
        )


@pytest.mark.asyncio
async def test_group_delete_deactivates_all(mock_conn):
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.return_value = [
        _db_row(101, "7", "980000.00", 8), _db_row(102, "8", "215000.00", 3),
    ]
    mock_conn.execute.return_value = "UPDATE 2"
    count = await repo.group_delete(group_key=KEY, expected_row_ids=[101, 102], username="12345")
    assert count == 2
    sql = mock_conn.execute.call_args.args[0]
    assert "deleted_at = now()" in sql and "is_actual = false" in sql


@pytest.mark.asyncio
async def test_mpl_change_versions_only_that_row(mock_conn):
    """Изменение ТОЛЬКО MPL у одного ТБ версионирует только его строку."""
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    r1 = _db_row(101, "7", "980000.00", 8, mpl_amount_rubles=Decimal("0"))
    r2 = _db_row(102, "8", "215000.00", 3, mpl_amount_rubles=Decimal("0"))
    mock_conn.fetch.return_value = [r1, r2]
    mock_conn.execute.return_value = "UPDATE 1"
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101, 102], common=_common_from(r1),
        breakdown=[
            {"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"),
             "metric_element_counts": 8, "mpl_amount_rubles": Decimal("120000.00")},
            {"neg_finder_tb_id": "8", "metric_amount_rubles": Decimal("215000.00"),
             "metric_element_counts": 3, "mpl_amount_rubles": Decimal("0")},
        ],
        username="12345",
    )
    assert res["deactivated"] == 1 and res["inserted"] == 1 and res["skipped"] == 1
    # Деактивирована именно строка 101 (ТБ 7); строка 102 (ТБ 8) не тронута
    dq_args = mock_conn.execute.call_args.args
    assert 101 in dq_args and 102 not in dq_args
    inserted = mock_conn.executemany.call_args.args[1][0]
    values = dict(zip(_INSERT_FIELDS, inserted))
    assert values["mpl_amount_rubles"] == Decimal("120000.00")


@pytest.mark.asyncio
async def test_mpl_unchanged_row_not_rewritten(mock_conn):
    """want совпадает с БД (включая MPL) → ни деактиваций, ни INSERT."""
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    row = _db_row(101, "7", "980000.00", 8, mpl_amount_rubles=Decimal("120000.00"))
    mock_conn.fetch.return_value = [row]
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101], common=_common_from(row),
        breakdown=[
            {"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"),
             "metric_element_counts": 8, "mpl_amount_rubles": Decimal("120000.00")},
        ],
        username="12345",
    )
    assert res == {"deactivated": 0, "inserted": 0, "skipped": 1}
    mock_conn.execute.assert_not_called()
    mock_conn.executemany.assert_not_called()
