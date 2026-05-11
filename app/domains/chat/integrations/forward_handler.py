"""Handler инструмента chat.forward_to_knowledge_agent.

Стратегия: handler — это фабрика, замыкающая контекст текущего сообщения
(conversation_id, message_id, history, files и т.п.). Возвращаемая функция
делает INSERT в agent_requests через AgentBridgeService и возвращает
строковый sentinel "<<forwarded_request:UUID>>" — оркестратор распознаёт
его как сигнал переключиться в режим стрима из bridge.
"""
from __future__ import annotations

import re
from typing import Awaitable, Callable

import asyncpg

from app.domains.chat.services.agent_bridge import AgentBridgeService

FORWARD_SENTINEL_PATTERN = re.compile(
    r"^<<forwarded_request:(?P<request_id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}"
    r"-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>>$"
)


def make_forward_sentinel(request_id: str) -> str:
    """Формирует sentinel-строку для оркестратора."""
    return f"<<forwarded_request:{request_id}>>"


def build_forward_handler(
    *,
    conn: asyncpg.Connection,
    conversation_id: str,
    message_id: str,
    user_id: str,
    domain_name: str | None,
    knowledge_bases: list[str],
    history: list[dict],
    files: list[dict],
) -> Callable[..., Awaitable[str]]:
    """Возвращает асинхронный handler-замыкание под текущее сообщение.

    Handler вызывается оркестратором как обычный ChatTool: ему приходят
    параметры, заявленные в ChatTool — здесь это `question` и опц. `kb_hint`.
    """
    bridge = AgentBridgeService(conn)

    async def handler(*, question: str, kb_hint: str | None = None) -> str:
        kbs = list(knowledge_bases)
        if kb_hint and kb_hint not in kbs:
            kbs.append(kb_hint)
        request_id = await bridge.send(
            conversation_id=conversation_id,
            message_id=message_id,
            user_id=user_id,
            domain_name=domain_name,
            knowledge_bases=kbs,
            last_user_message=question,
            history=history,
            files=files,
        )
        return make_forward_sentinel(request_id)

    return handler
