"""Схемы запросов домена ЦК Фин.Рез."""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class FilterSpec(BaseModel):
    """Типизированный по-колоночный фильтр (канон — сырьё, адаптация под тип).

    Операции:
    - ``contains`` — подстрока по сырому тексту (поле ``value``);
    - ``in`` — членство по сырым значениям (поле ``values``; для словарей);
    - ``range`` — диапазон по сырому с приведением типа (``from``/``to`` + ``cast``);
    - ``eq`` — точное равенство по сырому тексту (поле ``value``).

    Поле ``from`` конфликтует с ключевым словом Python, поэтому объявлено как
    ``from_`` с ``alias="from"``; ``populate_by_name=True`` позволяет заполнять
    и по имени поля, и по алиасу.
    """

    model_config = ConfigDict(populate_by_name=True)

    op: Literal["contains", "in", "range", "eq"]
    value: Optional[str] = None
    values: Optional[list[str]] = None
    from_: Optional[str] = Field(default=None, alias="from")
    to: Optional[str] = None
    cast: Optional[Literal["date", "numeric"]] = None


class SortSpec(BaseModel):
    """Одна колонка многоколоночной сортировки (приоритет — порядок в списке)."""

    by: str
    dir: Literal["asc", "desc"] = "asc"


class ValidationSearchRequest(BaseModel):
    """Параметры поиска записей FR-валидации."""

    # Колоночные фильтры: {имя колонки → FilterSpec}. Отсутствие ключа = нет
    # фильтра. Имена колонок валидируются против whitelist в репозитории
    # (защита от инъекций в имена колонок).
    filters: dict[str, FilterSpec] = Field(default_factory=dict)
    # Многоколоночная сортировка по приоритету. Имена колонок валидируются
    # против whitelist в репозитории.
    sort: list[SortSpec] = Field(default_factory=list)
    # Верхняя граница страницы определяется working_set_cap домена (сервис
    # клампит limit), поэтому жёсткого потолка в схеме нет.
    limit: int = Field(default=50, ge=1)
    offset: int = Field(default=0, ge=0)
