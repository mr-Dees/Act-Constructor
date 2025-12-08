"""
Pydantic схемы для валидации данных.

Определяет структуры данных для всех сущностей приложения:
акты, таблицы, текстовые блоки, нарушения и метаданные актов.
"""

from app.schemas.act_content import (
    ActDataSchema,
    ActItemSchema,
    ActSaveResponse,
    TableSchema,
    TableCellSchema,
    TextBlockSchema,
    TextBlockFormattingSchema,
    ViolationSchema,
    ViolationDescriptionListSchema,
    ViolationOptionalFieldSchema,
    ViolationContentItemSchema,
    ViolationAdditionalContentSchema,
)
from app.schemas.act_metadata import (
    AuditTeamMember,
    ActDirective,
    ActCreate,
    ActUpdate,
    ActListItem,
    ActResponse,
)

__all__ = [
    # Схемы содержимого актов
    "ActDataSchema",
    "ActItemSchema",
    "ActSaveResponse",
    "TableSchema",
    "TableCellSchema",
    "TextBlockSchema",
    "TextBlockFormattingSchema",
    "ViolationSchema",
    "ViolationDescriptionListSchema",
    "ViolationOptionalFieldSchema",
    "ViolationContentItemSchema",
    "ViolationAdditionalContentSchema",

    # Схемы метаданных актов
    "AuditTeamMember",
    "ActDirective",
    "ActCreate",
    "ActUpdate",
    "ActListItem",
    "ActResponse",
]
