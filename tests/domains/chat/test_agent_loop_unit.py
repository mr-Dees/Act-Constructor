"""Unit-тесты для ``agent_loop.run_agent_loop`` (non-streaming agent loop).

Существующий E2E (``test_chat_orchestrator.py::TestRun``) покрывает базовые
сценарии: max_tool_rounds, ошибка LLM, fallback при отсутствии API. Здесь
точечно проверяем ветку, которой нет в E2E:

  * GigaChat возвращает >1 tool_call за раунд — оркестратор обязан
    исполнить ровно один в этом раунде и поставить остальные в очередь,
    дальше обрабатывая очередь по одному без обращения к LLM. После
    опустошения очереди — снова идёт LLM-вызов.

Поведение нетривиальное (двухконтурный while + counter ``rounds``),
регрессионная зона при рефакторингах ``agent_loop``.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import SecretStr

from app.core.chat.tools import ChatTool, register_tools, reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.settings_registry import reset as reset_settings
from app.domains.chat.services.orchestrator import Orchestrator
from app.domains.chat.settings import ChatDomainSettings


@pytest.fixture(autouse=True)
def _clean_state():
    reset_registry()
    reset_settings()
    reset_tools()
    yield
    reset_registry()
    reset_settings()
    reset_tools()


def _gigachat_settings(**overrides) -> ChatDomainSettings:
    base = dict(
        profile="gigachat",
        api_base="http://gc:8000/v1",
        api_key=SecretStr("k"),
        model="gc-model",
        max_tool_rounds=5,
        tool_execution_timeout=5,
        streaming_enabled=False,
        temperature=0.0,
    )
    base.update(overrides)
    return ChatDomainSettings(**base)


def _make_tc(name: str, tc_id: str, arguments: str = '{}'):
    func = MagicMock()
    func.name = name
    func.arguments = arguments
    tc = MagicMock()
    tc.id = tc_id
    tc.function = func
    return tc


def _make_response(*, content=None, tool_calls=None):
    msg = MagicMock()
    msg.content = content
    msg.tool_calls = tool_calls
    choice = MagicMock()
    choice.message = msg
    choice.finish_reason = "tool_calls" if tool_calls else "stop"
    resp = MagicMock()
    resp.choices = [choice]
    resp.usage = None
    return resp


def _make_orch():
    orch = Orchestrator(
        msg_service=AsyncMock(load_history_for_llm=AsyncMock(return_value=[])),
        conv_service=AsyncMock(),
        settings=_gigachat_settings(),
    )
    orch._save_assistant_message = AsyncMock()
    return orch


async def test_gigachat_queues_extra_tool_calls_and_drains_without_extra_llm():
    """GigaChat вернул 3 tool_calls за один раунд:

      1. Первый исполняется немедленно;
      2. Остальные 2 ставятся в очередь и исполняются на следующих
         итерациях БЕЗ дополнительных вызовов LLM;
      3. После опустошения очереди — один LLM-вызов за финальным ответом.

    Итого: 2 LLM-вызова, 3 tool-handler вызова.
    """
    handler_calls: list[dict] = []

    async def handler(**kwargs):
        handler_calls.append(dict(kwargs))
        return "ok"

    register_tools([
        ChatTool(name="t1", domain="test", description="d", handler=handler),
        ChatTool(name="t2", domain="test", description="d", handler=handler),
        ChatTool(name="t3", domain="test", description="d", handler=handler),
    ])

    orch = _make_orch()
    tool_calls = [
        _make_tc("t1", "id-1"),
        _make_tc("t2", "id-2"),
        _make_tc("t3", "id-3"),
    ]
    first = _make_response(content=None, tool_calls=tool_calls)
    final = _make_response(content="готово")

    primary = AsyncMock()
    primary.chat.completions.create = AsyncMock(side_effect=[first, final])

    with patch.object(orch, "_get_openai_client", return_value=primary):
        result = await orch.run(
            message_id="m-1",
            conversation_id="c-1",
            user_message="привет",
        )

    assert result["response"] == "готово"
    # LLM позвали ровно 2 раза: первая выдача с 3 tool_calls + финал
    assert primary.chat.completions.create.await_count == 2
    # Все 3 tool'а исполнены (по одному за итерацию)
    assert len(handler_calls) == 3
    # Sources содержат все три имени в порядке исполнения
    assert result["sources"] == ["t1", "t2", "t3"]


async def test_non_gigachat_executes_all_tool_calls_in_single_round():
    """Не-gigachat профиль (sglang) исполняет все tool_calls параллельно
    в одном раунде — очередь не задействуется. Контрольный сценарий,
    показывающий что queue-логика срабатывает только под gigachat."""

    handler_calls: list[str] = []

    async def handler(**_kw):
        handler_calls.append("h")
        return "ok"

    register_tools([
        ChatTool(name="t1", domain="test", description="d", handler=handler),
        ChatTool(name="t2", domain="test", description="d", handler=handler),
        ChatTool(name="t3", domain="test", description="d", handler=handler),
    ])

    orch = Orchestrator(
        msg_service=AsyncMock(load_history_for_llm=AsyncMock(return_value=[])),
        conv_service=AsyncMock(),
        settings=_gigachat_settings(profile="sglang"),
    )
    orch._save_assistant_message = AsyncMock()

    first = _make_response(
        content=None,
        tool_calls=[
            _make_tc("t1", "id-1"),
            _make_tc("t2", "id-2"),
            _make_tc("t3", "id-3"),
        ],
    )
    final = _make_response(content="готово")

    primary = AsyncMock()
    primary.chat.completions.create = AsyncMock(side_effect=[first, final])

    with patch.object(orch, "_get_openai_client", return_value=primary):
        result = await orch.run(
            message_id="m-1",
            conversation_id="c-1",
            user_message="привет",
        )

    assert result["response"] == "готово"
    # Все 3 tool'а исполнены в одном раунде
    assert len(handler_calls) == 3
    # LLM вызван ровно 2 раза (первая выдача + финал), как и у gigachat
    assert primary.chat.completions.create.await_count == 2
