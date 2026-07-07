"""Групповые контракты ЦКФР: консолидация строк валидации по ТБ."""

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from app.domains.ck_fin_res.schemas.fr_validation import FRValidationCreate


class GroupKey(BaseModel):
    """Ключ логической группы: (суб-акт, КМ, пункт акта, метрика).

    Для сохранения всегда передаётся СТАРЫЙ ключ (изменение ключевых полей
    «переносит» группу и переписывает все её строки).
    """

    act_sub_number_id: Optional[int] = None
    km_id: str = ""
    act_item_number: str = ""
    metric_code: str = ""


class TBBreakdownItem(BaseModel):
    """Строка развертки: один ТБ группы. Строка существует ⇔ сумма > 0."""

    neg_finder_tb_id: str = Field(..., min_length=1, max_length=200)
    metric_amount_rubles: Decimal = Field(..., gt=Decimal("0"))
    metric_element_counts: int = Field(default=0, ge=0)


class FRGroupSaveRequest(BaseModel):
    """Групповое сохранение: общие поля + итоговый состав ТБ.

    ``expected_row_ids`` — актуальные id строк группы, известные фронту;
    пустой список = создание новой группы. ``common`` — полный набор групповых
    полей (per-ТБ значения из него игнорируются — их источник ``breakdown``).
    """

    group_key: GroupKey
    expected_row_ids: list[int] = Field(default_factory=list)
    common: FRValidationCreate
    breakdown: list[TBBreakdownItem] = Field(..., min_length=1)

    @model_validator(mode="after")
    def _no_duplicate_tb(self) -> "FRGroupSaveRequest":
        tb_ids = [b.neg_finder_tb_id for b in self.breakdown]
        if len(tb_ids) != len(set(tb_ids)):
            raise ValueError("Дублирующиеся ТБ в развертке")
        return self


class FRGroupDeleteRequest(BaseModel):
    """Групповое удаление: деактивация всех строк группы."""

    group_key: GroupKey
    expected_row_ids: list[int] = Field(default_factory=list)
