"""
Сервис FR-валидации.

Бизнес-логика работы с записями FR-валидации:
поиск, получение, создание, пакетное обновление, удаление,
а также диспетчеризация справочников.
"""

import logging

from app.core.settings_registry import get as get_domain_settings
from app.domains.ck_fin_res.exceptions import FRRecordNotFoundError
from app.domains.ck_fin_res.repositories.fr_validation_repository import (
    FRValidationRepository,
)
from app.domains.ck_fin_res.schemas.requests import FilterSpec
from app.domains.ck_fin_res.settings import CkFinResSettings
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

# Статические доменные перечисления (домен FR-валидации). Возвращаются как
# список объектов {value, label} для единообразного формата с DB-справочниками.
_STATIC_DICTS: dict[str, list[dict]] = {
    "assignment_formats": [
        {"value": "Централизованный контроль", "label": "Централизованный контроль"},
        {"value": "Самостоятельный контроль", "label": "Самостоятельный контроль"},
        {"value": "Нет поручения", "label": "Нет поручения"},
    ],
    "used_pm_options": [
        {"value": "Да", "label": "Да"},
        {"value": "Нет", "label": "Нет"},
    ],
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
        settings = get_domain_settings("ck_fin_res", CkFinResSettings)
        capped_limit = min(limit, settings.working_set_cap)
        items, total = await self.fr_repo.search_filtered(
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

        Известные DB-справочники: processes, terbanks, metrics,
        departments, channels, products, teams, risk_types.
        Известные статические перечисления: assignment_formats, used_pm_options.
        Неизвестное имя возвращает пустой список.
        """
        if name in _STATIC_DICTS:
            return _STATIC_DICTS[name]

        method_name = _DICT_DISPATCH.get(name)
        if method_name is None:
            logger.warning("Запрошен неизвестный справочник: %s", name)
            return []

        method = getattr(self.dict_repo, method_name)
        return await method()
