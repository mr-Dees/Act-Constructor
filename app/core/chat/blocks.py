"""Типы блоков сообщений чата.

Каждый блок — Pydantic-модель с литеральным дискриминатором ``type``.
Объединение ``MessageBlock`` используется для парсинга и сериализации
составных сообщений.
"""

from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Вспомогательные модели (не являются самостоятельными блоками)
# ---------------------------------------------------------------------------

class Button(BaseModel):
    """Кнопка чата — клик исполняется через ClientActionsRegistry на фронте.

    ``action_id`` должен соответствовать имени обработчика, зарегистрированного
    в ``window.ClientActionsRegistry`` на стороне браузера. Никаких HTTP-запросов
    на сервер по клику не делается.
    """

    action_id: str
    label: str
    params: dict[str, Any] = {}


class PlanStep(BaseModel):
    """Шаг плана с текстовой меткой и статусом выполнения."""

    label: str
    status: Literal["pending", "in_progress", "completed"]


# ---------------------------------------------------------------------------
# Блоки сообщений
# ---------------------------------------------------------------------------

class TextBlock(BaseModel):
    """Текстовый блок — основной формат содержимого сообщения."""

    type: Literal["text"] = "text"
    content: str


class CodeBlock(BaseModel):
    """Блок кода с подсветкой синтаксиса."""

    type: Literal["code"] = "code"
    language: str = "plain"
    content: str


class ReasoningBlock(BaseModel):
    """Блок рассуждений модели (chain-of-thought)."""

    type: Literal["reasoning"] = "reasoning"
    content: str


class PlanBlock(BaseModel):
    """Блок плана — упорядоченный список шагов с прогрессом."""

    type: Literal["plan"] = "plan"
    steps: list[PlanStep]


class FileBlock(BaseModel):
    """Блок прикреплённого файла."""

    type: Literal["file"] = "file"
    file_id: str
    filename: str
    mime_type: str
    file_size: int


class ImageBlock(BaseModel):
    """Блок изображения."""

    type: Literal["image"] = "image"
    file_id: str
    alt: str = ""


class ButtonGroup(BaseModel):
    """Группа кнопок — клик каждой кнопки исполняется через
    ClientActionsRegistry на фронте."""

    type: Literal["buttons"] = "buttons"
    buttons: list[Button]


class ClientActionBlock(BaseModel):
    """Команда фронту выполнить чисто-клиентское действие.

    Типы action и формат params определяются реестром ClientActionsRegistry
    на стороне браузера. Стандартные action: 'open_url', 'notify', 'trigger_sdk'.
    """

    type: Literal["client_action"] = "client_action"
    action: str
    params: dict[str, Any] = {}
    label: str | None = None


class ErrorBlock(BaseModel):
    """Блок сообщения об ошибке (например, от внешнего агента).

    Сохраняется в истории сообщения для отображения; в контекст LLM
    при формировании истории не попадает.
    """

    type: Literal["error"] = "error"
    message: str
    code: str | None = None


# ---------------------------------------------------------------------------
# Дискриминированное объединение всех блоков
# ---------------------------------------------------------------------------

MessageBlock = Union[
    TextBlock,
    CodeBlock,
    ReasoningBlock,
    PlanBlock,
    FileBlock,
    ImageBlock,
    ButtonGroup,
    ClientActionBlock,
    ErrorBlock,
]
