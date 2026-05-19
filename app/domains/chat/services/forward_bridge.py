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

import asyncio
import logging
from collections.abc import AsyncGenerator
from typing import Any

from app.domains.chat.services.streaming import (
    emit_text_block_with_limit,
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
    from app.domains.chat.repositories.agent_request_repository import (
        AgentRequestRepository,
    )
    from app.domains.chat.services import agent_bridge_runner
    from app.domains.chat.services.agent_bridge import AgentBridgeService
    from app.domains.chat.services.block_emitter import emit_response_blocks
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

    last_seq: int | None = None
    poll_interval = settings.agent_bridge.poll_min_interval_sec
    # Аварийная защита от вечного цикла в самом оркестраторе на
    # случай, если раннер по какой-то причине не финализирует запрос.
    # Это запас сверх раннеровского max_total_duration_sec — раннер
    # всё равно сам прервёт запрос гейтом и пометит status=timeout.
    max_emit_seconds = settings.agent_bridge.max_total_duration_sec + 5
    emit_deadline = asyncio.get_event_loop().time() + max_emit_seconds

    while True:
        if asyncio.get_event_loop().time() > emit_deadline:
            logger.warning(
                "Forward: оркестратор завершает SSE-стрим по локальному "
                "deadline, request_id=%s (раннер продолжит в фоне)",
                request_id,
            )
            return

        # Открываем коннект только на ОДНУ итерацию — не держим
        # соединение из пула между poll-тиками.
        async with get_db() as conn:
            bridge = AgentBridgeService(conn)
            req_repo = AgentRequestRepository(conn)

            events = await bridge.poll_events(
                request_id, since_seq=last_seq,
            )
            for ev in events:
                last_seq = ev["seq"]
                et = ev["event_type"]
                if et == "reasoning":
                    chunk_text = (ev["payload"] or {}).get("text", "")
                    if not chunk_text:
                        continue
                    logger.info(
                        "Событие агента: тип=reasoning, длина=%d",
                        len(chunk_text),
                    )
                    # Каждый reasoning-чанк — отдельный сворачиваемый
                    # блок (start + delta + end), со своим block_index.
                    for sse in emit_text_block_with_limit(
                        block_index=block_index,
                        block_type="reasoning",
                        text=chunk_text,
                        chunk_flush_bytes=settings.delta_chunk_flush_bytes,
                        block_max_bytes=settings.delta_block_max_bytes,
                    ):
                        yield ("sse", sse)
                    block_index += 1
                elif et == "error":
                    payload = ev["payload"] or {}
                    err_message = payload.get(
                        "message", "Ошибка внешнего агента",
                    )
                    err_code = payload.get("code")
                    yield (
                        "sse",
                        sse_error(error=err_message, code=err_code),
                    )
                # status — информационное событие, игнорируем

            response = await bridge.poll_response(request_id)
            if response is not None:
                logger.info(
                    "Финальный ответ агента: request_id=%s, "
                    "blocks=%d, tokens=%s",
                    request_id,
                    len(response.get("blocks") or []),
                    response.get("token_usage"),
                )
                async for sse, idx in emit_response_blocks(
                    response["blocks"],
                    block_index_start=block_index,
                    message_id=message_id,
                ):
                    block_index = idx + 1
                    yield ("sse", sse)
                return

            # Финального ответа ещё нет. Проверяем статус: раннер
            # мог уже прервать запрос таймаут-гейтом или фатальной
            # ошибкой — тогда финализируем SSE error'ом и выходим.
            req = await req_repo.get(request_id)
            if req is not None and req.get("status") in (
                "error", "timeout",
            ):
                status = req["status"]
                err_text = (
                    req.get("error_message")
                    or "Ошибка внешнего агента"
                )
                err_code = (
                    "agent_timeout" if status == "timeout" else "agent_error"
                )
                if status == "timeout":
                    err_text = (
                        "Внешний агент не ответил вовремя. "
                        "Попробуйте позже."
                    )
                logger.warning(
                    "Forward: раннер пометил request_id=%s как %s: %s",
                    request_id, status, req.get("error_message"),
                )
                yield ("sse", sse_error(error=err_text, code=err_code))
                return

        await asyncio.sleep(poll_interval)
