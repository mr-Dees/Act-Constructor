"""
Реестр ChatTool для AI-ассистента.

Каждый домен регистрирует свои инструменты (ChatTool) при обнаружении.
Endpoint чата собирает все инструменты и передаёт их LLM
в формате OpenAI function-calling.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

logger = logging.getLogger("audit_workstation.core.chat_tools")


@dataclass(frozen=True)
class ChatToolParam:
    """Параметр инструмента чата (маппится на JSON Schema property)."""

    name: str
    type: str  # "string", "integer", "boolean", "array", "object", "date"
    description: str
    required: bool = True
    default: Any = None
    enum: list[str] | None = None
    items_type: str = "string"  # тип элементов для type="array"


@dataclass(frozen=True)
class ChatTool:
    """
    Инструмент домена для AI-чата.

    Маппится на OpenAI function-calling формат:
    {
        "type": "function",
        "function": {
            "name": self.name,
            "description": self.description,
            "parameters": { ... из self.parameters ... }
        }
    }
    """

    name: str
    domain: str
    description: str
    parameters: list[ChatToolParam] = field(default_factory=list)
    handler: Callable[..., Awaitable[str]] | None = field(default=None)
    category: str = ""
    # Транслятор кнопки: принимает params серверной кнопки (action_id=имя tool'а),
    # возвращает {"action": <client-action-id>, "params": {...}} или None
    # (если транслировать нечего — кнопка передаётся как есть).
    button_translator: (
        Callable[[dict], Awaitable[dict | None]] | None
    ) = field(default=None)

    def to_openai_tool(self) -> dict:
        """Конвертация в OpenAI function-calling формат."""
        properties = {}
        required = []
        for p in self.parameters:
            # "date" → JSON Schema "string" с format "date"
            schema_type = "string" if p.type == "date" else p.type
            prop: dict[str, Any] = {"type": schema_type, "description": p.description}
            if p.type == "date":
                prop["format"] = "date"
            if p.enum:
                prop["enum"] = p.enum
            if p.default is not None:
                prop["default"] = p.default
            if schema_type == "array":
                prop["items"] = {"type": p.items_type}
            properties[p.name] = prop
            if p.required:
                required.append(p.name)

        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                    "additionalProperties": False,
                },
            },
        }


# ── Реестр ──

_tools: dict[str, ChatTool] = {}


def register_tools(tools: list[ChatTool]) -> None:
    """Регистрация инструментов домена (вызывается из domain_registry)."""
    for tool in tools:
        if tool.name in _tools:
            raise RuntimeError(
                f"ChatTool '{tool.name}' уже зарегистрирован "
                f"доменом '{_tools[tool.name].domain}'"
            )
        if tool.handler is None:
            logger.warning(
                "ChatTool '%s' (домен '%s') зарегистрирован без handler — "
                "вызов инструмента LLM вернёт ошибку",
                tool.name, tool.domain,
            )
        _tools[tool.name] = tool
        logger.debug("Зарегистрирован ChatTool: %s", tool.name)


def get_all_tools() -> list[ChatTool]:
    """Все зарегистрированные инструменты."""
    return list(_tools.values())


def get_tool(name: str) -> ChatTool | None:
    """Инструмент по имени."""
    return _tools.get(name)


def get_tools_by_domain(domain: str) -> list[ChatTool]:
    """Все инструменты конкретного домена."""
    return [t for t in _tools.values() if t.domain == domain]


def get_openai_tools() -> list[dict]:
    """Все инструменты в OpenAI function-calling формате."""
    return [t.to_openai_tool() for t in _tools.values()]


def reset() -> None:
    """Для тестов."""
    _tools.clear()
