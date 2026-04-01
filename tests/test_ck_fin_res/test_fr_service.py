"""Тесты для FRValidationService."""

import pytest
from unittest.mock import AsyncMock

from app.domains.ck_fin_res.exceptions import FRRecordNotFoundError
from app.domains.ck_fin_res.services.fr_validation_service import (
    FRValidationService,
)


@pytest.fixture
def fr_repo():
    """Mock FRValidationRepository."""
    return AsyncMock()


@pytest.fixture
def dict_repo():
    """Mock DictionaryRepository."""
    return AsyncMock()


@pytest.fixture
def service(fr_repo, dict_repo):
    """Создаёт FRValidationService с замоканными репозиториями."""
    return FRValidationService(fr_repo=fr_repo, dict_repo=dict_repo)


# -------------------------------------------------------------------------
# get_record
# -------------------------------------------------------------------------


class TestGetRecord:

    async def test_not_found(self, service, fr_repo):
        """Бросает FRRecordNotFoundError, если запись не найдена."""
        fr_repo.get_by_id.return_value = None
        with pytest.raises(FRRecordNotFoundError):
            await service.get_record(record_id=999)

    async def test_found(self, service, fr_repo):
        """Возвращает словарь записи при наличии."""
        fr_repo.get_by_id.return_value = {"id": 1, "metric_code": "FR-001"}
        result = await service.get_record(record_id=1)

        assert result["id"] == 1
        assert result["metric_code"] == "FR-001"


# -------------------------------------------------------------------------
# delete_record
# -------------------------------------------------------------------------


class TestDeleteRecord:

    async def test_not_found(self, service, fr_repo):
        """Бросает FRRecordNotFoundError, если запись не найдена."""
        fr_repo.soft_delete.return_value = False
        with pytest.raises(FRRecordNotFoundError):
            await service.delete_record(record_id=999, username="testuser")

    async def test_success(self, service, fr_repo):
        """Успешное удаление возвращает True."""
        fr_repo.soft_delete.return_value = True
        result = await service.delete_record(record_id=1, username="testuser")
        assert result is True


# -------------------------------------------------------------------------
# get_dictionary
# -------------------------------------------------------------------------


class TestGetDictionary:

    async def test_known_dictionary(self, service, dict_repo):
        """Запрос известного справочника вызывает соответствующий метод."""
        dict_repo.get_processes.return_value = [
            {"process_code": "1013", "process_name": "Кредитование ЮЛ"},
        ]
        result = await service.get_dictionary("processes")

        dict_repo.get_processes.assert_called_once()
        assert len(result) == 1
        assert result[0]["process_code"] == "1013"

    async def test_unknown_dictionary(self, service, dict_repo):
        """Неизвестный справочник возвращает пустой список."""
        result = await service.get_dictionary("unknown")
        assert result == []


# -------------------------------------------------------------------------
# batch_update_records
# -------------------------------------------------------------------------


class TestBatchUpdateRecords:

    async def test_delegates_to_repo(self, service, fr_repo):
        """Делегирует вызов в fr_repo.batch_update."""
        fr_repo.batch_update.return_value = 3
        items = [
            {"id": 1, "metric_code": "FR-001"},
            {"id": 2, "metric_code": "FR-002"},
            {"id": 3, "metric_code": "FR-003"},
        ]
        result = await service.batch_update_records(items, username="testuser")

        fr_repo.batch_update.assert_called_once_with(items, "testuser")
        assert result == 3


# -------------------------------------------------------------------------
# search_records
# -------------------------------------------------------------------------


class TestSearchRecords:

    async def test_delegates_to_repo(self, service, fr_repo):
        """Делегирует вызов в fr_repo.search."""
        fr_repo.search.return_value = [{"id": 1}]
        result = await service.search_records(metric_code=["FR-001"])

        fr_repo.search.assert_called_once_with(
            start_date=None,
            end_date=None,
            metric_code=["FR-001"],
            process_code=None,
        )
        assert len(result) == 1
