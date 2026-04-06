"""Схемы запросов домена чата."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CreateConversationRequest(BaseModel):
    title: str | None = None
    domain_name: str | None = None
    context: dict[str, Any] | None = None


class UpdateConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)


class SendMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=10000)
    domains: list[str] | None = None
    context: dict[str, Any] | None = None
