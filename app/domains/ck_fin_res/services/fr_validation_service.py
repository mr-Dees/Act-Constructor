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

# Фолбэк набора метрик «NPL 90+» для БД, где словарь метрик ещё без колонки
# has_npl (ALTER не выполнен). Источник истины — словарь
# t_db_oarb_ua_violation_metric_dict (флаг has_npl): бэкенд и фронт читают
# один и тот же флаг, ручная синхронизация списков больше не нужна.
NPL_METRIC_CODES_FALLBACK = frozenset({"602"})


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
        """Групповой поиск: страница логических строк (группа = суб-акт, КМ, пункт, метрика).

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

    async def _npl_metric_codes(self) -> frozenset[str]:
        """Коды метрик с показателем «NPL 90+» — из словаря метрик (has_npl).

        Если словарь ещё не отдаёт флаг (БД без колонки — в строках нет ключа
        has_npl) — фолбэк на прежний захардкоженный набор, поведение не
        меняется до миграции словаря."""
        metrics = await self.dict_repo.get_metric_codes()
        if any("has_npl" in m for m in metrics):
            return frozenset(str(m["code"]).strip() for m in metrics if m.get("has_npl"))
        return NPL_METRIC_CODES_FALLBACK

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
        npl_codes = await self._npl_metric_codes()
        metric = str(req.common.metric_code or "").strip()
        has_npl = any(item.npl_amount_rubles > 0 for item in req.breakdown)
        if metric not in npl_codes and has_npl:
            allowed = ", ".join(sorted(npl_codes))
            raise FRValidationError(
                f"Показатель «NPL 90+» заполняется только для метрики {allowed}"
                if allowed
                else "Показатель «NPL 90+» недоступен: в словаре метрик нет метрик с NPL 90+"
            )
        if metric in npl_codes and not has_npl:
            raise FRValidationError(
                f"Для метрики {metric} требуется распределение «NPL 90+» по ТБ"
            )
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
