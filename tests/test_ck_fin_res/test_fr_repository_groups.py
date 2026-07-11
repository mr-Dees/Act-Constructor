"""Тесты группового поиска ЦКФР (SQL строится на мок-соединении)."""

from datetime import date, datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from app.core import settings_registry
from app.domains.ck_fin_res.exceptions import FRValidationError
from app.domains.ck_fin_res.repositories.fr_validation_repository import (
    FRValidationRepository,
)
from app.domains.ck_fin_res.schemas.requests import FilterSpec
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


def _row(rid, tb, amount, counts, item="5.1.1", metric="2002", **over):
    base = {
        "id": rid, "act_sub_number_id": 1, "km_id": "КМ-09-41726",
        "act_item_number": item, "metric_code": metric,
        "neg_finder_tb_id": tb,
        "metric_amount_rubles": Decimal(amount),
        "npl_amount_rubles": Decimal("0"),
        "metric_element_counts": counts,
        "metric_name": "Некорректный расчет", "deviation_description": "Описание",
        "ck_comment": "", "tb_leader": "14", "application_status": "На рассмотрении",
        "updated_at": datetime(2026, 7, 1, 12, 0, 0), "created_at": datetime(2026, 6, 1),
        "act_sub_number": "ЦА 36-мо0255",
    }
    base.update(over)
    return base


@pytest.mark.asyncio
async def test_search_groups_two_phases_and_assembly(mock_conn):
    repo = FRValidationRepository(mock_conn)
    # Фаза A: одна группа; total; Фаза B: две строки группы
    phase_a = [{
        "act_sub_number_id": 1, "km_id": "КМ-09-41726",
        "act_item_number": "5.1.1", "metric_code": "2002",
        "total_amount": Decimal("1195000.00"), "total_counts": 11,
        "total_npl_amount": Decimal("0.00"),
        "tb_count": 2, "max_updated_at": datetime(2026, 7, 1, 12, 0, 0),
        "grand_total": 1,
    }]
    phase_b = [
        _row(101, "7", "980000.00", 8),
        _row(102, "8", "215000.00", 3,
             updated_at=datetime(2026, 7, 2, 9, 0, 0), ck_comment="правка"),
    ]
    mock_conn.fetch.side_effect = [phase_a, phase_b]
    mock_conn.fetchval.return_value = 1

    items, total = await repo.search_groups(
        filters={"km_id": FilterSpec(op="contains", value="41726")},
        sort=[("total_amount", "desc")], limit=50, offset=0,
    )

    assert total == 1
    g = items[0]
    assert g["group_key"]["metric_code"] == "2002"
    assert g["row_ids"] == [101, 102]
    assert g["tb_count"] == 2
    assert str(g["total_amount"]) == "1195000.00"
    # tb_breakdown отсортирован по ТБ, per-ТБ поля на месте
    assert [b["neg_finder_tb_id"] for b in g["tb_breakdown"]] == ["7", "8"]
    assert g["tb_breakdown"][0]["row_id"] == 101
    # common — из строки с максимальным (updated_at, id) → строка 102
    assert g["common"]["ck_comment"] == "правка"
    assert "neg_finder_tb_id" not in g["common"]
    # ck_comment разъехался между строками → divergent
    assert "ck_comment" in g["divergent_fields"]

    # SQL фазы A: группировка + сортировка по агрегату + HAVING нет
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert "GROUP BY" in sql_a
    assert "SUM(metric_amount_rubles) AS total_amount" in sql_a
    assert "ORDER BY SUM(metric_amount_rubles) DESC" in sql_a
    # SQL фазы B: row-value IN по нормализованным ключам
    sql_b = mock_conn.fetch.call_args_list[1].args[0]
    assert "IN ((" in sql_b


@pytest.mark.asyncio
async def test_amount_filter_goes_to_having(mock_conn):
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    mock_conn.fetchval.return_value = 0

    await repo.search_groups(
        filters={"metric_amount_rubles": FilterSpec(op="range", from_="1000", to=None, cast="numeric")},
        sort=None, limit=50, offset=0,
    )
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert "HAVING" in sql_a
    assert "SUM(metric_amount_rubles) >= CAST($1 AS NUMERIC)" in sql_a
    # В WHERE фильтр по сумме НЕ попал
    assert "WHERE" not in sql_a.split("GROUP BY")[0] or "metric_amount_rubles" not in sql_a.split("GROUP BY")[0]


@pytest.mark.asyncio
async def test_sort_by_plain_column_uses_min(mock_conn):
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    mock_conn.fetchval.return_value = 0
    await repo.search_groups(filters=None, sort=[("inspection_name", "asc")], limit=10, offset=0)
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert "MIN(inspection_name) ASC" in sql_a


@pytest.mark.asyncio
async def test_sort_rejects_unknown_column(mock_conn):
    repo = FRValidationRepository(mock_conn)
    with pytest.raises(ValueError):
        await repo.search_groups(filters=None, sort=[("evil; DROP", "asc")], limit=10, offset=0)


@pytest.mark.asyncio
async def test_tb_breakdown_membership_filter_goes_to_having(mock_conn):
    """Алиас tb_breakdown → HAVING membership по neg_finder_tb_id, не в WHERE
    (иначе строки группы резались бы ДО GROUP BY и портили итоги)."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    mock_conn.fetchval.return_value = 0

    await repo.search_groups(
        filters={"tb_breakdown": FilterSpec(op="in", values=["7", "8"])},
        sort=None, limit=50, offset=0,
    )
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert "HAVING" in sql_a
    assert "SUM(CASE WHEN neg_finder_tb_id IN" in sql_a
    before_group_by = sql_a.split("GROUP BY")[0]
    assert "neg_finder_tb_id" not in before_group_by


@pytest.mark.asyncio
async def test_tb_breakdown_membership_filter_contains(mock_conn):
    """op=contains по прямому ключу neg_finder_tb_id — тоже membership (тот же алиас-таргет)."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    mock_conn.fetchval.return_value = 0

    await repo.search_groups(
        filters={"neg_finder_tb_id": FilterSpec(op="contains", value="7")},
        sort=None, limit=50, offset=0,
    )
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert "SUM(CASE WHEN CAST(neg_finder_tb_id AS TEXT) ILIKE" in sql_a


@pytest.mark.asyncio
async def test_tb_breakdown_membership_filter_empty_values(mock_conn):
    """Пустой values → 1=0 в HAVING (валидно) — «совпадений нет», как и в row-WHERE."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    mock_conn.fetchval.return_value = 0

    await repo.search_groups(
        filters={"tb_breakdown": FilterSpec(op="in", values=[])},
        sort=None, limit=50, offset=0,
    )
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert "HAVING" in sql_a
    assert "1=0" in sql_a


@pytest.mark.asyncio
async def test_phase_a_aggregates_npl(mock_conn):
    """Фаза A агрегирует NPL 90+ по группе наравне с суммой/количеством."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    mock_conn.fetchval.return_value = 0

    await repo.search_groups(filters=None, sort=None, limit=50, offset=0)
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert "SUM(npl_amount_rubles) AS total_npl_amount" in sql_a


@pytest.mark.asyncio
async def test_group_payload_contains_npl(mock_conn):
    """total_npl_amount группы — из фазы A; каждый элемент tb_breakdown несёт npl_amount_rubles."""
    repo = FRValidationRepository(mock_conn)
    phase_a = [{
        "act_sub_number_id": 1, "km_id": "КМ-09-41726",
        "act_item_number": "5.1.1", "metric_code": "602",
        "total_amount": Decimal("980000.00"), "total_counts": 8,
        "total_npl_amount": Decimal("120000.00"),
        "tb_count": 1, "max_updated_at": datetime(2026, 7, 1, 12, 0, 0),
        "grand_total": 1,
    }]
    phase_b = [
        _row(101, "7", "980000.00", 8, metric="602", npl_amount_rubles=Decimal("120000.00")),
    ]
    mock_conn.fetch.side_effect = [phase_a, phase_b]
    mock_conn.fetchval.return_value = 1

    items, total = await repo.search_groups(filters=None, sort=None, limit=50, offset=0)

    g = items[0]
    assert g["total_npl_amount"] == Decimal("120000.00")
    assert g["tb_breakdown"][0]["npl_amount_rubles"] == Decimal("120000.00")


@pytest.mark.asyncio
async def test_sort_and_filter_by_total_npl(mock_conn):
    """total_npl_amount сортируется/фильтруется как агрегат (SUM), а не как колонка строки."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    mock_conn.fetchval.return_value = 0

    await repo.search_groups(
        filters={"total_npl_amount": FilterSpec(op="range", from_="1", cast="numeric")},
        sort=[("total_npl_amount", "desc")], limit=50, offset=0,
    )
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert "ORDER BY SUM(npl_amount_rubles) DESC" in sql_a
    assert "HAVING" in sql_a
    assert "SUM(npl_amount_rubles) >= CAST($1 AS NUMERIC)" in sql_a


@pytest.mark.asyncio
async def test_sort_by_boolean_column_wraps_in_case(mock_conn):
    """MIN(boolean) в PG/GP не определён — булевы колонки сортируются через CASE."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    await repo.search_groups(filters=None, sort=[("real_loss", "desc")], limit=10, offset=0)
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert "MIN(CASE WHEN real_loss THEN 1 ELSE 0 END) DESC" in sql_a
    assert "MIN(real_loss)" not in sql_a


@pytest.mark.asyncio
async def test_date_range_bounds_bound_as_date_objects(mock_conn):
    """Границы range cast=date коэрсятся в date-объекты: строка в DATE-параметре
    роняет бинарный temporal-кодек asyncpg (DataError → 500)."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    await repo.search_groups(
        filters={"rev_start_dt": FilterSpec(op="range", from_="2026-01-01", to="2026-02-15", cast="date")},
        sort=None, limit=50, offset=0,
    )
    args = mock_conn.fetch.call_args_list[0].args
    assert date(2026, 1, 1) in args and date(2026, 2, 15) in args


@pytest.mark.asyncio
async def test_date_range_invalid_bound_skipped(mock_conn):
    """Некорректная date-граница пропускается (как прочий мусор в фильтрах), а не 500."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    await repo.search_groups(
        filters={"rev_start_dt": FilterSpec(op="range", from_="мусор", to="2026-02-15", cast="date")},
        sort=None, limit=50, offset=0,
    )
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert ">=" not in sql_a
    assert "CAST(rev_start_dt AS DATE) <= $1" in sql_a


@pytest.mark.asyncio
async def test_in_filter_casts_column_to_text(mock_conn):
    """op=in кастит колонку в TEXT: сырой col IN ронял бы бинарные кодеки
    asyncpg на нетекстовых колонках (id, даты, булевы)."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    await repo.search_groups(
        filters={"id": FilterSpec(op="in", values=["36", "37"])},
        sort=None, limit=50, offset=0,
    )
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert "CAST(id AS TEXT) IN ($1, $2)" in sql_a


@pytest.mark.asyncio
async def test_having_in_filter_on_aggregate(mock_conn):
    """op=in для агрегатной колонки — паритет операторов (раньше молча игнорировался)."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    await repo.search_groups(
        filters={"total_npl_amount": FilterSpec(op="in", values=["120000.00"])},
        sort=None, limit=50, offset=0,
    )
    sql_a = mock_conn.fetch.call_args_list[0].args[0]
    assert "HAVING" in sql_a
    assert "CAST(SUM(npl_amount_rubles) AS TEXT) IN ($1)" in sql_a


@pytest.mark.asyncio
async def test_membership_unsupported_op_rejected(mock_conn):
    """range для membership-колонки бессмыслен — отклоняется явно, а не
    игнорируется молча (молчание возвращало бы ВСЕ группы без фильтра)."""
    repo = FRValidationRepository(mock_conn)
    with pytest.raises(FRValidationError):
        await repo.search_groups(
            filters={"tb_breakdown": FilterSpec(op="range", from_="1", cast="numeric")},
            sort=None, limit=50, offset=0,
        )


@pytest.mark.asyncio
async def test_contains_escapes_like_metachars(mock_conn):
    """% и _ в поисковой фразе — литералы, а не джокеры LIKE."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], []]
    await repo.search_groups(
        filters={"ck_comment": FilterSpec(op="contains", value="100%_")},
        sort=None, limit=50, offset=0,
    )
    args = mock_conn.fetch.call_args_list[0].args
    assert "%100\\%\\_%" in args


@pytest.mark.asyncio
async def test_total_from_window_with_offset_fallback(mock_conn):
    """total — COUNT(*) OVER () из page-запроса; пустая страница при offset>0 —
    фолбэк отдельным COUNT (страница за пределами выборки)."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[]]
    mock_conn.fetchval.return_value = 7
    items, total = await repo.search_groups(filters=None, sort=None, limit=50, offset=100)
    assert items == [] and total == 7
    assert "COUNT(*) OVER () AS grand_total" in mock_conn.fetch.call_args_list[0].args[0]
    assert mock_conn.fetchval.called


@pytest.mark.asyncio
async def test_empty_result_at_offset_zero_skips_count_query(mock_conn):
    """Пустая первая страница: total=0 без дополнительного COUNT-запроса."""
    repo = FRValidationRepository(mock_conn)
    mock_conn.fetch.side_effect = [[]]
    items, total = await repo.search_groups(filters=None, sort=None, limit=50, offset=0)
    assert items == [] and total == 0
    mock_conn.fetchval.assert_not_called()
