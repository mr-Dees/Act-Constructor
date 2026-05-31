"""Контейнер данных для DOCX-форматера."""
from dataclasses import dataclass

from app.domains.acts.schemas.act_content import ActDataSchema
from app.domains.acts.schemas.act_metadata import ActResponse


@dataclass(frozen=True, slots=True)
class ExportContext:
    """Полный контекст для генерации DOCX.

    metadata — из ActCrudService.get_act, content — из ActContentService.
    """
    metadata: ActResponse
    content: ActDataSchema
