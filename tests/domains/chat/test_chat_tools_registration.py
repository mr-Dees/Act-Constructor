"""Тесты регистрации инструментов домена chat."""
import pytest

from app.core.chat import tools as tools_registry
from app.domains.chat.integrations.chat_tools import get_chat_tools


@pytest.fixture(autouse=True)
def _reset_tools():
    tools_registry.reset()
    yield
    tools_registry.reset()


def test_get_chat_tools_returns_two_tools():
    chat_tools = get_chat_tools()
    names = {t.name for t in chat_tools}
    assert names == {"chat.forward_to_knowledge_agent", "chat.notify"}


def test_forward_tool_has_no_handler():
    chat_tools = get_chat_tools()
    forward = next(t for t in chat_tools if t.name == "chat.forward_to_knowledge_agent")
    # Handler подставляется оркестратором per-request, поэтому здесь None
    assert forward.handler is None
    assert forward.category == "forward"


def test_notify_tool_has_handler_and_enum_level():
    chat_tools = get_chat_tools()
    notify = next(t for t in chat_tools if t.name == "chat.notify")
    assert notify.handler is not None
    assert notify.category == "action"
    level_param = next(p for p in notify.parameters if p.name == "level")
    assert level_param.enum == ["info", "success", "warning", "error"]
    assert level_param.required is False
    assert level_param.default == "info"


def test_tools_registerable_in_global_registry():
    chat_tools = get_chat_tools()
    tools_registry.register_tools(chat_tools)
    assert tools_registry.get_tool("chat.notify") is not None
    assert tools_registry.get_tool("chat.forward_to_knowledge_agent") is not None
