"""Request/response DTO эндпоинтов text-actions."""

from typing import Literal

from pydantic import BaseModel, Field


class CorrectRequest(BaseModel):
    """Запрос на обработку выделенного текста.

    ``mode``: ``fix`` — орфография/пунктуация, ``readability`` — улучшение
    читаемости/структуры.
    """

    text: str = Field(..., min_length=1)
    mode: Literal["fix", "readability"] = "fix"


class CorrectResponse(BaseModel):
    """Ответ корректора — обработанный текст."""

    corrected_text: str
