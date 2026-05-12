"""Тесты SSE-стриминга для AI-чата.

Покрывает: форматирование SSE-событий, жизненный цикл стриминга,
гарантии message_end, обработку ошибок, tool_call/tool_result.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.chat.tools import ChatTool, register_tools, reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.settings_registry import reset as reset_settings
from app.domains.chat.services.orchestrator import Orchestrator
from app.domains.chat.services.streaming import (
    format_sse_event,
    sse_block_delta,
    sse_block_end,
    sse_block_start,
    sse_buttons,
    sse_error,
    sse_message_end,
    sse_message_start,
    sse_plan_update,
    sse_tool_call,
    sse_tool_result,
)
from app.domains.chat.settings import ChatDomainSettings


# -------------------------------------------------------------------------
# Фикстуры
# -------------------------------------------------------------------------


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


@pytest.fixture
def settings():
    """Настройки чата с API."""
    return ChatDomainSettings(
        api_base="http://test-llm:8000/v1",
        api_key="test-key",
        streaming_enabled=True,
    )


@pytest.fixture
def settings_no_streaming():
    """Настройки чата с отключённым стримингом."""
    return ChatDomainSettings(
        api_base="http://test-llm:8000/v1",
        api_key="test-key",
        streaming_enabled=False,
    )


@pytest.fixture
def msg_service():
    """Mock MessageService."""
    svc = AsyncMock()
    svc.get_history = AsyncMock(return_value=[])
    svc.save_assistant_message = AsyncMock(return_value={"id": "msg-1"})
    return svc


@pytest.fixture
def conv_service():
    """Mock ConversationService."""
    return AsyncMock()


@pytest.fixture
def orchestrator(msg_service, conv_service, settings):
    """Оркестратор с стримингом."""
    return Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings,
    )


@pytest.fixture
def orchestrator_no_streaming(msg_service, conv_service, settings_no_streaming):
    """Оркестратор без стриминга."""
    return Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings_no_streaming,
    )


# -------------------------------------------------------------------------
# Форматирование SSE-событий
# -------------------------------------------------------------------------


class TestSSEFormatting:

    def test_format_sse_event_structure(self):
        """SSE-событие имеет формат: event: {type}\\ndata: {json}\\n\\n."""
        event = format_sse_event("test_type", {"key": "value"})
        lines = event.split("\n")
        assert lines[0] == "event: test_type"
        assert lines[1].startswith("data: ")
        data = json.loads(lines[1][len("data: "):])
        assert data == {"key": "value"}
        assert event.endswith("\n\n")

    def test_format_sse_event_unicode(self):
        """SSE-событие корректно обрабатывает Unicode (русский текст)."""
        event = format_sse_event("message", {"text": "Привет мир"})
        assert "Привет мир" in event
        # ensure_ascii=False — Unicode не экранируется
        assert "\\u" not in event

    def test_message_start_fields(self):
        """message_start содержит conversation_id и message_id."""
        event = sse_message_start(
            conversation_id="conv-123", message_id="msg-456",
        )
        data = _parse_event_data(event)
        assert data["conversation_id"] == "conv-123"
        assert data["message_id"] == "msg-456"

    def test_block_start_fields(self):
        """block_start содержит index и type."""
        event = sse_block_start(block_index=0, block_type="text")
        data = _parse_event_data(event)
        assert data["index"] == 0
        assert data["type"] == "text"

    def test_block_delta_fields(self):
        """block_delta содержит index и delta."""
        event = sse_block_delta(block_index=0, delta="Часть текста")
        data = _parse_event_data(event)
        assert data["index"] == 0
        assert data["delta"] == "Часть текста"

    def test_block_end_fields(self):
        """block_end содержит только index."""
        event = sse_block_end(block_index=2)
        data = _parse_event_data(event)
        assert data["index"] == 2

    def test_tool_call_fields(self):
        """tool_call содержит tool_name, tool_call_id и arguments."""
        event = sse_tool_call(
            tool_name="search",
            tool_call_id="tc-1",
            arguments={"query": "тест"},
        )
        data = _parse_event_data(event)
        assert data["tool_name"] == "search"
        assert data["tool_call_id"] == "tc-1"
        assert data["arguments"]["query"] == "тест"

    def test_tool_result_truncation(self):
        """tool_result обрезает результат до 500 символов."""
        long_result = "A" * 1000
        event = sse_tool_result(
            tool_name="search",
            tool_call_id="tc-1",
            result=long_result,
        )
        data = _parse_event_data(event)
        assert len(data["result"]) == 500

    def test_tool_result_short_not_truncated(self):
        """Короткий результат tool_result не обрезается."""
        short_result = "Результат"
        event = sse_tool_result(
            tool_name="search",
            tool_call_id="tc-1",
            result=short_result,
        )
        data = _parse_event_data(event)
        assert data["result"] == "Результат"

    def test_message_end_with_metadata(self):
        """message_end содержит model и token_usage."""
        event = sse_message_end(
            message_id="msg-1",
            model="gpt-4o",
            token_usage={"total_tokens": 100},
        )
        data = _parse_event_data(event)
        assert data["message_id"] == "msg-1"
        assert data["model"] == "gpt-4o"
        assert data["token_usage"]["total_tokens"] == 100

    def test_message_end_without_metadata(self):
        """message_end работает без model и token_usage."""
        event = sse_message_end(message_id="msg-1")
        data = _parse_event_data(event)
        assert data["message_id"] == "msg-1"
        assert data["model"] is None

    def test_error_event_with_code(self):
        """error содержит текст и код ошибки."""
        event = sse_error(error="Сбой", code="INTERNAL")
        data = _parse_event_data(event)
        assert data["error"] == "Сбой"
        assert data["code"] == "INTERNAL"

    def test_error_event_without_code(self):
        """error без кода не включает поле code."""
        event = sse_error(error="Сбой")
        data = _parse_event_data(event)
        assert data["error"] == "Сбой"
        assert "code" not in data

    def test_plan_update_fields(self):
        """plan_update содержит список шагов."""
        event = sse_plan_update(steps=[
            {"label": "Шаг 1", "status": "done"},
            {"label": "Шаг 2", "status": "pending"},
        ])
        data = _parse_event_data(event)
        assert len(data["steps"]) == 2

    def test_buttons_fields(self):
        """buttons содержит список кнопок."""
        event = sse_buttons(buttons=[
            {"label": "Подробнее", "action_id": "show_details"},
        ])
        data = _parse_event_data(event)
        assert len(data["buttons"]) == 1
        assert data["buttons"][0]["label"] == "Подробнее"


# -------------------------------------------------------------------------
# Жизненный цикл стриминга
# -------------------------------------------------------------------------


class TestStreamingLifecycle:

    async def test_message_start_always_first(self, orchestrator):
        """message_start всегда первое событие в стриме."""
        # Используем fallback (без настроек API) для простоты
        orchestrator.settings.api_base = ""
        orchestrator.settings.api_key = MagicMock()
        orchestrator.settings.api_key.get_secret_value.return_value = ""

        events = []
        async for event in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="Привет",
        ):
            events.append(event)

        assert _get_event_type(events[0]) == "message_start"

    async def test_message_end_always_last(self, orchestrator):
        """message_end всегда последнее событие в стриме."""
        orchestrator.settings.api_base = ""
        orchestrator.settings.api_key = MagicMock()
        orchestrator.settings.api_key.get_secret_value.return_value = ""

        events = []
        async for event in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="Привет",
        ):
            events.append(event)

        assert _get_event_type(events[-1]) == "message_end"

    async def test_block_lifecycle_order(self, orchestrator):
        """Блок следует порядку: block_start → block_delta+ → block_end."""
        orchestrator.settings.api_base = ""
        orchestrator.settings.api_key = MagicMock()
        orchestrator.settings.api_key.get_secret_value.return_value = ""

        events = []
        async for event in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="Привет",
        ):
            events.append(event)

        types = [_get_event_type(e) for e in events]
        # Находим блочные события
        block_events = [t for t in types if t.startswith("block_")]
        assert block_events[0] == "block_start"
        assert block_events[-1] == "block_end"
        # Все дельты между start и end
        for evt in block_events[1:-1]:
            assert evt == "block_delta"

    # BUG #6: message_end не гарантирован при ошибке
    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_error_in_stream_still_yields_message_end(
        self, mock_client_factory, orchestrator,
    ):
        """При ошибке LLM стриминг гарантирует message_end."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=ConnectionError("LLM недоступен"),
        )
        mock_client_factory.return_value = mock_client

        events = []
        async for event in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="Привет",
        ):
            events.append(event)

        types = [_get_event_type(e) for e in events]
        assert types[0] == "message_start"
        assert types[-1] == "message_end"
        assert "error" in types

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_error_during_streaming_chunks(
        self, mock_client_factory, orchestrator,
    ):
        """Ошибка во время получения чанков — message_end гарантирован."""
        mock_client = AsyncMock()

        async def failing_stream():
            chunk = MagicMock()
            delta = MagicMock()
            delta.content = "Начало"
            delta.tool_calls = None
            chunk.choices = [MagicMock(delta=delta, finish_reason=None)]
            yield chunk
            raise RuntimeError("Соединение прервано")

        mock_client.chat.completions.create = AsyncMock(
            return_value=failing_stream(),
        )
        mock_client_factory.return_value = mock_client

        events = []
        async for event in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="Привет",
        ):
            events.append(event)

        types = [_get_event_type(e) for e in events]
        assert types[-1] == "message_end"

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_save_failure_after_stream_does_not_break_sse(
        self, mock_client_factory, orchestrator,
    ):
        """BUG: Ошибка сохранения ассистентского сообщения после стрима
        не должна ломать SSE-поток (message_end уже отправлен или должен быть).
        """
        mock_client = AsyncMock()

        async def mock_stream():
            chunk = MagicMock()
            delta = MagicMock()
            delta.content = "Ответ"
            delta.tool_calls = None
            chunk.choices = [MagicMock(delta=delta, finish_reason=None)]

            chunk2 = MagicMock()
            delta2 = MagicMock()
            delta2.content = None
            delta2.tool_calls = None
            chunk2.choices = [MagicMock(delta=delta2, finish_reason="stop")]

            for c in [chunk, chunk2]:
                yield c

        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        mock_client_factory.return_value = mock_client

        # _save_assistant_message выбрасывает ошибку через get_db
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(side_effect=RuntimeError("DB недоступна"))
        ctx.__aexit__ = AsyncMock(return_value=False)

        events = []
        with patch("app.db.connection.get_db", return_value=ctx):
            async for event in orchestrator.run_stream(
                conversation_id="conv-1",
                user_message="Привет",
            ):
                events.append(event)

        types = [_get_event_type(e) for e in events]
        # message_end должен быть отправлен даже при ошибке сохранения
        assert types[-1] == "message_end"


# -------------------------------------------------------------------------
# Non-streaming fallback
# -------------------------------------------------------------------------


class TestStreamingFallback:

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_streaming_disabled_uses_non_stream(
        self, mock_client_factory, orchestrator_no_streaming,
    ):
        """При streaming_enabled=False используется обычный вызов."""
        mock_client = AsyncMock()
        message = MagicMock()
        message.content = "Ответ без стриминга"
        message.tool_calls = None
        choice = MagicMock()
        choice.message = message
        choice.finish_reason = "stop"
        response = MagicMock()
        response.choices = [choice]
        response.usage = None
        mock_client.chat.completions.create = AsyncMock(return_value=response)
        mock_client_factory.return_value = mock_client

        events = []
        async for event in orchestrator_no_streaming.run_stream(
            conversation_id="conv-1",
            user_message="Привет",
        ):
            events.append(event)

        types = [_get_event_type(e) for e in events]
        assert types[0] == "message_start"
        assert "block_start" in types
        assert "block_delta" in types
        assert "block_end" in types
        assert types[-1] == "message_end"

        # Проверяем что stream=True НЕ передавался
        create_call = mock_client.chat.completions.create
        call_kwargs = create_call.call_args.kwargs if create_call.call_args.kwargs else {}
        assert call_kwargs.get("stream") is not True

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_streaming_fallback_on_error(
        self, mock_client_factory, orchestrator,
    ):
        """При ошибке стриминга автоматический фолбек на обычный вызов."""
        mock_client = AsyncMock()

        # Первый вызов (stream=True) — ошибка
        # Второй вызов (без stream) — нормальный ответ
        message = MagicMock()
        message.content = "Фолбек-ответ"
        message.tool_calls = None
        choice = MagicMock()
        choice.message = message
        choice.finish_reason = "stop"
        response = MagicMock()
        response.choices = [choice]
        response.usage = None

        call_count = 0

        async def side_effect(**kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1 and kwargs.get("stream"):
                raise RuntimeError("Стриминг не поддерживается")
            return response

        mock_client.chat.completions.create = AsyncMock(side_effect=side_effect)
        mock_client_factory.return_value = mock_client

        events = []
        async for event in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="Тест фолбека",
        ):
            events.append(event)

        all_text = "".join(events)
        assert "Фолбек-ответ" in all_text
        types = [_get_event_type(e) for e in events]
        assert types[-1] == "message_end"


# -------------------------------------------------------------------------
# Стриминг с tool calls
# -------------------------------------------------------------------------


class TestStreamingToolCalls:

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_tool_call_events_in_stream(
        self, mock_client_factory, orchestrator,
    ):
        """tool_call и tool_result события присутствуют в стриме."""
        tool = ChatTool(
            name="stream_search",
            domain="test",
            description="Поиск для стрим-теста",
            handler=AsyncMock(return_value="Найдено: 5 актов"),
        )
        register_tools([tool])

        mock_client = AsyncMock()

        # Стриминговый ответ с tool_call
        async def mock_stream():
            chunk = MagicMock()
            delta = MagicMock()
            delta.content = None
            tc = MagicMock()
            tc.index = 0
            tc.id = "tc-stream-1"
            tc.function = MagicMock()
            tc.function.name = "stream_search"
            tc.function.arguments = '{"query": "акты"}'
            delta.tool_calls = [tc]
            chunk.choices = [MagicMock(delta=delta, finish_reason=None)]

            chunk2 = MagicMock()
            delta2 = MagicMock()
            delta2.content = None
            delta2.tool_calls = None
            chunk2.choices = [MagicMock(delta=delta2, finish_reason="tool_calls")]

            for c in [chunk, chunk2]:
                yield c

        # Финальный non-streaming ответ
        final_msg = MagicMock()
        final_msg.content = "Ответ после инструмента"
        final_msg.tool_calls = None
        final_choice = MagicMock()
        final_choice.message = final_msg
        final_choice.finish_reason = "stop"
        final_response = MagicMock()
        final_response.choices = [final_choice]
        final_response.usage = None

        mock_client.chat.completions.create = AsyncMock(
            side_effect=[mock_stream(), final_response],
        )
        mock_client_factory.return_value = mock_client

        events = []
        async for event in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="Найди акты",
        ):
            events.append(event)

        types = [_get_event_type(e) for e in events]
        assert "tool_call" in types
        assert "tool_result" in types

        # tool_call содержит имя инструмента
        tc_events = [e for e in events if _get_event_type(e) == "tool_call"]
        tc_data = _parse_event_data(tc_events[0])
        assert tc_data["tool_name"] == "stream_search"

        # tool_result содержит результат
        tr_events = [e for e in events if _get_event_type(e) == "tool_result"]
        tr_data = _parse_event_data(tr_events[0])
        assert "5 актов" in tr_data["result"]

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_multiple_tool_calls_in_one_round(
        self, mock_client_factory, orchestrator,
    ):
        """Несколько инструментов за один раунд."""
        tool_a = ChatTool(
            name="tool_a", domain="test", description="A",
            handler=AsyncMock(return_value="Результат A"),
        )
        tool_b = ChatTool(
            name="tool_b", domain="test", description="B",
            handler=AsyncMock(return_value="Результат B"),
        )
        register_tools([tool_a, tool_b])

        mock_client = AsyncMock()

        # Стриминг с двумя tool calls
        async def mock_stream():
            # Tool call A
            chunk1 = MagicMock()
            delta1 = MagicMock()
            delta1.content = None
            tc_a = MagicMock()
            tc_a.index = 0
            tc_a.id = "tc-a"
            tc_a.function = MagicMock()
            tc_a.function.name = "tool_a"
            tc_a.function.arguments = "{}"
            delta1.tool_calls = [tc_a]
            chunk1.choices = [MagicMock(delta=delta1, finish_reason=None)]

            # Tool call B
            chunk2 = MagicMock()
            delta2 = MagicMock()
            delta2.content = None
            tc_b = MagicMock()
            tc_b.index = 1
            tc_b.id = "tc-b"
            tc_b.function = MagicMock()
            tc_b.function.name = "tool_b"
            tc_b.function.arguments = "{}"
            delta2.tool_calls = [tc_b]
            chunk2.choices = [MagicMock(delta=delta2, finish_reason=None)]

            # Finish
            chunk3 = MagicMock()
            delta3 = MagicMock()
            delta3.content = None
            delta3.tool_calls = None
            chunk3.choices = [MagicMock(delta=delta3, finish_reason="tool_calls")]

            for c in [chunk1, chunk2, chunk3]:
                yield c

        # Финальный ответ
        final_msg = MagicMock()
        final_msg.content = "Оба инструмента выполнены"
        final_msg.tool_calls = None
        final = MagicMock()
        final.choices = [MagicMock(message=final_msg, finish_reason="stop")]
        final.usage = None

        mock_client.chat.completions.create = AsyncMock(
            side_effect=[mock_stream(), final],
        )
        mock_client_factory.return_value = mock_client

        events = []
        async for event in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="Используй оба",
        ):
            events.append(event)

        types = [_get_event_type(e) for e in events]
        # Два tool_call и два tool_result
        assert types.count("tool_call") == 2
        assert types.count("tool_result") == 2


# -------------------------------------------------------------------------
# Вспомогательные функции
# -------------------------------------------------------------------------


def _get_event_type(event_str: str) -> str:
    """Извлекает тип события из SSE-строки."""
    for line in event_str.split("\n"):
        if line.startswith("event: "):
            return line[len("event: "):]
    return "unknown"


def _parse_event_data(event_str: str) -> dict:
    """Извлекает JSON-данные из SSE-строки."""
    for line in event_str.split("\n"):
        if line.startswith("data: "):
            return json.loads(line[len("data: "):])
    return {}
