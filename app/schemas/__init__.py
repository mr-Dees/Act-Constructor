"""
Pydantic схемы для валидации данных.

Определяет структуры данных для всех сущностей приложения:
акты, таблицы, текстовые блоки, нарушения.
"""

from app.schemas.act import (
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

__all__ = [
    'ActDataSchema',
    'ActItemSchema',
    'ActSaveResponse',
    'TableSchema',
    'TableCellSchema',
    'TextBlockSchema',
    'TextBlockFormattingSchema',
    'ViolationSchema',
    'ViolationDescriptionListSchema',
    'ViolationOptionalFieldSchema',
    'ViolationContentItemSchema',
    'ViolationAdditionalContentSchema',
]
