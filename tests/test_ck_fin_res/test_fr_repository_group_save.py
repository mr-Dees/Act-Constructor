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
        "npl_amount_rubles": Decimal("0"),
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
    # Второй fetch — пост-проверка дублей после коммита (дублей нет)
    mock_conn.fetch.side_effect = [[r1, r2], []]
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
    mock_conn.fetch.side_effect = [[r1, r2], []]  # второй fetch — пост-проверка дублей
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
    mock_conn.fetch.side_effect = [[r1, r2], []]  # второй fetch — пост-проверка дублей
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
async def test_npl_change_versions_only_that_row(mock_conn):
    """Изменение ТОЛЬКО NPL у одного ТБ версионирует только его строку."""
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    r1 = _db_row(101, "7", "980000.00", 8, npl_amount_rubles=Decimal("0"))
    r2 = _db_row(102, "8", "215000.00", 3, npl_amount_rubles=Decimal("0"))
    mock_conn.fetch.side_effect = [[r1, r2], []]  # второй fetch — пост-проверка дублей
    mock_conn.execute.return_value = "UPDATE 1"
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101, 102], common=_common_from(r1),
        breakdown=[
            {"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"),
             "metric_element_counts": 8, "npl_amount_rubles": Decimal("120000.00")},
            {"neg_finder_tb_id": "8", "metric_amount_rubles": Decimal("215000.00"),
             "metric_element_counts": 3, "npl_amount_rubles": Decimal("0")},
        ],
        username="12345",
    )
    assert res["deactivated"] == 1 and res["inserted"] == 1 and res["skipped"] == 1
    # Деактивирована именно строка 101 (ТБ 7); строка 102 (ТБ 8) не тронута
    dq_args = mock_conn.execute.call_args.args
    assert 101 in dq_args and 102 not in dq_args
    inserted = mock_conn.executemany.call_args.args[1][0]
    values = dict(zip(_INSERT_FIELDS, inserted))
    assert values["npl_amount_rubles"] == Decimal("120000.00")


@pytest.mark.asyncio
async def test_npl_unchanged_row_not_rewritten(mock_conn):
    """want совпадает с БД (включая NPL) → ни деактиваций, ни INSERT."""
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    row = _db_row(101, "7", "980000.00", 8, npl_amount_rubles=Decimal("120000.00"))
    mock_conn.fetch.return_value = [row]
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101], common=_common_from(row),
        breakdown=[
            {"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"),
             "metric_element_counts": 8, "npl_amount_rubles": Decimal("120000.00")},
        ],
        username="12345",
    )
    assert res == {"deactivated": 0, "inserted": 0, "skipped": 1}
    mock_conn.execute.assert_not_called()
    mock_conn.executemany.assert_not_called()


@pytest.mark.asyncio
async def test_edit_key_change_to_occupied_key_conflicts(mock_conn):
    """Смена ключевых полей на ключ существующей группы → 409, а не молчаливое
    слияние двух групп с задвоенными суммами и ТБ."""
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    row = _db_row(101, "7", "980000.00", 8)
    occupied = [_db_row(201, "8", "1.00", 1, act_item_number="5.2.2")]
    mock_conn.fetch.side_effect = [[row], occupied]  # группа; занятый новый ключ
    common = _common_from(row)
    common["act_item_number"] = "5.2.2"
    with pytest.raises(FRGroupConflictError, match="уже существует"):
        await repo.group_save(
            group_key=KEY, expected_row_ids=[101], common=common,
            breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"), "metric_element_counts": 8}],
            username="12345",
        )
    mock_conn.execute.assert_not_called()
    mock_conn.executemany.assert_not_called()


@pytest.mark.asyncio
async def test_edit_key_change_to_free_key_versions_all_rows(mock_conn):
    """Смена ключа на свободный: строки перевыпускаются под новым ключом."""
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    row = _db_row(101, "7", "980000.00", 8)
    # Группа; новый ключ свободен; пост-проверка дублей после коммита
    mock_conn.fetch.side_effect = [[row], [], []]
    mock_conn.execute.return_value = "UPDATE 1"
    common = _common_from(row)
    common["act_item_number"] = "5.9.9"
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101], common=common,
        breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"), "metric_element_counts": 8}],
        username="12345",
    )
    assert res == {"deactivated": 1, "inserted": 1, "skipped": 0}
    inserted = dict(zip(_INSERT_FIELDS, mock_conn.executemany.call_args.args[1][0]))
    assert inserted["act_item_number"] == "5.9.9"


@pytest.mark.asyncio
async def test_etl_duplicate_tb_rows_healed_on_save(mock_conn):
    """Два активных дубля одного ТБ (ETL-рассинхрон): актуален новейший,
    осиротевший дубль деактивируется этим же сохранением."""
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    stale = _db_row(101, "7", "980000.00", 8, updated_at=datetime(2026, 6, 1))
    fresh = _db_row(103, "7", "990000.00", 8, updated_at=datetime(2026, 7, 1))
    mock_conn.fetch.return_value = [stale, fresh]
    mock_conn.execute.return_value = "UPDATE 1"
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101, 103], common=_common_from(fresh),
        breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("990000.00"), "metric_element_counts": 8}],
        username="12345",
    )
    # Новейшая строка (103) совпала с want → skip; дубль 101 деактивирован
    assert res == {"deactivated": 1, "inserted": 0, "skipped": 1}
    dq_args = mock_conn.execute.call_args.args
    assert 101 in dq_args and 103 not in dq_args


@pytest.mark.asyncio
async def test_post_commit_race_check_resolves_duplicates(mock_conn):
    """Параллельное создание одинаковых групп: пост-проверка после коммита
    деактивирует дубли (кроме первой вставленной, MIN(id)) и отдаёт 409."""
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    template = _db_row(0, "7", "1.00", 1)
    mock_conn.fetch.side_effect = [
        [],  # создание: ключ свободен
        [{"neg_finder_tb_id": "7", "keep_id": 501}],  # после коммита — дубль ТБ 7
    ]
    mock_conn.execute.return_value = "UPDATE 1"
    with pytest.raises(FRGroupConflictError, match="параллельно"):
        await repo.group_save(
            group_key=KEY, expected_row_ids=[], common=_common_from(template),
            breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("1.00"), "metric_element_counts": 1}],
            username="12345",
        )
    # Вставка произошла; компенсирующий UPDATE снял все строки ТБ 7, кроме keep_id
    mock_conn.executemany.assert_called_once()
    comp_args = mock_conn.execute.call_args.args
    assert "is_actual = false" in comp_args[0] and "id <>" in comp_args[0]
    assert 501 in comp_args


@pytest.mark.asyncio
async def test_time_of_day_in_db_does_not_trigger_reversion(mock_conn):
    """Время 15:30 из ETL при форме «только дата» не делает строку «изменённой»:
    сохранение не перевыпускает группу и не стирает ETL-происхождение."""
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    row = _db_row(101, "7", "980000.00", 8,
                  rev_start_dt=datetime(2026, 1, 15, 15, 30),
                  rev_end_dt=datetime(2026, 2, 20, 9, 45))
    mock_conn.fetch.return_value = [row]
    common = _common_from(row)
    common["rev_start_dt"] = "2026-01-15"  # форма шлёт date-only строки
    common["rev_end_dt"] = "2026-02-20"
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101], common=common,
        breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"), "metric_element_counts": 8}],
        username="12345",
    )
    assert res == {"deactivated": 0, "inserted": 0, "skipped": 1}
    mock_conn.execute.assert_not_called()
    mock_conn.executemany.assert_not_called()


@pytest.mark.asyncio
async def test_float_npl_value_compares_by_kopecks(mock_conn):
    """NPL из запроса float(0.1) равен Decimal('0.10') из БД — сравнение по копейкам."""
    _tx(mock_conn)
    repo = FRValidationRepository(mock_conn)
    row = _db_row(101, "7", "980000.00", 8, npl_amount_rubles=Decimal("0.10"))
    mock_conn.fetch.return_value = [row]
    res = await repo.group_save(
        group_key=KEY, expected_row_ids=[101], common=_common_from(row),
        breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": Decimal("980000.00"),
                    "metric_element_counts": 8, "npl_amount_rubles": 0.1}],
        username="12345",
    )
    assert res == {"deactivated": 0, "inserted": 0, "skipped": 1}
