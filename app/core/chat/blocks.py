"""Типы блоков сообщений чата.

Каждый блок — Pydantic-модель с литеральным дискриминатором ``type``.
Объединение ``MessageBlock`` используется для парсинга и сериализации
составных сообщений.
"""

from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, model_validator

# Whitelist разрешённых action-имён в ClientActionBlock.
# LLM не может изобрести произвольное action — оно должно быть зарегистрировано
# в JS-реестре `window.ClientActionsRegistry`. Если нужен новый action —
# добавь его и сюда, и в chat-client-actions.js одновременно.
ALLOWED_CLIENT_ACTIONS: frozenset[str] = frozenset({
    "open_url",
    "notify",
    "trigger_sdk",
})

# Whitelist URL-схем для action='open_url'. Защищает от LLM-инжекций вида
# javascript:..., data:text/html,..., vbscript:..., file:///...
ALLOWED_OPEN_URL_SCHEMES: tuple[str, ...] = (
    "http://", "https://", "mailto:", "/",
)


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

    action — имя из ALLOWED_CLIENT_ACTIONS (whitelist). Произвольные action
    отвергаются на парсинге, чтобы LLM не мог запросить выполнение
    незарегистрированного клиентского кода.

    Для action='open_url' дополнительно валидируется params.url: схема
    должна быть из ALLOWED_OPEN_URL_SCHEMES. Это защищает от LLM-инжекций
    вроде javascript:..., data:text/html,..., file:///etc/passwd.
    """

    type: Literal["client_action"] = "client_action"
    action: str
    params: dict[str, Any] = {}
    label: str | None = None

    @model_validator(mode="after")
    def _validate_action_and_params(self) -> "ClientActionBlock":
        if self.action not in ALLOWED_CLIENT_ACTIONS:
            raise ValueError(
                f"ClientActionBlock.action='{self.action}' не входит в "
                f"whitelist {sorted(ALLOWED_CLIENT_ACTIONS)}",
            )
        if self.action == "open_url":
            url = self.params.get("url")
            if not isinstance(url, str) or not url:
                raise ValueError(
                    "ClientActionBlock(action='open_url') требует params.url",
                )
            if not any(
                url.startswith(scheme)
                for scheme in ALLOWED_OPEN_URL_SCHEMES
            ):
                raise ValueError(
                    f"ClientActionBlock(action='open_url'): схема URL "
                    f"'{url[:30]}...' запрещена; допустимые: "
                    f"{ALLOWED_OPEN_URL_SCHEMES}",
                )
        return self


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
