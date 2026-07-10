"""
Сервис FR-валидации.

Бизнес-логика работы с записями FR-валидации: групповой поиск,
получение записи по ID, групповое сохранение/удаление,
а также диспетчеризация справочников.
"""

import logging

from app.core.settings_registry import get as get_domain_settings
from app.domains.ck_fin_res.exceptions import FRRecordNotFoundError, FRValidationError
from app.domains.ck_fin_res.repositories.fr_validation_repository import (
    FRValidationRepository,
)
from app.domains.ck_fin_res.schemas.group import FRGroupDeleteRequest, FRGroupSaveRequest
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

# Метрики с показателем «MPL 90+». Синхронизировано вручную с MPL_METRIC_CODES
# в static/js/portal/ck-fin-res/ck-fin-res-config.js.
MPL_METRIC_CODES = frozenset({"602"})


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
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Групповой поиск: страница логических строк (группа = пункт × метрика).

        Размер страницы ограничивается ``working_set_cap`` домена (кап ГРУПП).
        """
        settings = get_domain_settings("ck_fin_res", CkFinResSettings)
        capped_limit = min(limit, settings.working_set_cap)
        items, total = await self.fr_repo.search_groups(
            filters=filters, sort=sort, limit=capped_limit, offset=offset,
        )
        return {"items": items, "total": total, "limit": capped_limit, "offset": offset}

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
    # ГРУППОВОЕ СОХРАНЕНИЕ / УДАЛЕНИЕ
    # ------------------------------------------------------------------

    async def group_save(self, req: FRGroupSaveRequest, username: str) -> dict:
        """Валидирует ТБ развертки по справочнику и сохраняет группу дифом."""
        terbanks = await self.dict_repo.get_terbanks()
        valid_ids = {str(t["tb_id"]) for t in terbanks}
        unknown = sorted({b.neg_finder_tb_id for b in req.breakdown} - valid_ids)
        if unknown:
            raise FRValidationError(
                f"Неизвестные ТБ в развертке: {', '.join(unknown)}",
            )
        # Метрика — из common (новое записываемое состояние), а не из group_key
        # (старый ключ поиска группы): при переименовании метрики группы
        # правило должно проверяться против того, что реально сохраняется.
        metric = str(req.common.metric_code or "").strip()
        has_mpl = any(item.mpl_amount_rubles > 0 for item in req.breakdown)
        if metric not in MPL_METRIC_CODES and has_mpl:
            raise FRValidationError("Показатель «MPL 90+» заполняется только для метрики 602")
        if metric in MPL_METRIC_CODES and not has_mpl:
            raise FRValidationError("Для метрики 602 требуется распределение «MPL 90+» по ТБ")
        return await self.fr_repo.group_save(
            group_key=req.group_key.model_dump(),
            expected_row_ids=req.expected_row_ids,
            common=req.common.model_dump(),
            breakdown=[b.model_dump() for b in req.breakdown],
            username=username,
        )

    async def group_delete(self, req: FRGroupDeleteRequest, username: str) -> int:
        """Групповое удаление (деактивация всех строк группы)."""
        return await self.fr_repo.group_delete(
            group_key=req.group_key.model_dump(),
            expected_row_ids=req.expected_row_ids,
            username=username,
        )

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
