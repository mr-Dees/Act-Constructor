"""Фабрика per-request инструмента ``chat.forward_to_knowledge_agent``.

Содержит бизнес-логику регистрации запроса во внешний ИИ-агент в виде
самодостаточного билдера ``ChatTool``. До рефакторинга та же логика
жила в ``orchestrator._handle_forward_call`` и закрытом handler'е из
``forward_handler.build_forward_handler`` (см. историю); вынесена сюда,
чтобы оркестратор не смешивал управление tool-loop'ом с деталями моста
к внешнему агенту.

Семантика handler'а: возвращает sentinel-строку ``"<<forwarded_request:UUID>>"``,
которую оркестратор распознаёт как сигнал переключиться в режим стрима
из bridge (см. ``forward_handler.FORWARD_SENTINEL_PATTERN``). Сам стрим
блоков клиенту по-прежнему делает оркестратор: данный модуль отвечает
только за регистрацию ``agent_request`` в БД.
"""
from __future__ import annotations

import asyncpg

from app.core.chat.names import TOOL_FORWARD_TO_KNOWLEDGE_AGENT
from app.core.chat.tools import ChatTool, ChatToolParam
from app.domains.chat.integrations.forward_handler import make_forward_sentinel
from app.domains.chat.services.agent_bridge import AgentBridgeService

_DOMAIN = "chat"

_DESCRIPTION = (
    "Передать вопрос пользователя внешнему ИИ-агенту коллег для "
    "ответа на основе баз знаний (акты, регламенты, нормативы и т.п.). "
    "Использовать для любых вопросов о ДАННЫХ/КОНТЕНТЕ; не использовать "
    "для команд интерфейса (открой/создай/настрой)."
)

_PARAMETERS = (
    ChatToolParam(
        "question", "string",
        "Полный текст вопроса пользователя",
    ),
    ChatToolParam(
        "kb_hint", "string",
        "Опц. подсказка какой БЗ касается вопрос",
        required=False,
    ),
)


def build_forward_tool_descriptor() -> ChatTool:
    """Статический ChatTool для ``forward_to_knowledge_agent``.

    Регистрируется при discover_domains() со ``handler=None`` и
    ``per_request_handler=True``: оркестратор каждый раз строит своё
    замыкание через :func:`build_forward_tool` под текущее сообщение.
    """
    return ChatTool(
        name=TOOL_FORWARD_TO_KNOWLEDGE_AGENT,
        domain=_DOMAIN,
        description=_DESCRIPTION,
        parameters=list(_PARAMETERS),
        handler=None,
        per_request_handler=True,
        category="forward",
    )


def build_forward_tool(
    *,
    conn: asyncpg.Connection,
    conversation_id: str,
    message_id: str,
    user_id: str,
    domain_name: str | None,
    knowledge_bases: list[str],
    history: list[dict],
    files: list[dict],
) -> ChatTool:
    """Возвращает :class:`ChatTool` с handler'ом, замыкающим контекст сообщения.

    Handler ожидает параметры ``question`` (str) и опц. ``kb_hint`` (str)
    — соответствуют объявленным выше ``parameters``. Внутри handler делает
    INSERT в ``agent_requests`` и возвращает sentinel-строку для
    оркестратора. Сам streaming блоков клиенту делает оркестратор
    отдельно (видит sentinel → переключается в режим bridge-stream).
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

    return ChatTool(
        name=TOOL_FORWARD_TO_KNOWLEDGE_AGENT,
        domain=_DOMAIN,
        description=_DESCRIPTION,
        parameters=list(_PARAMETERS),
        handler=handler,
        per_request_handler=True,
        category="forward",
    )


