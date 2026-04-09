"""Схемы запросов домена чата."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CreateConversationRequest(BaseModel):
    title: str | None = Field(None, max_length=500)
    domain_name: str | None = Field(None, max_length=100)
    context: dict[str, Any] | None = None


class UpdateConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
