"""Тесты для CSValidationService."""

import pytest
from unittest.mock import AsyncMock

from app.domains.ck_client_exp.exceptions import CSRecordNotFoundError
from app.domains.ck_client_exp.services.cs_validation_service import (
    CSValidationService,
)


@pytest.fixture
def cs_repo():
    """Mock CSValidationRepository."""
    return AsyncMock()


@pytest.fixture
def dict_repo():
    """Mock DictionaryRepository."""
    return AsyncMock()


@pytest.fixture
def service(cs_repo, dict_repo):
    """Создаёт CSValidationService с замоканными репозиториями."""
    return CSValidationService(cs_repo=cs_repo, dict_repo=dict_repo)


# -------------------------------------------------------------------------
# get_record
# -------------------------------------------------------------------------


class TestGetRecord:

    async def test_not_found(self, service, cs_repo):
        """Бросает CSRecordNotFoundError, если запись не найдена."""
        cs_repo.get_by_id.return_value = None
        with pytest.raises(CSRecordNotFoundError):
            await service.get_record(record_id=999)

    async def test_found(self, service, cs_repo):
        """Возвращает словарь записи при наличии."""
        cs_repo.get_by_id.return_value = {
            "id": 1,
            "metric_code": "CS-001",
            "metric_unic_clients": 100,
        }
        result = await service.get_record(record_id=1)

        assert result["id"] == 1
        assert result["metric_code"] == "CS-001"
        assert result["metric_unic_clients"] == 100


# -------------------------------------------------------------------------
# delete_record
# -------------------------------------------------------------------------


class TestDeleteRecord:

    async def test_not_found(self, service, cs_repo):
        """Бросает CSRecordNotFoundError, если запись не найдена."""
        cs_repo.soft_delete.return_value = False
        with pytest.raises(CSRecordNotFoundError):
            await service.delete_record(record_id=999, username="testuser")

    async def test_success(self, service, cs_repo):
        """Успешное удаление возвращает True."""
        cs_repo.soft_delete.return_value = True
        result = await service.delete_record(record_id=1, username="testuser")
        assert result is True


# -------------------------------------------------------------------------
# get_dictionary
# -------------------------------------------------------------------------


class TestGetDictionary:

    async def test_unknown_dictionary(self, service, dict_repo):
        """Неизвестный справочник возвращает пустой список."""
        result = await service.get_dictionary("unknown")
        assert result == []

    async def test_known_dictionary(self, service, dict_repo):
        """Запрос известного справочника вызывает соответствующий метод."""
        dict_repo.get_processes.return_value = [
            {"process_code": "2050", "process_name": "Обслуживание клиентов"},
        ]
        result = await service.get_dictionary("processes")

        dict_repo.get_processes.assert_called_once()
        assert len(result) == 1
        assert result[0]["process_code"] == "2050"
