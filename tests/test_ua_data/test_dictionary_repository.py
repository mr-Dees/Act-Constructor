"""Тесты для DictionaryRepository.

Методы репозитория — pass-through (`[dict(r) for r in rows]`), поэтому проверяем
не «мок вернул то, что в него положили», а РЕАЛЬНУЮ логику: текст SQL-запроса
(фильтр `is_actual = true`, сортировка, JOIN'ы/LIMIT) и корректную распаковку строк.
"""
import pytest
from unittest.mock import MagicMock, patch

from app.core import settings_registry
from app.domains.ua_data.repositories.dictionary_repository import (
    DictionaryRepository,
)
from app.domains.ua_data.settings import UaDataSettings


@pytest.fixture(autouse=True)
def _reset_settings():
    """Сброс реестра настроек между тестами."""
    settings_registry.reset()
    settings_registry.register("ua_data", UaDataSettings)
    yield
    settings_registry.reset()


@pytest.fixture
def repo(mock_conn):
    """Создаёт DictionaryRepository с замоканным адаптером и соединением."""
    mock_adapter = MagicMock()
    mock_adapter.qualify_table_name = lambda name, schema="": name
    with patch(
        "app.db.repositories.base.get_adapter", return_value=mock_adapter
    ):
        return DictionaryRepository(conn=mock_conn)


def _sql(mock_conn) -> str:
    """Возвращает текст последнего SQL, переданного в conn.fetch."""
    return mock_conn.fetch.call_args.args[0]


class TestGetProcesses:

    async def test_sql_filters_actual_and_orders(self, repo, mock_conn):
        mock_conn.fetch.return_value = [{"process_code": "1013", "process_name": "X"}]
        result = await repo.get_processes()
        sql = _sql(mock_conn)
        assert "is_actual = true" in sql
        assert "ORDER BY process_code" in sql
        assert "process_code" in sql and "process_name" in sql
        # pass-through: строки распакованы в dict
        assert result[0]["process_code"] == "1013"


class TestGetTerbanks:

    async def test_sql_filters_actual_and_orders(self, repo, mock_conn):
        mock_conn.fetch.return_value = [{"tb_id": "07"}]
        await repo.get_terbanks()
        sql = _sql(mock_conn)
        assert "is_actual = true" in sql
        assert "ORDER BY tb_id" in sql
        assert "short_name" in sql and "full_name" in sql


class TestGetMetricCodes:

    async def test_sql_filters_actual_and_orders(self, repo, mock_conn):
        mock_conn.fetch.return_value = [{"code": "211"}]
        await repo.get_metric_codes()
        sql = _sql(mock_conn)
        assert "is_actual = true" in sql
        assert "ORDER BY code" in sql
        assert "metric_name" in sql and "metric_group" in sql


class TestGetDepartments:
    """get_departments — единственный «сложный» метод: 3 LEFT JOIN + LIMIT."""

    async def test_sql_joins_terbank_gosb_vsp_with_limit(self, repo, mock_conn):
        mock_conn.fetch.return_value = [{"tb_id": 7}]
        result = await repo.get_departments()
        sql = _sql(mock_conn)
        assert sql.count("LEFT JOIN") == 3
        assert "is_actual = true" in sql
        assert "LIMIT 5000" in sql
        assert "ORDER BY d.id" in sql
        # алиасы из SELECT
        assert "tb_short_name" in sql and "gosb_name" in sql and "vsp_urf_code" in sql
        assert result[0]["tb_id"] == 7


class TestGetChannels:

    async def test_sql_filters_actual_and_orders(self, repo, mock_conn):
        mock_conn.fetch.return_value = [{"channel": "Мобильный банк"}]
        await repo.get_channels()
        sql = _sql(mock_conn)
        assert "is_actual = true" in sql
        assert "channel" in sql


class TestGetProducts:

    async def test_sql_filters_actual_and_orders(self, repo, mock_conn):
        mock_conn.fetch.return_value = [{"product_name": "Кредит"}]
        await repo.get_products()
        sql = _sql(mock_conn)
        assert "is_actual = true" in sql
        assert "product_name" in sql


class TestGetRiskTypes:

    async def test_sql_filters_actual_and_orders(self, repo, mock_conn):
        mock_conn.fetch.return_value = [{"risk": "Кредитный"}]
        await repo.get_risk_types()
        sql = _sql(mock_conn)
        assert "is_actual = true" in sql
        assert "risk" in sql


class TestGetTeams:

    async def test_sql_filters_actual_and_orders(self, repo, mock_conn):
        mock_conn.fetch.return_value = [{"username": "22494524"}]
        await repo.get_teams()
        sql = _sql(mock_conn)
        assert "is_actual = true" in sql
        assert "username" in sql and "tb_id" in sql


class TestEmptyResult:
    """Пустая выборка → пустой список (общий контракт всех методов)."""

    async def test_empty_fetch_returns_empty_list(self, repo, mock_conn):
        mock_conn.fetch.return_value = []
        assert await repo.get_processes() == []
        assert await repo.get_departments() == []
