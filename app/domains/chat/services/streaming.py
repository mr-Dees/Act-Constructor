"""SSE-форматирование событий для стримингового чата."""

from __future__ import annotations

import json
from typing import Any


def format_sse_event(event_type: str, data: dict[str, Any]) -> str:
    """Форматирует SSE-событие: event: {type}\\ndata: {json}\\n\\n."""
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event_type}\ndata: {payload}\n\n"


def sse_message_start(*, conversation_id: str, message_id: str) -> str:
    """Начало ответа ассистента."""
    return format_sse_event("message_start", {
        "conversation_id": conversation_id,
        "message_id": message_id,
    })


def sse_block_start(*, block_index: int, block_type: str) -> str:
    """Начало нового блока контента."""
    return format_sse_event("block_start", {
        "index": block_index,
        "type": block_type,
    })


def sse_block_delta(*, block_index: int, delta: str) -> str:
    """Инкрементальное обновление блока (текстовый дельта)."""
    return format_sse_event("block_delta", {
        "index": block_index,
        "delta": delta,
    })


def sse_block_end(*, block_index: int) -> str:
    """Конец блока контента."""
    return format_sse_event("block_end", {
        "index": block_index,
    })


def sse_tool_call(
    *,
    tool_name: str,
    tool_call_id: str,
    arguments: dict[str, Any],
) -> str:
    """LLM вызвал инструмент."""
    return format_sse_event("tool_call", {
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
        "arguments": arguments,
    })


def sse_tool_result(
    *,
    tool_name: str,
    tool_call_id: str,
    result: str,
) -> str:
    """Результат выполнения инструмента."""
    return format_sse_event("tool_result", {
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
        "result": result[:500],  # лимитируем для SSE
    })


def sse_tool_error(
    *,
    tool_name: str,
    tool_call_id: str,
    message: str,
) -> str:
    """Ошибка вызова инструмента (валидация параметров, недопустимый tool).

    Отличается от ``sse_tool_result`` тем, что фронт показывает пользователю
    нейтральное сообщение и НЕ ожидает дальнейшего content по этому tool.
    """
    return format_sse_event("tool_error", {
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
        "message": message,
    })


def sse_plan_update(*, steps: list[dict[str, Any]]) -> str:
    """Обновление плана действий."""
    return format_sse_event("plan_update", {
        "steps": steps,
    })


def sse_buttons(*, buttons: list[dict[str, Any]]) -> str:
    """Кнопки действий для пользователя."""
    return format_sse_event("buttons", {
        "buttons": buttons,
    })


def sse_client_action(*, block: dict[str, Any]) -> str:
    """Команда фронту выполнить чисто-клиентское действие сразу.

    Содержит полный ClientActionBlock (action, params, label).
    Фронт исполняет команду через ClientActionsRegistry один раз.
    """
    return format_sse_event("client_action", {"block": block})


def sse_block_complete(*, block_index: int, block: dict[str, Any]) -> str:
    """Отдаёт цельный нестримуемый блок (file, image, plan, error, ...).

    Стримуемые типы (text, code, reasoning) передаются триплетом
    block_start/block_delta/block_end. Остальные блоки рендерятся
    разом из payload — этот хелпер и используется фронтом, чтобы
    показать их сразу при получении, не дожидаясь перезагрузки.
    """
    return format_sse_event("block_complete", {
        "index": block_index,
        "block": block,
    })


def sse_agent_request_started(
    *,
    request_id: str,
    conversation_id: str,
) -> str:
    """Сигнал фронту: forward-запрос зарегистрирован, его id известен.

    Фронт может сохранить request_id и при разрыве соединения переоткрыть
    resume-стрим:
        GET /api/v1/chat/conversations/{cid}/agent-request/{rid}/stream
    """
    return format_sse_event("agent_request_started", {
        "request_id": request_id,
        "conversation_id": conversation_id,
    })


def sse_message_end(
    *,
    message_id: str,
    model: str | None = None,
    token_usage: dict[str, Any] | None = None,
) -> str:
    """Конец ответа ассистента."""
    return format_sse_event("message_end", {
        "message_id": message_id,
        "model": model,
        "token_usage": token_usage,
    })


def sse_error(*, error: str, code: str | None = None) -> str:
    """Ошибка во время обработки."""
    data: dict[str, Any] = {"error": error}
    if code:
        data["code"] = code
    return format_sse_event("error", data)
