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


class FormalizeRequest(BaseModel):
    """Запрос на формализацию: свободный текст нарушения."""

    text: str = Field(..., min_length=1)


class FormalizeResponse(BaseModel):
    """Поля карточки нарушения, извлечённые из текста (пустые — что LLM не нашла).

    ``measures`` вычисляется, но во фронте в карточку НЕ записывается (поля нет).
    """

    violated: str = ""
    established: str = ""
    reasons: str = ""
    responsible: str = ""
    consequences: str = ""
    measures: str = ""
