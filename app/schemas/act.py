"""Pydantic схемы для валидации данных актов."""

from typing import List, Dict, Optional
from pydantic import BaseModel, Field


class MergedCell(BaseModel):
    """Информация об объединенной ячейке."""
    rowspan: int = 1
    colspan: int = 1


class TableSchema(BaseModel):
    """Схема таблицы."""
    rows: int = Field(gt=0, description="Количество строк")
    cols: int = Field(gt=0, description="Количество колонок")
    headers: List[str] = Field(default_factory=list, description="Заголовки колонок")
    data: List[List[str]] = Field(default_factory=list, description="Данные таблицы")
    mergedCells: Dict[str, MergedCell] = Field(
        default_factory=dict,
        description="Объединенные ячейки (ключ: 'row-col')"
    )


class ActItemSchema(BaseModel):
    """Схема пункта акта."""
    number: str = Field(description="Номер пункта")
    title: str = Field(description="Заголовок пункта")
    content: Optional[str] = Field(None, description="Содержание пункта")
    tables: List[TableSchema] = Field(default_factory=list, description="Таблицы в пункте")
    children: List['ActItemSchema'] = Field(
        default_factory=list,
        description="Подпункты"
    )


class ActDataSchema(BaseModel):
    """Полная схема данных акта."""
    tablesBefore: List[TableSchema] = Field(
        default_factory=list,
        description="Таблицы перед пунктом 1"
    )
    items: List[ActItemSchema] = Field(
        default_factory=list,
        description="Пункты акта"
    )


class ActSaveResponse(BaseModel):
    """Схема ответа при сохранении акта."""
    status: str
    message: str
    filename: str
