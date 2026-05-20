"""Forward-bridge: трансляция стрима внешнего ИИ-агента в SSE-стрим клиента.

Логика жила как ``Orchestrator._handle_forward_call`` (~210 строк). Вынесена
сюда отдельной свободной async-генератор-функцией:

* устраняет один из самых больших методов оркестратора, упрощая поддержку
  ``run_stream`` (и ускоряя любое будущее расщепление основной петли);
* делает поведение forward-моста независимым от внутреннего состояния
  ``Orchestrator`` — функция принимает ``settings`` параметром, что
  облегчает тестирование без mock'а целого оркестратора.

Контракт:

* Регистрирует ``agent_request`` через ``build_forward_tool`` + handler.
* Запускает фоновый раннер (``agent_bridge_runner.schedule``) — он держит
  таймауты и сохраняет финальное сообщение независимо от SSE-соединения.
* Сам polling-цикл открывает БД-соединение только на один тик
  (``async with get_db() as conn``) — не держит коннект из пула до 30 минут.
* Yield-ит пары ``(kind, payload)``:
    * ``("sse", "...SSE-строка...")`` — событие для StreamingResponse;
    * ``("error", "...SSE-error...")`` — фатальная ошибка регистрации.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import Any

from app.domains.chat.services.forward_stream import stream_forward_events
from app.domains.chat.services.streaming import (
    sse_agent_request_started,
    sse_error,
)
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.forward_bridge")


async def handle_forward_call(
    *,
    settings: ChatDomainSettings,
    conversation_id: str,
    message_id: str,
    user_id: str,
    domain_name: str | None,
    knowledge_bases: list[str],
    history: list[dict],
    files: list[dict],
    arguments: dict,
    block_index: int,
) -> AsyncGenerator[tuple[str, Any], None]:
    """Регистрирует agent_request и стримит ответы внешнего агента клиенту.

    См. doc-string модуля. Параметры идентичны прежнему
    ``Orchestrator._handle_forward_call``, плюс явно проброшенный ``settings``.
    """
    # Лениво импортируем тяжёлые внутренности — модуль остаётся дешёвым на
    # этапе сборки приложения.
    from app.db.connection import get_db
    from app.domains.chat.integrations.forward_handler import (
        FORWARD_SENTINEL_PATTERN,
    )
    from app.domains.chat.services import agent_bridge_runner
    from app.domains.chat.services.forward_tool_factory import (
        build_forward_tool,
    )

    # Регистрация запроса — отдельным соединением; держать его открытым
    # на всё время polling нельзя (могут быть десятки минут).
    async with get_db() as conn:
        forward_tool = build_forward_tool(
            conn=conn,
            conversation_id=conversation_id,
            message_id=message_id,
            user_id=user_id,
            domain_name=domain_name,
            knowledge_bases=knowledge_bases,
            history=history,
            files=files,
        )
        assert forward_tool.handler is not None
        sentinel = await forward_tool.handler(**arguments)
    match = FORWARD_SENTINEL_PATTERN.match(sentinel)
    if not match:
        logger.warning(
            "Forward: не удалось зарегистрировать agent_request "
            "для conversation=%s",
            conversation_id,
        )
        yield (
            "error",
            sse_error(
                error="Не удалось переадресовать запрос внешнему агенту.",
            ),
        )
        return
    request_id = match.group("request_id")
    logger.info(
        "Forward во внешний агент: request_id=%s, knowledge_bases=%s, "
        "history_len=%d, files=%d",
        request_id, knowledge_bases, len(history), len(files),
    )

    # Producer (раннер) сам откроет get_db() и сохранит финальное
    # сообщение даже если клиент закроет SSE-соединение. Гейты
    # таймаута и обновление статуса agent_requests — только в нём.
    agent_bridge_runner.schedule(request_id, settings=settings)

    # Сообщаем фронту request_id, чтобы при разрыве соединения он мог
    # переоткрыть resume-стрим.
    yield (
        "sse",
        sse_agent_request_started(
            request_id=request_id,
            conversation_id=conversation_id,
        ),
    )

    # Сам polling-цикл (poll_events / poll_response / req.status) живёт
    # в общем helper'е stream_forward_events: тот же код переиспользует
    # resume-эндпоинт SSE — чтобы форматы событий совпадали 1:1.
    async for kind, payload in stream_forward_events(
        settings=settings,
        request_id=request_id,
        message_id=message_id,
        block_index_start=block_index,
    ):
        yield (kind, payload)
