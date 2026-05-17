"""
Сервис FR-валидации.

Бизнес-логика работы с записями FR-валидации:
поиск, получение, создание, пакетное обновление, удаление,
а также диспетчеризация справочников.
"""

import logging
from datetime import date

from app.domains.ck_fin_res.exceptions import FRRecordNotFoundError
from app.domains.ck_fin_res.repositories.fr_validation_repository import (
    FRValidationRepository,
)
from app.domains.ua_data.interfaces import IDictionaryRepository

logger = logging.getLogger("audit_workstation.domains.ck_fin_res.service")

# Маппинг имён справочников на методы DictionaryRepository
_DICT_DISPATCH = {
    "processes": "get_processes",
    "terbanks": "get_terbanks",
    "metrics": "get_metric_codes",
    "departments": "get_departments",
    "channels": "get_channels",
    "products": "get_products",
    "teams": "get_teams",
    "risk_types": "get_risk_types",
}


class FRValidationService:
    """Сервис бизнес-логики FR-валидации."""

    def __init__(
        self,
        fr_repo: FRValidationRepository,
        dict_repo: IDictionaryRepository,
    ):
        self.fr_repo = fr_repo
        self.dict_repo = dict_repo

    # ------------------------------------------------------------------
    # ПОИСК
    # ------------------------------------------------------------------

    async def search_records(
        self,
        start_date: date | None = None,
        end_date: date | None = None,
        metric_code: list[str] | None = None,
        process_code: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """Поиск записей FR-валидации по фильтрам."""
        return await self.fr_repo.search(
            start_date=start_date,
            end_date=end_date,
            metric_code=metric_code,
            process_code=process_code,
            limit=limit,
            offset=offset,
        )

    # ------------------------------------------------------------------
    # ПОЛУЧЕНИЕ ПО ID
    # ------------------------------------------------------------------

    async def get_record(self, record_id: int) -> dict:
        """
        Возвращает запись FR-валидации по ID.

        Raises:
            FRRecordNotFoundError: если запись не найдена
        """
        record = await self.fr_repo.get_by_id(record_id)
        if record is None:
            logger.warning("Запись FR-валидации id=%s не найдена", record_id)
            raise FRRecordNotFoundError(f"Запись FR-валидации id={record_id} не найдена")
        return record

    # ------------------------------------------------------------------
    # СОЗДАНИЕ
    # ------------------------------------------------------------------

    async def create_record(self, data: dict, username: str) -> dict:
        """Создаёт новую запись FR-валидации."""
        return await self.fr_repo.create(data, username)

    # ------------------------------------------------------------------
    # ПАКЕТНОЕ ОБНОВЛЕНИЕ
    # ------------------------------------------------------------------

    async def batch_update_records(self, items: list[dict], username: str) -> int:
        """Пакетное обновление записей FR-валидации."""
        return await self.fr_repo.batch_update(items, username)

    # ------------------------------------------------------------------
    # УДАЛЕНИЕ
    # ------------------------------------------------------------------

    async def delete_record(self, record_id: int, username: str) -> bool:
        """
        Мягкое удаление записи FR-валидации.

        Raises:
            FRRecordNotFoundError: если запись не найдена или уже удалена
        """
        deleted = await self.fr_repo.soft_delete(record_id, username)
        if not deleted:
            logger.warning("Запись FR-валидации id=%s не найдена при удалении", record_id)
            raise FRRecordNotFoundError(f"Запись FR-валидации id={record_id} не найдена")
        return deleted

    # ------------------------------------------------------------------
    # СПРАВОЧНИКИ
    # ------------------------------------------------------------------

    async def get_dictionary(self, name: str) -> list[dict]:
        """
        Возвращает данные справочника по имени.

        Известные справочники: processes, terbanks, metrics,
        departments, channels, products, teams.
        Неизвестное имя возвращает пустой список.
        """
        method_name = _DICT_DISPATCH.get(name)
        if method_name is None:
            logger.warning("Запрошен неизвестный справочник: %s", name)
            return []

        method = getattr(self.dict_repo, method_name)
        return await method()
