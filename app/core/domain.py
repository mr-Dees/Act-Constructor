"""
Дескриптор домена для plugin-архитектуры.

Определяет структуру, которую каждый домен должен экспортировать
для автоматической регистрации в приложении.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Awaitable, Callable

from fastapi import APIRouter, FastAPI
from pydantic import BaseModel

from app.core.chat_tools import ChatTool


@dataclass(frozen=True)
class KnowledgeBase:
    """База знаний домена для AI-ассистента."""

    key: str           # "knowledge_base_oarb" — ключ для localStorage
    label: str         # "База Знаний ОАРБ" — отображаемое имя
    description: str   # "Поиск по базе знаний..." — описание для toggle


@dataclass(frozen=True)
class NavItem:
    """Элемент навигации домена в sidebar."""

    label: str          # "Управление актами"
    url: str            # "/acts"
    icon_svg: str       # SVG path для иконки
    order: int = 100    # порядок сортировки (меньше = выше)
    active_page: str = ""  # значение для {{ active_page }} в шаблоне
    chat_domains: list[str] = field(default_factory=list)  # домены для фильтрации chat tools
    group: str = ""     # группа в sidebar (пустая строка = без группы)


@dataclass
class DomainDescriptor:
    """
    Описание домена для авто-регистрации.

    Каждый домен экспортирует объект `domain` этого типа из своего __init__.py.
    """
    name: str
    api_routers: list[tuple[APIRouter, str, list[str]]] = field(default_factory=list)
    html_routers: list[APIRouter] = field(default_factory=list)
    settings_class: type[BaseModel] | None = None
    exception_handlers: dict[type[Exception], Callable] | None = None
    dependencies: list[str] = field(default_factory=list)
    on_startup: Callable[[FastAPI], Awaitable[None]] | None = None
    on_shutdown: Callable[[FastAPI], Awaitable[None]] | None = None
    package_path: Path | None = None
    chat_tools: list[ChatTool] = field(default_factory=list)
    nav_items: list[NavItem] = field(default_factory=list)
    knowledge_bases: list[KnowledgeBase] = field(default_factory=list)
    chat_system_prompt: str = ""
    migration_substitutions: dict[str, str] = field(default_factory=dict)
