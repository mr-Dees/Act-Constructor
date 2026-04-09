"""Схемы ответов домена чата."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ConversationResponse(BaseModel):
    id: str
    user_id: str
    title: str | None
    domain_name: str | None
    context: Any
    created_at: datetime
    updated_at: datetime


class ConversationListItem(BaseModel):
    id: str
    title: str | None
    domain_name: str | None
    created_at: datetime
    updated_at: datetime


class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: list[dict[str, Any]]
    model: str | None
    token_usage: dict[str, Any] | None
    created_at: datetime


class FileUploadResponse(BaseModel):
    id: str
    filename: str
    mime_type: str
    file_size: int
