"""Polling-цикл для трансляции событий внешнего ИИ-агента в SSE.

Выделено из :mod:`forward_bridge` второй итерацией декомпозиции: один и
тот же цикл нужен и для основной forward-петли (``handle_forward_call``),
и для resume-эндпоинта (когда клиент переоткрывает SSE после refresh
страницы). Делать read-only helper'ом гарантирует 1:1 совпадение SSE-
формата для основного потока и для resume — фронт обрабатывает обе
ветки одним и тем же ``_handleSSEEvent``.

Контракт:

* Не запускает раннер (``agent_bridge_runner.schedule``) — это
  обязанность вызывающего кода. Resume-сценарий считает, что runner
  уже работает (либо подхватится reconcile через 30 секунд).
* Не сохраняет ассистент-message и не меняет ``agent_requests``.
* Поллит ``poll_events`` + ``poll_response`` + ``req_repo.get`` для
  обнаружения терминального статуса (error / timeout) — копия логики
  из ``forward_bridge.handle_forward_call``.
* Yield-ит пары ``(kind, payload)``:
    * ``("sse", "...SSE-строка...")`` — событие для StreamingResponse;
    * ``("error", "...SSE-error...")`` — финальная ошибка.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator
from typing import Any

from app.domains.chat.services.streaming import (
    emit_text_block_with_limit,
    sse_error,
)
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.forward_stream")


async def stream_forward_events(
    *,
    settings: ChatDomainSettings,
    request_id: str,
    message_id: str,
    block_index_start: int = 0,
    since_seq: int | None = None,
) -> AsyncGenerator[tuple[str, Any], None]:
    """Поллит мост-таблицы и yield'ит SSE-события для request_id.

    :param settings: настройки чата (для интервалов polling и лимитов блоков).
    :param request_id: идентификатор forward-запроса (agent_requests.id).
    :param message_id: идентификатор будущего ассистент-сообщения —
        пробрасывается в ``emit_response_blocks`` для детерминированного
        ``block_id`` ClientActionBlock'ов и в ``block_id`` reasoning-блоков
        (``f"{message_id}:reasoning:{seq}"``).
    :param block_index_start: начальный индекс блока в SSE-стриме
        (для resume — 0, для основного forward — текущий счётчик).
    :param since_seq: курсор «отдавать только события с seq > since_seq».
        Используется Resume SSE: фронт передаёт последний полученный seq,
        чтобы не получить уже отрисованный reasoning повторно. None —
        выдать всё с самого начала.
    """
    from app.db.connection import get_db
    from app.domains.chat.repositories.agent_request_repository import (
        AgentRequestRepository,
    )
    from app.domains.chat.services.agent_bridge import AgentBridgeService
    from app.domains.chat.services.block_emitter import emit_response_blocks

    last_seq: int | None = since_seq
    block_index = block_index_start
    poll_interval = settings.agent_bridge.poll_min_interval_sec
    # Аварийная защита от вечного цикла на стороне SSE: раннер сам имеет
    # max_total_duration_sec — даём небольшой запас сверху.
    max_emit_seconds = settings.agent_bridge.max_total_duration_sec + 5
    emit_deadline = asyncio.get_event_loop().time() + max_emit_seconds

    while True:
        if asyncio.get_event_loop().time() > emit_deadline:
            logger.warning(
                "stream_forward_events: SSE-стрим завершён по локальному "
                "deadline, request_id=%s",
                request_id,
            )
            return

        # Сначала ТОЛЬКО читаем БД и собираем «снимок» тика — никаких
        # yield'ов внутри `async with get_db()`. Yield внутри держал бы
        # коннект из пула на каждое SSE-событие; при нескольких
        # параллельных forward'ах под нагрузкой это приводит к
        # contention'у в пуле и зависанию обычных HTTP-запросов
        # (см. CLAUDE.md «yield внутри async with»).
        events_to_emit: list[dict] = []
        response_to_emit: dict | None = None
        terminal_status: tuple[str, str | None] | None = None

        async with get_db() as conn:
            bridge = AgentBridgeService(conn)
            req_repo = AgentRequestRepository(conn)

            events = await bridge.poll_events(
                request_id, since_seq=last_seq,
            )
            for ev in events:
                last_seq = ev["seq"]
                events_to_emit.append(ev)

            response_to_emit = await bridge.poll_response(request_id)
            if response_to_emit is None:
                req = await req_repo.get(request_id)
                if req is not None and req.get("status") in (
                    "error", "timeout",
                ):
                    terminal_status = (
                        req["status"], req.get("error_message"),
                    )

        # БД-коннект освобождён. Теперь — yield-им то, что собрали.
        for ev in events_to_emit:
            et = ev["event_type"]
            if et == "reasoning":
                chunk_text = (ev["payload"] or {}).get("text", "")
                if not chunk_text:
                    continue
                logger.info(
                    "Событие агента: тип=reasoning, длина=%d",
                    len(chunk_text),
                )
                # Детерминированный block_id: {message_id}:reasoning:{seq}.
                # При reconnect/reload фронт хранит Set уже отрендеренных
                # id и молча отбрасывает повторы. Без этого Resume SSE
                # перерисовывал reasoning N+1 раз при каждом открытии чата.
                reasoning_block_id = f"{message_id}:reasoning:{ev['seq']}"
                for sse in emit_text_block_with_limit(
                    block_index=block_index,
                    block_type="reasoning",
                    text=chunk_text,
                    chunk_flush_bytes=settings.delta_chunk_flush_bytes,
                    block_max_bytes=settings.delta_block_max_bytes,
                    block_id=reasoning_block_id,
                ):
                    yield ("sse", sse)
                block_index += 1
            elif et == "error":
                payload = ev["payload"] or {}
                err_message = payload.get(
                    "message", "Ошибка внешнего агента",
                )
                err_code = payload.get("code")
                yield ("sse", sse_error(error=err_message, code=err_code))
            # status — информационное событие, игнорируем

        if response_to_emit is not None:
            logger.info(
                "Финальный ответ агента: request_id=%s, "
                "blocks=%d, tokens=%s",
                request_id,
                len(response_to_emit.get("blocks") or []),
                response_to_emit.get("token_usage"),
            )
            async for sse, idx in emit_response_blocks(
                response_to_emit["blocks"],
                block_index_start=block_index,
                message_id=message_id,
            ):
                block_index = idx + 1
                yield ("sse", sse)
            return

        if terminal_status is not None:
            status, error_message = terminal_status
            if status == "timeout":
                err_text = (
                    "Внешний агент не ответил вовремя. Попробуйте позже."
                )
                err_code = "agent_timeout"
            else:
                err_text = error_message or "Ошибка внешнего агента"
                err_code = "agent_error"
            logger.warning(
                "stream_forward_events: request_id=%s помечен как %s: %s",
                request_id, status, error_message,
            )
            yield ("sse", sse_error(error=err_text, code=err_code))
            return

        await asyncio.sleep(poll_interval)
