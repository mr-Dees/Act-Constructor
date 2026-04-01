"""
Сервис CS-валидации.

Бизнес-логика работы с записями CS-валидации:
поиск, получение, создание, пакетное обновление, удаление,
а также диспетчеризация справочников.
"""

import logging
from datetime import date

from app.domains.ck_client_exp.exceptions import CSRecordNotFoundError
from app.domains.ck_client_exp.repositories.cs_validation_repository import (
    CSValidationRepository,
)
from app.domains.ua_data.repositories.dictionary_repository import (
    DictionaryRepository,
)

logger = logging.getLogger("audit_workstation.domains.ck_client_exp.service")

# Маппинг имён справочников на методы DictionaryRepository
_DICT_DISPATCH = {
    "processes": "get_processes",
    "terbanks": "get_terbanks",
    "metrics": "get_metric_codes",
    "departments": "get_departments",
    "channels": "get_channels",
    "products": "get_products",
    "teams": "get_teams",
}


class CSValidationService:
    """Сервис бизнес-логики CS-валидации."""

    def __init__(
        self,
        cs_repo: CSValidationRepository,
        dict_repo: DictionaryRepository,
    ):
        self.cs_repo = cs_repo
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
    ) -> list[dict]:
        """Поиск записей CS-валидации по фильтрам."""
        return await self.cs_repo.search(
            start_date=start_date,
            end_date=end_date,
            metric_code=metric_code,
            process_code=process_code,
        )

    # ------------------------------------------------------------------
    # ПОЛУЧЕНИЕ ПО ID
    # ------------------------------------------------------------------

    async def get_record(self, record_id: int) -> dict:
        """
        Возвращает запись CS-валидации по ID.

        Raises:
            CSRecordNotFoundError: если запись не найдена
        """
        record = await self.cs_repo.get_by_id(record_id)
        if record is None:
            raise CSRecordNotFoundError(f"Запись CS-валидации id={record_id} не найдена")
        return record

    # ------------------------------------------------------------------
    # СОЗДАНИЕ
    # ------------------------------------------------------------------

    async def create_record(self, data: dict, username: str) -> dict:
        """Создаёт новую запись CS-валидации."""
        return await self.cs_repo.create(data, username)

    # ------------------------------------------------------------------
    # ПАКЕТНОЕ ОБНОВЛЕНИЕ
    # ------------------------------------------------------------------

    async def batch_update_records(self, items: list[dict], username: str) -> int:
        """Пакетное обновление записей CS-валидации."""
        return await self.cs_repo.batch_update(items, username)

    # ------------------------------------------------------------------
    # УДАЛЕНИЕ
    # ------------------------------------------------------------------

    async def delete_record(self, record_id: int, username: str) -> bool:
        """
        Мягкое удаление записи CS-валидации.

        Raises:
            CSRecordNotFoundError: если запись не найдена или уже удалена
        """
        deleted = await self.cs_repo.soft_delete(record_id, username)
        if not deleted:
            raise CSRecordNotFoundError(f"Запись CS-валидации id={record_id} не найдена")
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
