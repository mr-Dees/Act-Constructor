"""
Сервис CS-валидации.

Бизнес-логика работы с записями CS-валидации:
поиск, получение, создание, пакетное обновление, удаление,
а также диспетчеризация справочников.
"""

import logging

from app.core.settings_registry import get as get_domain_settings
from app.domains.ck_client_exp.exceptions import CSRecordNotFoundError
from app.domains.ck_client_exp.repositories.cs_validation_repository import (
    CSValidationRepository,
)
from app.domains.ck_client_exp.schemas.requests import FilterSpec
from app.domains.ck_client_exp.settings import CkClientExpSettings
from app.domains.ua_data.interfaces import IDictionaryRepository

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
        dict_repo: IDictionaryRepository,
    ):
        self.cs_repo = cs_repo
        self.dict_repo = dict_repo

    # ------------------------------------------------------------------
    # ПОИСК
    # ------------------------------------------------------------------

    async def search(
        self,
        *,
        filters: dict[str, FilterSpec] | None = None,
        sort: list[tuple[str, str]] | None = None,
        sort_by: str | None = None,
        sort_dir: str = "asc",
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Поиск по колоночным фильтрам с сортировкой и пагинацией.

        Пробрасывает параметры в репозиторий; ``sort`` — упорядоченный список
        (колонка, направление) для многоколоночной сортировки. Размер страницы
        ограничивается ``working_set_cap`` домена. Возвращает {items, total,
        limit, offset}.
        """
        settings = get_domain_settings("ck_client_exp", CkClientExpSettings)
        capped_limit = min(limit, settings.working_set_cap)
        items, total = await self.cs_repo.search_filtered(
            filters=filters,
            sort=sort,
            sort_by=sort_by,
            sort_dir=sort_dir,
            limit=capped_limit,
            offset=offset,
        )
        return {
            "items": items,
            "total": total,
            "limit": capped_limit,
            "offset": offset,
        }

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
            logger.warning("Запись CS-валидации id=%s не найдена", record_id)
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
            logger.warning("Запись CS-валидации id=%s не найдена при удалении", record_id)
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
