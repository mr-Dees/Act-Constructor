"""Тесты для DictionaryRepository."""

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


# -------------------------------------------------------------------------
# get_processes
# -------------------------------------------------------------------------


class TestGetProcesses:

    async def test_returns_list_of_dicts(self, repo, mock_conn):
        mock_conn.fetch.return_value = [
            {"id": 1, "process_code": "1013", "process_name": "Кредитование ЮЛ",
             "block_owner": "БР", "department_owner": "ОАРБ"},
        ]
        result = await repo.get_processes()
        assert isinstance(result, list)
        assert len(result) == 1
        assert isinstance(result[0], dict)
        assert result[0]["process_code"] == "1013"

    async def test_empty_result(self, repo, mock_conn):
        mock_conn.fetch.return_value = []
        result = await repo.get_processes()
        assert result == []


# -------------------------------------------------------------------------
# get_terbanks
# -------------------------------------------------------------------------


class TestGetTerbanks:

    async def test_returns_list_of_dicts(self, repo, mock_conn):
        mock_conn.fetch.return_value = [
            {"tb_id": "07", "short_name": "МСК", "full_name": "Московский банк"},
        ]
        result = await repo.get_terbanks()
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]["short_name"] == "МСК"

    async def test_empty_result(self, repo, mock_conn):
        mock_conn.fetch.return_value = []
        result = await repo.get_terbanks()
        assert result == []


# -------------------------------------------------------------------------
# get_metric_codes
# -------------------------------------------------------------------------


class TestGetMetricCodes:

    async def test_returns_list_of_dicts(self, repo, mock_conn):
        mock_conn.fetch.return_value = [
            {"id": 1, "code": "211", "metric_name": "Уровень потерь"},
        ]
        result = await repo.get_metric_codes()
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]["code"] == "211"

    async def test_passes_prefix_parameter(self, repo, mock_conn):
        mock_conn.fetch.return_value = []
        await repo.get_metric_codes(prefix="FR")
        args = mock_conn.fetch.call_args
        assert args[0][1] == "FR%"

    async def test_default_prefix_is_empty(self, repo, mock_conn):
        mock_conn.fetch.return_value = []
        await repo.get_metric_codes()
        args = mock_conn.fetch.call_args
        assert args[0][1] == "%"

    async def test_empty_result(self, repo, mock_conn):
        mock_conn.fetch.return_value = []
        result = await repo.get_metric_codes(prefix="NONE")
        assert result == []


# -------------------------------------------------------------------------
# get_departments
# -------------------------------------------------------------------------


class TestGetDepartments:

    async def test_returns_list_of_dicts(self, repo, mock_conn):
        mock_conn.fetch.return_value = [
            {"id": 1, "tb_id": 7, "gosb_id": 7001,
             "vsp_id": 700101, "subsidiary_id": None,
             "tb_short_name": "Московский", "tb_full_name": "Московский банк ПАО Сбербанк",
             "gosb_name": "ГОСБ Москва",
             "vsp_urf_code": "URF007", "vsp_type": "Филиал"},
        ]
        result = await repo.get_departments()
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]["tb_id"] == 7

    async def test_empty_result(self, repo, mock_conn):
        mock_conn.fetch.return_value = []
        result = await repo.get_departments()
        assert result == []


# -------------------------------------------------------------------------
# get_channels
# -------------------------------------------------------------------------


class TestGetChannels:

    async def test_returns_list_of_dicts(self, repo, mock_conn):
        mock_conn.fetch.return_value = [
            {"id": 1, "channel": "Мобильный банк"},
        ]
        result = await repo.get_channels()
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]["channel"] == "Мобильный банк"

    async def test_empty_result(self, repo, mock_conn):
        mock_conn.fetch.return_value = []
        result = await repo.get_channels()
        assert result == []


# -------------------------------------------------------------------------
# get_products
# -------------------------------------------------------------------------


class TestGetProducts:

    async def test_returns_list_of_dicts(self, repo, mock_conn):
        mock_conn.fetch.return_value = [
            {"id": 1, "product_name": "Потребительский кредит"},
        ]
        result = await repo.get_products()
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]["product_name"] == "Потребительский кредит"

    async def test_empty_result(self, repo, mock_conn):
        mock_conn.fetch.return_value = []
        result = await repo.get_products()
        assert result == []


# -------------------------------------------------------------------------
# get_teams
# -------------------------------------------------------------------------


class TestGetTeams:

    async def test_returns_list_of_dicts(self, repo, mock_conn):
        mock_conn.fetch.return_value = [
            {"id": 1, "tb_id": "07", "username": "22494524"},
        ]
        result = await repo.get_teams()
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]["username"] == "22494524"

    async def test_empty_result(self, repo, mock_conn):
        mock_conn.fetch.return_value = []
        result = await repo.get_teams()
        assert result == []
