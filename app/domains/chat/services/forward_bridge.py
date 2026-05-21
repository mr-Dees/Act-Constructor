"""Forward-bridge: регистрация запроса к внешнему ИИ-агенту.

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
* Yield-ит ровно одно SSE-событие ``agent_request_started`` и
  завершается. **Polling событий внешнего агента живёт не здесь**: фронт
  по получению ``agent_request_started`` открывает Resume SSE-эндпоинт
  (``/forward-stream/{request_id}``), который стримит дальше через
  :func:`stream_forward_events`.

Почему так: раньше POST /messages SSE оставался открытым на всё время
polling'а (могут быть минуты), и при переключении между чатами в
браузере накапливалось 4-6 живых SSE на один origin (POST chat A +
POST chat B + Resume chat A + Resume chat B + …). Chrome HTTP/1.1
per-origin connection limit = 6, и юзер ловил UI freeze. С коротким
POST SSE на каждый forward живёт ровно 1 Resume.

Yield-ит пары ``(kind, payload)``:
    * ``("sse", "...SSE-строка...")`` — событие для StreamingResponse;
    * ``("error", "...SSE-error...")`` — фатальная ошибка регистрации.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import Any

from app.domains.chat.exceptions import ChatLimitError
from app.domains.chat.services.forward_limit import (
    check_and_acquire,
    release,
)
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
    """Регистрирует agent_request и yield-ит ``agent_request_started``.

    После этого завершается — стрим событий внешнего агента идёт через
    Resume SSE-эндпоинт, который фронт открывает по получению
    ``agent_request_started``. Раннер (фон) сохраняет финальное сообщение.

    ``block_index`` оставлен в сигнатуре для совместимости вызывающего
    кода, но больше не используется: подсчёт block_index делает Resume.
    """
    # Лениво импортируем тяжёлые внутренности — модуль остаётся дешёвым на
    # этапе сборки приложения.
    del block_index  # больше не нужен: подсчёт блоков в Resume SSE
    from app.db.connection import get_db
    from app.domains.chat.integrations.forward_handler import (
        FORWARD_SENTINEL_PATTERN,
    )
    from app.domains.chat.services import agent_bridge_runner
    from app.domains.chat.services.forward_tool_factory import (
        build_forward_tool,
    )

    # Per-user лимит активных forward'ов. POST SSE короткий — семафор
    # `_active_streams_per_user` в api/messages.py не лимитирует число
    # реальных forward'ов в полёте; считаем их здесь, декремент в
    # agent_bridge_runner._run finally.
    try:
        check_and_acquire(user_id, settings.max_parallel_streams_per_user)
    except ChatLimitError as exc:
        logger.warning(
            "Forward отклонён (лимит): user=%s, limit=%d",
            user_id, settings.max_parallel_streams_per_user,
        )
        yield ("error", sse_error(error=str(exc), code="forward_limit"))
        return

    # Регистрация запроса — отдельным коротким соединением.
    try:
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
    except Exception:
        # Регистрация упала — раннер не стартует, finally release не вызовется.
        release(user_id)
        raise
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
    # сообщение независимо от SSE-соединения.
    agent_bridge_runner.schedule(request_id, settings=settings)

    # Единственное SSE-событие: сообщаем фронту request_id. Дальше фронт
    # открывает Resume SSE через GET /forward-stream/{request_id}.
    yield (
        "sse",
        sse_agent_request_started(
            request_id=request_id,
            conversation_id=conversation_id,
        ),
    )
