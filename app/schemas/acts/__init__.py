"""
Pydantic схемы для домена актов.
"""

from app.schemas.acts.act_content import (
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
from app.schemas.acts.act_metadata import (
    AuditTeamMember,
    ActDirective,
    ActCreate,
    ActUpdate,
    ActListItem,
    ActResponse,
    AuditPointIdsRequest,
)
from app.schemas.acts.act_invoice import (
    InvoiceSave,
    InvoiceVerifyRequest,
    MetricItem,
)

__all__ = [
    # Содержимое актов
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
    # Метаданные актов
    "AuditTeamMember",
    "ActDirective",
    "ActCreate",
    "ActUpdate",
    "ActListItem",
    "ActResponse",
    "AuditPointIdsRequest",
    # Фактуры
    "InvoiceSave",
    "InvoiceVerifyRequest",
    "MetricItem",
]
