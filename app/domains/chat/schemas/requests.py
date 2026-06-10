"""Схемы запросов домена чата."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CreateConversationRequest(BaseModel):
    title: str | None = Field(None, max_length=500)
    domain_name: str | None = Field(None, max_length=100)
    context: dict[str, Any] | None = None


class UpdateConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)


class MessageFeedbackRequest(BaseModel):
    """Тело PUT-запроса оценки сообщения ассистента.

    ``reasons`` и ``comment`` имеют смысл только для ``rating='down'``
    (для лайка игнорируются сервисом). Коды причин, длина комментария и
    словарь ``agent_mode`` (off/adaptive/always) валидируются в
    ChatFeedbackService (дружелюбные 422-сообщения).
    """
    rating: Literal["up", "down"]
    reasons: list[str] | None = None
    comment: str | None = None
    agent_mode: str | None = Field(None, max_length=16)
