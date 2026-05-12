"""Интеграционные тесты домена чата."""

from pathlib import Path

import pytest

from app.core.domain_registry import discover_domains, reset_registry
from app.core.settings_registry import reset as reset_settings
from app.core.chat.tools import reset as reset_tools


@pytest.fixture(autouse=True)
def clean_registries():
    """Сброс глобального состояния реестров между тестами."""
    reset_registry()
    reset_settings()
    reset_tools()
    yield
    reset_registry()
    reset_settings()
    reset_tools()


# -------------------------------------------------------------------------
# Обнаружение домена
# -------------------------------------------------------------------------


def test_chat_domain_discovered():
    """Chat-домен обнаруживается при discover_domains."""
    domains_dir = Path(__file__).parent.parent.parent.parent / "app" / "domains"
    domains = discover_domains(domains_dir)
    domain_names = [d.name for d in domains]
    assert "chat" in domain_names


# -------------------------------------------------------------------------
# Настройки
# -------------------------------------------------------------------------


def test_chat_settings_load():
    """Настройки чата загружаются с дефолтами."""
    from app.domains.chat.settings import ChatDomainSettings

    s = ChatDomainSettings()
    assert s.model == "gpt-4o"
    assert s.max_file_size == 10 * 1024 * 1024
    assert s.streaming_enabled is True


# -------------------------------------------------------------------------
# Core SDK экспорт
# -------------------------------------------------------------------------


def test_core_sdk_imports():
    """Core SDK экспортирует все необходимые объекты."""
    from app.core.chat import (
        ChatTool,
        ChatToolParam,
        TextBlock,
        CodeBlock,
        ReasoningBlock,
        PlanBlock,
        FileBlock,
        ImageBlock,
        Button,
        ButtonGroup,
        register_tools,
        parse_message_blocks,
        serialize_message_blocks,
    )

    # Проверяем, что все объекты не None
    assert ChatTool is not None
    assert ChatToolParam is not None
    assert TextBlock is not None
    assert CodeBlock is not None
    assert ReasoningBlock is not None
    assert PlanBlock is not None
    assert FileBlock is not None
    assert ImageBlock is not None
    assert Button is not None
    assert ButtonGroup is not None
    assert callable(register_tools)
    assert callable(parse_message_blocks)
    assert callable(serialize_message_blocks)


# -------------------------------------------------------------------------
# SSE streaming
# -------------------------------------------------------------------------


def test_streaming_format_sse_event():
    """SSE-события форматируются корректно."""
    from app.domains.chat.services.streaming import format_sse_event

    event = format_sse_event("test", {"key": "value"})
    assert event.startswith("event: test\n")
    assert '"key"' in event
    assert event.endswith("\n\n")


def test_streaming_message_start():
    """Событие message_start содержит обязательные поля."""
    from app.domains.chat.services.streaming import sse_message_start

    start = sse_message_start(
        conversation_id="conv-1", message_id="msg-1",
    )
    assert "message_start" in start
    assert "msg-1" in start
    assert "conv-1" in start


def test_streaming_block_lifecycle():
    """Цикл жизни блока: start → delta → end."""
    from app.domains.chat.services.streaming import (
        sse_block_start,
        sse_block_delta,
        sse_block_end,
    )

    start = sse_block_start(block_index=0, block_type="text")
    assert "block_start" in start
    assert '"text"' in start

    delta = sse_block_delta(block_index=0, delta="Привет")
    assert "block_delta" in delta
    assert "Привет" in delta

    end = sse_block_end(block_index=0)
    assert "block_end" in end


def test_streaming_error_event():
    """Событие ошибки содержит текст и опциональный код."""
    from app.domains.chat.services.streaming import sse_error

    err = sse_error(error="Что-то пошло не так", code="INTERNAL")
    assert "error" in err
    assert "Что-то пошло не так" in err
    assert "INTERNAL" in err
