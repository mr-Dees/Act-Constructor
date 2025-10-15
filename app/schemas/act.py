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
        description="Форматирование текста"
    )


# НОВОЕ: Схемы для нарушений
class ViolationDescriptionListSchema(BaseModel):
    """Схема буллитного списка описаний."""
    enabled: bool = False
    items: List[str] = Field(default_factory=list)


class ViolationOptionalFieldSchema(BaseModel):
    """Схема опционального текстового поля."""
    enabled: bool = False
    content: str = ""


class ViolationSchema(BaseModel):
    """Схема нарушения."""
    id: str = Field(description="ID нарушения")
    nodeId: str = Field(description="ID узла дерева")
    violated: str = Field(default="", description="Текст для 'Нарушено'")
    established: str = Field(default="", description="Текст для 'Установлено'")
    descriptionList: ViolationDescriptionListSchema = Field(
        default_factory=ViolationDescriptionListSchema,
        description="Список описаний"
    )
    additionalText: ViolationOptionalFieldSchema = Field(
        default_factory=ViolationOptionalFieldSchema,
        description="Дополнительный текст"
    )
    reasons: ViolationOptionalFieldSchema = Field(
        default_factory=ViolationOptionalFieldSchema,
        description="Причины"
    )
    consequences: ViolationOptionalFieldSchema = Field(
        default_factory=ViolationOptionalFieldSchema,
        description="Последствия"
    )
    responsible: ViolationOptionalFieldSchema = Field(
        default_factory=ViolationOptionalFieldSchema,
        description="Ответственные"
    )


class ActItemSchema(BaseModel):
    """Схема пункта акта (рекурсивная)."""
    id: str
    label: str
    type: str = "item"
    content: Optional[str] = ""
    protected: Optional[bool] = False
    children: List['ActItemSchema'] = Field(default_factory=list)
    tableId: Optional[str] = None
    textBlockId: Optional[str] = None
    violationId: Optional[str] = None  # НОВОЕ


class ActDataSchema(BaseModel):
    """Полная схема данных акта."""
    tree: Dict = Field(description="Дерево структуры акта")
    tables: Dict[str, Dict] = Field(default_factory=dict, description="Таблицы")
    textBlocks: Dict[str, TextBlockSchema] = Field(
        default_factory=dict,
        description="Текстовые блоки"
    )
    violations: Dict[str, ViolationSchema] = Field(  # НОВОЕ
        default_factory=dict,
        description="Нарушения"
    )


class ActSaveResponse(BaseModel):
    """Ответ при сохранении акта."""
    status: str
    message: str
    filename: str


# Обновляем forward refs для рекурсивной схемы
ActItemSchema.model_rebuild()
