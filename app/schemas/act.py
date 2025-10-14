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


class TextBlockFormattingSchema(BaseModel):
    """Схема форматирования текстового блока."""
    bold: bool = False
    italic: bool = False
    underline: bool = False
    fontSize: int = 14
    alignment: str = "left"


class TextBlockSchema(BaseModel):
    """Схема текстового блока."""
    id: str = Field(description="ID текстового блока")
    nodeId: str = Field(description="ID узла дерева")
    content: str = Field(default="", description="Содержимое текстового блока")
    formatting: TextBlockFormattingSchema = Field(
        default_factory=TextBlockFormattingSchema,
        description="Настройки форматирования"
    )


class ActItemSchema(BaseModel):
    """Схема пункта акта."""
    number: str = Field(description="Номер пункта")
    title: str = Field(description="Заголовок пункта")
    content: Optional[str] = Field(None, description="Содержание пункта")
    tables: List[TableSchema] = Field(default_factory=list, description="Таблицы в пункте")
    textBlocks: List[TextBlockSchema] = Field(default_factory=list, description="Текстовые блоки в пункте")
    children: List['ActItemSchema'] = Field(default_factory=list, description="Подпункты")


class ActDataSchema(BaseModel):
    """Полная схема акта."""
    tree: Dict = Field(description="Дерево структуры акта")
    tables: Dict[str, TableSchema] = Field(default_factory=dict, description="Словарь таблиц")
    textBlocks: Dict[str, TextBlockSchema] = Field(default_factory=dict, description="Словарь текстовых блоков")


class ActSaveResponse(BaseModel):
    """Ответ при сохранении акта."""
    status: str
    message: str
    filename: str


# Обновление forward references для рекурсивной схемы
ActItemSchema.model_rebuild()
