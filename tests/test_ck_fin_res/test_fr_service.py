"""Тесты для FRValidationService."""

import pytest
from unittest.mock import AsyncMock

from app.core import settings_registry
from app.domains.ck_fin_res.exceptions import FRRecordNotFoundError, FRValidationError
from app.domains.ck_fin_res.schemas.group import FRGroupDeleteRequest, FRGroupSaveRequest
from app.domains.ck_fin_res.services.fr_validation_service import (
    FRValidationService,
)
from app.domains.ck_fin_res.settings import CkFinResSettings


@pytest.fixture(autouse=True)
def _reset_settings():
    """Сброс реестра настроек между тестами (search клампит limit по working_set_cap)."""
    settings_registry.reset()
    settings_registry.register("ck_fin_res", CkFinResSettings)
    yield
    settings_registry.reset()


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


def _group_key() -> dict:
    return {"act_sub_number_id": 1, "km_id": "КМ-09-41726",
            "act_item_number": "5.1.1", "metric_code": "2002"}


def _save_request(tb_id: str = "7") -> FRGroupSaveRequest:
    return FRGroupSaveRequest(
        group_key=_group_key(),
        expected_row_ids=[101, 102],
        common={"metric_code": "2002"},
        breakdown=[{"neg_finder_tb_id": tb_id, "metric_amount_rubles": "980000.00",
                    "metric_element_counts": 8}],
    )


# -------------------------------------------------------------------------
# search
# -------------------------------------------------------------------------


class TestSearch:

    async def test_delegates_to_search_groups_with_capped_limit(self, service, fr_repo):
        """Групповой поиск делегируется в fr_repo.search_groups; limit клампится working_set_cap."""
        fr_repo.search_groups.return_value = ([{"tb_count": 2}], 1)

        result = await service.search(filters={}, sort=None, limit=5000, offset=10)

        fr_repo.search_groups.assert_called_once_with(
            filters={}, sort=None, limit=1000, offset=10,
        )
        assert result == {"items": [{"tb_count": 2}], "total": 1, "limit": 1000, "offset": 10}


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
# group_save
# -------------------------------------------------------------------------


class TestGroupSave:

    async def test_delegates_to_repo_when_tb_known(self, service, fr_repo, dict_repo):
        """Валидные ТБ — делегирует в fr_repo.group_save с распакованными моделями."""
        dict_repo.get_terbanks.return_value = [{"tb_id": "7"}, {"tb_id": "8"}]
        fr_repo.group_save.return_value = {"deactivated": 1, "inserted": 1, "skipped": 0}
        req = _save_request()

        result = await service.group_save(req, "testuser")

        fr_repo.group_save.assert_called_once_with(
            group_key=req.group_key.model_dump(),
            expected_row_ids=[101, 102],
            common=req.common.model_dump(),
            breakdown=[b.model_dump() for b in req.breakdown],
            username="testuser",
        )
        assert result == {"deactivated": 1, "inserted": 1, "skipped": 0}

    async def test_rejects_unknown_tb(self, service, fr_repo, dict_repo):
        """ТБ вне справочника — FRValidationError, репозиторий не вызывается."""
        dict_repo.get_terbanks.return_value = [{"tb_id": "8"}]
        req = _save_request(tb_id="7")

        with pytest.raises(FRValidationError):
            await service.group_save(req, "testuser")
        fr_repo.group_save.assert_not_called()

    async def test_mpl_on_non_602_metric_rejected(self, service, fr_repo, dict_repo):
        """MPL заполнен у метрики, отличной от 602 — FRValidationError, репозиторий не вызывается."""
        dict_repo.get_terbanks.return_value = [{"tb_id": "7"}]
        req = FRGroupSaveRequest(
            group_key=_group_key(),
            expected_row_ids=[101, 102],
            common={"metric_code": "2002"},
            breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": "0",
                        "mpl_amount_rubles": "10", "metric_element_counts": 8}],
        )

        with pytest.raises(FRValidationError) as exc:
            await service.group_save(req, "testuser")
        assert "602" in str(exc.value)
        fr_repo.group_save.assert_not_awaited()

    async def test_602_without_mpl_rejected(self, service, fr_repo, dict_repo):
        """Метрика 602 без MPL (только суммы по ТБ) — FRValidationError, репозиторий не вызывается."""
        dict_repo.get_terbanks.return_value = [{"tb_id": "7"}]
        req = FRGroupSaveRequest(
            group_key={**_group_key(), "metric_code": "602"},
            expected_row_ids=[101, 102],
            common={"metric_code": "602"},
            breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": "980000.00",
                        "metric_element_counts": 8}],
        )

        with pytest.raises(FRValidationError) as exc:
            await service.group_save(req, "testuser")
        assert "602" in str(exc.value)
        fr_repo.group_save.assert_not_awaited()

    async def test_602_with_mpl_passes(self, service, fr_repo, dict_repo):
        """Метрика 602 с MPL хотя бы у одного ТБ — сохранение проходит в репозиторий."""
        dict_repo.get_terbanks.return_value = [{"tb_id": "7"}]
        fr_repo.group_save.return_value = {"deactivated": 1, "inserted": 1, "skipped": 0}
        req = FRGroupSaveRequest(
            group_key={**_group_key(), "metric_code": "602"},
            expected_row_ids=[101, 102],
            common={"metric_code": "602"},
            breakdown=[{"neg_finder_tb_id": "7", "metric_amount_rubles": "980000.00",
                        "mpl_amount_rubles": "120000.00", "metric_element_counts": 8}],
        )

        result = await service.group_save(req, "testuser")

        fr_repo.group_save.assert_awaited_once()
        assert result == {"deactivated": 1, "inserted": 1, "skipped": 0}


# -------------------------------------------------------------------------
# group_delete
# -------------------------------------------------------------------------


class TestGroupDelete:

    async def test_delegates_to_repo(self, service, fr_repo):
        """Делегирует групповое удаление в fr_repo.group_delete."""
        fr_repo.group_delete.return_value = 2
        req = FRGroupDeleteRequest(group_key=_group_key(), expected_row_ids=[101, 102])

        result = await service.group_delete(req, "testuser")

        fr_repo.group_delete.assert_called_once_with(
            group_key=req.group_key.model_dump(),
            expected_row_ids=[101, 102],
            username="testuser",
        )
        assert result == 2
