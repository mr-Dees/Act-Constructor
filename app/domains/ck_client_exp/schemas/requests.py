"""Схемы запросов домена ЦК Клиентский опыт."""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class FilterSpec(BaseModel):
    """Типизированный фильтр одной колонки (канон — СЫРОЕ значение, адаптация под тип).

    Операции:
    - ``contains`` — подстрока по сырому тексту (``value``);
    - ``in`` — членство по сырым значениям (``values``); для словарных колонок
      клиент резолвит имя→id заранее, пустой ``values`` означает «совпадений нет»;
    - ``range`` — диапазон по сырому с приведением типа (``cast`` ∈ {date, numeric},
      границы ``from``/``to``);
    - ``eq`` — точное равенство по сырому тексту (``value``);
    - ``contains_any`` — колонка содержит ЛЮБУЮ из фраз (поле ``values``; OR по
      ILIKE); пустой список → фильтр пропускается;
    """

    op: Literal["contains", "in", "range", "eq", "contains_any"]
    value: Optional[str] = None
    values: Optional[list[str]] = None
    from_: Optional[str] = Field(default=None, alias="from")
    to: Optional[str] = None
    cast: Optional[Literal["date", "numeric"]] = None

    model_config = ConfigDict(populate_by_name=True)


class SortSpec(BaseModel):
    """Одна колонка многоколоночной сортировки (приоритет — порядок в списке)."""

    by: str
    dir: Literal["asc", "desc"] = "asc"


class ValidationSearchRequest(BaseModel):
    """Параметры поиска записей CS-валидации (колоночные фильтры + сортировка)."""

    # Колоночные фильтры: {имя колонки → FilterSpec}. Имена валидируются против
    # whitelist в репозитории (защита от инъекций в ORDER BY/имена колонок).
    filters: dict[str, FilterSpec] = Field(default_factory=dict)
    sort_by: Optional[str] = None
    sort_dir: Literal["asc", "desc"] = "asc"
    # Многоколоночная сортировка по приоритету (перекрывает sort_by/sort_dir,
    # если непустая). Имена колонок валидируются против whitelist в репозитории.
    sort: list[SortSpec] = Field(default_factory=list)
    # Верхняя граница страницы определяется working_set_cap домена (сервис
    # клампит limit), поэтому жёсткого потолка в схеме нет.
    limit: int = Field(default=50, ge=1)
    offset: int = Field(default=0, ge=0)
