"""Request/response DTO эндпоинтов text-actions."""

from pydantic import BaseModel, Field


class CorrectRequest(BaseModel):
    """Запрос на корректуру выделенного текста."""

    text: str = Field(..., min_length=1)


class CorrectResponse(BaseModel):
    """Ответ корректора — исправленный текст."""

    corrected_text: str
