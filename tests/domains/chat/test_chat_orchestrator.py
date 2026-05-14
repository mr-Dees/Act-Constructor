"""Тесты оркестратора agent loop для AI-чата."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest

from app.core.chat.tools import ChatTool, ChatToolParam, register_tools, reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.settings_registry import reset as reset_settings
from app.domains.chat.services.orchestrator import Orchestrator, _convert_param
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
    """Настройки чата с API для тестов."""
    return ChatDomainSettings(
        api_base="http://test-llm:8000/v1",
        api_key="test-key",
        max_tool_rounds=3,
        tool_execution_timeout=5,
        streaming_enabled=True,
    )


@pytest.fixture
def settings_no_api():
    """Настройки чата без API (fallback-режим)."""
    return ChatDomainSettings(api_base="", api_key="")


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
    """Оркестратор с тестовыми зависимостями."""
    return Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings,
    )


@pytest.fixture
def orchestrator_no_api(msg_service, conv_service, settings_no_api):
    """Оркестратор без настроек LLM API."""
    return Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings_no_api,
    )


@pytest.fixture
def orchestrator_default_settings():
    """Оркестратор с дефолтными настройками для проверки системного промпта."""
    return Orchestrator(
        msg_service=AsyncMock(),
        conv_service=AsyncMock(),
        settings=ChatDomainSettings(),
    )


def _make_mock_response(content="Ответ ассистента", tool_calls=None, usage=None):
    """Создаёт mock-ответ OpenAI API."""
    message = MagicMock()
    message.content = content
    message.tool_calls = tool_calls

    choice = MagicMock()
    choice.message = message
    choice.finish_reason = "stop" if not tool_calls else "tool_calls"

    response = MagicMock()
    response.choices = [choice]
    response.usage = usage
    return response


def _make_tool_call(name="test_tool", arguments='{"query": "test"}', tc_id="tc-1"):
    """Создаёт mock tool_call."""
    func = MagicMock()
    func.name = name
    func.arguments = arguments

    tc = MagicMock()
    tc.id = tc_id
    tc.function = func
    return tc


# -------------------------------------------------------------------------
# _convert_param
# -------------------------------------------------------------------------


class TestConvertParam:

    def test_convert_boolean_true(self):
        """Конвертация строки 'true' в булево значение."""
        assert _convert_param("true", "boolean") is True

    def test_convert_boolean_false(self):
        """Конвертация строки 'false' в булево значение."""
        assert _convert_param("false", "boolean") is False

    def test_convert_boolean_native(self):
        """Нативное булево значение возвращается без изменений."""
        assert _convert_param(True, "boolean") is True

    def test_convert_integer(self):
        """Конвертация строки в целое число."""
        assert _convert_param("42", "integer") == 42

    def test_convert_date_string(self):
        """Конвертация ISO-строки в объект date."""
        from datetime import date
        result = _convert_param("2025-01-15", "date")
        assert result == date(2025, 1, 15)

    def test_convert_string(self):
        """Конвертация значения в строку."""
        assert _convert_param(123, "string") == "123"

    def test_convert_none(self):
        """None возвращается без конвертации."""
        assert _convert_param(None, "string") is None

    def test_convert_unknown_type(self):
        """Неизвестный тип возвращает значение как есть."""
        assert _convert_param([1, 2], "array") == [1, 2]


# -------------------------------------------------------------------------
# _build_system_messages
# -------------------------------------------------------------------------


class TestBuildSystemMessages:

    def test_base_prompt_only(self, orchestrator):
        """Без доменов возвращается только базовый системный промпт."""
        messages = orchestrator._build_system_messages(domains=None)
        assert len(messages) == 1
        assert messages[0]["role"] == "system"
        assert "forward_to_knowledge_agent" in messages[0]["content"]

    def test_with_domain_prompts(self, orchestrator):
        """С доменами добавляются доменные промпты."""
        from app.core.domain import DomainDescriptor
        from app.core.domain_registry import _domains

        descriptor = DomainDescriptor(
            name="test_domain",
            chat_system_prompt="Это доменный промпт для тестов.",
        )
        _domains.append(descriptor)

        messages = orchestrator._build_system_messages(domains=["test_domain"])
        assert len(messages) == 1
        assert "Это доменный промпт для тестов." in messages[0]["content"]

    def test_unknown_domain_ignored(self, orchestrator):
        """Неизвестный домен игнорируется без ошибки."""
        messages = orchestrator._build_system_messages(domains=["unknown_domain"])
        assert len(messages) == 1
        # Доменных промптов нет — только базовый
        assert "forward_to_knowledge_agent" in messages[0]["content"]


def test_system_prompt_includes_available_pages_section(orchestrator_default_settings):
    """Системный промпт содержит раздел 'Доступные страницы' с NavItem всех доменов."""
    from app.core.domain import DomainDescriptor, NavItem
    from app.core.domain_registry import _domains

    _domains.append(DomainDescriptor(
        name="dom_with_desc",
        nav_items=[
            NavItem(
                label="Страница A",
                url="/a",
                icon_svg="<svg/>",
                description="Описание A",
            ),
        ],
    ))
    _domains.append(DomainDescriptor(
        name="dom_without_desc",
        nav_items=[
            NavItem(label="Страница B", url="/b", icon_svg="<svg/>"),
        ],
    ))

    msgs = orchestrator_default_settings._build_system_messages(None)
    content = msgs[0]["content"]

    assert "## Доступные страницы" in content
    # С описанием
    assert "- Страница A (/a) — Описание A" in content
    # Без описания — без " — "
    assert "- Страница B (/b)" in content
    assert "- Страница B (/b) —" not in content


def test_system_prompt_includes_open_page_instructions(orchestrator_default_settings):
    """Системный промпт содержит инструкции про chat.list_pages и open_*."""
    msgs = orchestrator_default_settings._build_system_messages(None)
    content = msgs[0]["content"]

    assert "## Открытие страниц" in content
    assert "chat.list_pages" in content
    assert "admin.open_admin_panel" in content
    assert "acts.open_act_page" in content


def test_system_prompt_mentions_forward_priority(orchestrator_default_settings):
    """В system-промпте должно быть правило «по умолчанию forward_to_knowledge_agent»."""
    msgs = orchestrator_default_settings._build_system_messages(None)
    text = msgs[0]["content"]
    assert "forward_to_knowledge_agent" in text
    assert "по умолчанию" in text.lower() or "приоритет" in text.lower()


def test_system_prompt_local_smalltalk_mentions_local(monkeypatch, orchestrator_default_settings):
    orchestrator_default_settings.settings.smalltalk_mode = "local"
    msgs = orchestrator_default_settings._build_system_messages(None)
    assert "локальный" in msgs[0]["content"].lower() or "local" in msgs[0]["content"].lower()


def test_system_prompt_forward_smalltalk_mentions_forwarding(orchestrator_default_settings):
    orchestrator_default_settings.settings.smalltalk_mode = "forward"
    msgs = orchestrator_default_settings._build_system_messages(None)
    assert "forward_to_knowledge_agent" in msgs[0]["content"]


# -------------------------------------------------------------------------
# _build_user_content
# -------------------------------------------------------------------------


class TestBuildUserContent:

    async def test_no_files(self, orchestrator):
        """Без файлов возвращается исходный текст."""
        result = await orchestrator._build_user_content("Привет", None)
        assert result == "Привет"

    async def test_empty_file_blocks(self, orchestrator):
        """Пустой список файлов возвращается как исходный текст."""
        result = await orchestrator._build_user_content("Привет", [])
        assert result == "Привет"

    async def test_with_file_blocks(self, orchestrator):
        """С файлами добавляется извлечённый контент."""
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value={
            "filename": "test.txt",
            "mime_type": "text/plain",
            "file_data": b"Hello world",
        })
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_adapter = MagicMock(get_table_name=lambda name: name)

        file_blocks = [{"file_id": "file-1", "filename": "test.txt"}]

        with (
            patch("app.db.connection.get_db", return_value=ctx),
            patch("app.db.repositories.base.get_adapter", return_value=mock_adapter),
        ):
            result = await orchestrator._build_user_content("Вопрос", file_blocks)

        assert "Вопрос" in result
        assert "test.txt" in result

    async def test_file_not_found_skipped(self, orchestrator):
        """Несуществующий файл пропускается без ошибки."""
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_adapter = MagicMock(get_table_name=lambda name: name)

        file_blocks = [{"file_id": "nonexistent"}]

        with (
            patch("app.db.connection.get_db", return_value=ctx),
            patch("app.db.repositories.base.get_adapter", return_value=mock_adapter),
        ):
            result = await orchestrator._build_user_content("Вопрос", file_blocks)

        assert result == "Вопрос"

    async def test_file_block_without_id_skipped(self, orchestrator):
        """Блок файла без file_id пропускается."""
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_adapter = MagicMock(get_table_name=lambda name: name)

        with (
            patch("app.db.connection.get_db", return_value=ctx),
            patch("app.db.repositories.base.get_adapter", return_value=mock_adapter),
        ):
            result = await orchestrator._build_user_content(
                "Текст", [{"type": "file"}],
            )

        assert result == "Текст"

    async def test_file_access_uses_conversation_id(self, orchestrator):
        """_build_user_content получает файлы через репозиторий с проверкой conversation_id."""
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value={
            "filename": "secret.pdf",
            "mime_type": "text/plain",
            "file_data": b"Secret data contents",
        })
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_adapter = MagicMock(get_table_name=lambda name: name)

        file_blocks = [{"file_id": "file-id-1"}]

        with (
            patch("app.db.connection.get_db", return_value=ctx),
            patch("app.db.repositories.base.get_adapter", return_value=mock_adapter),
        ):
            result = await orchestrator._build_user_content(
                "Покажи", file_blocks, "conv-123",
            )

        assert "secret.pdf" in result
        # SQL содержит проверку conversation_id
        call_args = mock_conn.fetchrow.call_args
        sql = call_args[0][0]
        assert "conversation_id" in sql


# -------------------------------------------------------------------------
# run() — полный (не стриминговый) agent loop
# -------------------------------------------------------------------------


class TestOrchestratorRun:

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_run_simple_response(self, mock_client_factory, orchestrator):
        """Простой ответ LLM без tool calls."""
        mock_client = AsyncMock()
        usage = MagicMock()
        usage.prompt_tokens = 10
        usage.completion_tokens = 20
        usage.total_tokens = 30

        response = _make_mock_response(
            content="Привет! Чем помочь?",
            usage=usage,
        )
        mock_client.chat.completions.create = AsyncMock(return_value=response)
        mock_client_factory.return_value = mock_client
        orchestrator._save_assistant_message = AsyncMock()

        result = await orchestrator.run(
            conversation_id="conv-1",
            user_message="Привет",
        )

        assert result["response"] == "Привет! Чем помочь?"
        assert result["model"] == "gpt-4o"
        assert result["token_usage"]["total_tokens"] == 30
        orchestrator._save_assistant_message.assert_called_once()

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_run_with_tool_calls(self, mock_client_factory, orchestrator):
        """Agent loop с вызовом инструмента."""
        # Регистрируем тестовый инструмент
        test_tool = ChatTool(
            name="search_acts",
            domain="acts",
            description="Поиск актов",
            parameters=[
                ChatToolParam(name="query", type="string", description="Запрос"),
            ],
            handler=AsyncMock(return_value="Найден акт КМ-01-00001"),
        )
        register_tools([test_tool])

        mock_client = AsyncMock()
        # Первый вызов — tool_call
        tool_call = _make_tool_call(
            name="search_acts",
            arguments='{"query": "КМ-01"}',
        )
        response1 = _make_mock_response(
            content=None,
            tool_calls=[tool_call],
        )
        # Второй вызов — финальный ответ
        response2 = _make_mock_response(content="Найден акт КМ-01-00001.")
        mock_client.chat.completions.create = AsyncMock(
            side_effect=[response1, response2],
        )
        mock_client_factory.return_value = mock_client
        orchestrator._save_assistant_message = AsyncMock()

        result = await orchestrator.run(
            conversation_id="conv-1",
            user_message="Найди акт КМ-01",
        )

        assert "search_acts" in result["sources"]
        assert "КМ-01-00001" in result["response"]

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_run_max_tool_rounds_limit(self, mock_client_factory, orchestrator):
        """Agent loop останавливается при достижении лимита раундов."""
        test_tool = ChatTool(
            name="loop_tool",
            domain="test",
            description="Инструмент для теста лимита",
            handler=AsyncMock(return_value="Результат"),
        )
        register_tools([test_tool])

        mock_client = AsyncMock()
        # Всегда возвращаем tool_call — цикл должен остановиться
        tool_call = _make_tool_call(name="loop_tool", arguments="{}")
        response_with_tc = _make_mock_response(content=None, tool_calls=[tool_call])
        # Финальный ответ после лимита раундов
        response_final = _make_mock_response(content="Ответ после лимита")
        mock_client.chat.completions.create = AsyncMock(
            side_effect=[response_with_tc] * 3 + [response_final],
        )
        mock_client_factory.return_value = mock_client
        orchestrator._save_assistant_message = AsyncMock()

        result = await orchestrator.run(
            conversation_id="conv-1",
            user_message="Тест лимита",
        )

        # max_tool_rounds=3, значит 3 tool_call + 1 финальный = 4 вызова
        assert mock_client.chat.completions.create.call_count == 4

    async def test_run_fallback_no_api(self, orchestrator_no_api):
        """Без настроек API возвращается fallback-ответ."""
        result = await orchestrator_no_api.run(
            conversation_id="conv-1",
            user_message="Привет",
        )

        assert result["status"] == "fallback"
        assert "Привет" in result["response"]
        assert "режиме заглушки" in result["response"]

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_run_api_error_returns_200_with_error_payload(
        self, mock_client_factory, orchestrator,
    ):
        """1.4 (BUG #7 закрыт как намеренное поведение): при ошибке LLM API
        run() возвращает dict с 'status: error' и нейтральным сообщением;
        для не-стрим режима это допустимо (внутренние детали не утекают).
        Дополнительно: ErrorBlock сохраняется в историю, чтобы пользователь
        увидел причину при перезагрузке страницы.
        """
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception("Connection refused"),
        )
        mock_client_factory.return_value = mock_client
        orchestrator._save_assistant_message = AsyncMock()

        result = await orchestrator.run(
            conversation_id="conv-1",
            user_message="Привет",
        )

        # Ошибка замаскирована как dict с status='error'
        assert result["status"] == "error"
        assert "Временная ошибка" in result["response"]
        # Нет HTTPException или raise — вызывающий код получит 200 OK
        # ErrorBlock сохранён в историю.
        orchestrator._save_assistant_message.assert_awaited_once()
        kwargs = orchestrator._save_assistant_message.await_args.kwargs
        saved_blocks = kwargs["content_blocks"]
        assert len(saved_blocks) == 1
        assert saved_blocks[0]["type"] == "error"
        assert saved_blocks[0]["code"] == "llm_unavailable"
        assert "Временная ошибка" in saved_blocks[0]["message"]

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_run_strips_leading_newlines(self, mock_client_factory, orchestrator):
        """Ведущие переносы строк убираются из ответа LLM."""
        mock_client = AsyncMock()
        response = _make_mock_response(content="\n\nОтвет ассистента")
        mock_client.chat.completions.create = AsyncMock(return_value=response)
        mock_client_factory.return_value = mock_client
        orchestrator._save_assistant_message = AsyncMock()

        result = await orchestrator.run(
            conversation_id="conv-1",
            user_message="Вопрос",
        )

        assert result["response"] == "Ответ ассистента"

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_run_handles_malformed_tool_arguments(
        self, mock_client_factory, orchestrator,
    ):
        """Если LLM вернул битый JSON в tool_call.function.arguments,
        orchestrator подставляет пустой dict и продолжает: tool вызывается,
        round не прерывается. Без этого fallback'а одна кривая модель
        ломала бы весь tool-loop.

        Аналогичный fallback на стрим-путях (orchestrator.py:1010, 1202) —
        идентичен по семантике; проверять каждое место не имеет смысла,
        весь риск в строке ``except json.JSONDecodeError: arguments = {}``.
        """
        captured_args: dict[str, object] = {}

        async def handler(**kwargs):
            captured_args.update(kwargs)
            return "ok"

        test_tool = ChatTool(
            name="probe",
            domain="test",
            description="Проба malformed args",
            handler=handler,
        )
        register_tools([test_tool])

        mock_client = AsyncMock()
        tool_call = _make_tool_call(
            name="probe",
            arguments='{"query": "КМ-01"',  # незакрытая скобка → JSONDecodeError
        )
        response_with_tc = _make_mock_response(
            content=None, tool_calls=[tool_call],
        )
        response_final = _make_mock_response(content="Готово")
        mock_client.chat.completions.create = AsyncMock(
            side_effect=[response_with_tc, response_final],
        )
        mock_client_factory.return_value = mock_client
        orchestrator._save_assistant_message = AsyncMock()

        result = await orchestrator.run(
            conversation_id="conv-1",
            user_message="Найди что-нибудь",
        )

        # Тool всё-таки выполнен, но с пустыми аргументами.
        assert captured_args == {}
        assert result["response"] == "Готово"


# -------------------------------------------------------------------------
# _execute_tool_call
# -------------------------------------------------------------------------


class TestExecuteToolCall:

    async def test_tool_not_found(self, orchestrator):
        """Вызов несуществующего инструмента возвращает ошибку."""
        result = await orchestrator._execute_tool_call("nonexistent", {})
        assert "не найден" in result

    async def test_tool_without_handler(self, orchestrator):
        """Инструмент без обработчика возвращает ошибку."""
        tool = ChatTool(
            name="no_handler_tool",
            domain="test",
            description="Без обработчика",
            handler=None,
        )
        register_tools([tool])

        result = await orchestrator._execute_tool_call("no_handler_tool", {})
        assert "не имеет обработчика" in result

    async def test_tool_timeout(self, orchestrator):
        """Таймаут выполнения инструмента возвращает ошибку."""

        async def slow_handler(**kwargs):
            await asyncio.sleep(100)
            return "Не должно вернуться"

        tool = ChatTool(
            name="slow_tool",
            domain="test",
            description="Медленный инструмент",
            handler=slow_handler,
        )
        register_tools([tool])

        result = await orchestrator._execute_tool_call("slow_tool", {})
        assert "таймаут" in result.lower()

    async def test_tool_exception(self, orchestrator):
        """Исключение в обработчике возвращает нейтральное сообщение без деталей."""

        async def failing_handler(**kwargs):
            raise ValueError("Внутренняя ошибка инструмента")

        tool = ChatTool(
            name="failing_tool",
            domain="test",
            description="Сбойный инструмент",
            handler=failing_handler,
        )
        register_tools([tool])

        result = await orchestrator._execute_tool_call("failing_tool", {})
        # 4.3: нейтральное сообщение БЕЗ деталей exception
        assert "ошибкой" in result.lower()
        assert "error_id=" in result
        assert "Внутренняя ошибка инструмента" not in result

    async def test_tool_exception_does_not_leak_details(self, orchestrator, caplog):
        """4.3: Детали исключения (SQL, секреты) НЕ попадают в выход LLM;
        полный stack-trace остаётся только в логах с error_id.
        """
        import logging as _logging

        async def leaky_handler(**kwargs):
            raise RuntimeError(
                "secret SQL leaked: SELECT * FROM users WHERE password='hunter2'",
            )

        tool = ChatTool(
            name="leaky_tool",
            domain="test",
            description="Утечка",
            handler=leaky_handler,
        )
        register_tools([tool])

        with caplog.at_level(_logging.ERROR):
            result = await orchestrator._execute_tool_call("leaky_tool", {})

        # Секрет НЕ просочился в результат для LLM
        assert "secret SQL leaked" not in result
        assert "hunter2" not in result
        assert "RuntimeError" not in result
        # Должен быть error_id для трассировки
        assert "error_id=" in result
        # Полный stack-trace и сообщение exception — в логах
        leaked_in_logs = any(
            "secret SQL leaked" in record.getMessage()
            or "secret SQL leaked" in (record.exc_text or "")
            for record in caplog.records
        )
        assert leaked_in_logs, "Детали исключения должны быть в логах"

    async def test_max_tool_rounds_streaming_count(self, orchestrator):
        """4.14: При max_tool_rounds=3 и LLM, всегда отдающем tool_call,
        инструмент вызывается ровно 3 раза (не 2 и не 4).
        """
        call_count = 0

        async def counting_handler(**kwargs):
            nonlocal call_count
            call_count += 1
            return "ok"

        tool = ChatTool(
            name="counter_tool",
            domain="test",
            description="Счётчик",
            handler=counting_handler,
        )
        register_tools([tool])

        # Бесконечно отдаём tool_call стримом
        def make_stream_factory():
            async def mock_stream():
                chunk = MagicMock()
                delta = MagicMock()
                delta.content = None
                tc_delta = MagicMock()
                tc_delta.index = 0
                tc_delta.id = f"tc-{call_count}"
                tc_delta.function = MagicMock()
                tc_delta.function.name = "counter_tool"
                tc_delta.function.arguments = "{}"
                delta.tool_calls = [tc_delta]
                chunk.choices = [MagicMock(delta=delta, finish_reason=None)]
                yield chunk

                chunk2 = MagicMock()
                delta2 = MagicMock()
                delta2.content = None
                delta2.tool_calls = None
                chunk2.choices = [MagicMock(delta=delta2, finish_reason="tool_calls")]
                yield chunk2
            return mock_stream()

        orchestrator.settings.max_tool_rounds = 3

        with patch.object(
            Orchestrator, "_get_openai_client",
        ) as mock_client_factory:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(
                side_effect=lambda **kw: make_stream_factory(),
            )
            mock_client_factory.return_value = mock_client
            orchestrator._save_assistant_message = AsyncMock()

            events = []
            async for ev in orchestrator.run_stream(
                conversation_id="conv-1",
                user_message="loop",
            ):
                events.append(ev)

        # При max_tool_rounds=3 ровно 3 раза вызвался handler
        assert call_count == 3, f"Ожидалось 3 вызова, получено {call_count}"

    async def test_tool_dict_result_serialized(self, orchestrator):
        """Dict-результат инструмента сериализуется в JSON."""
        tool = ChatTool(
            name="json_tool",
            domain="test",
            description="JSON инструмент",
            handler=AsyncMock(return_value={"status": "ok", "data": [1, 2]}),
        )
        register_tools([tool])

        result = await orchestrator._execute_tool_call("json_tool", {})
        parsed = json.loads(result)
        assert parsed["status"] == "ok"

    async def test_missing_required_param_raises_validation_error(self, orchestrator):
        """1.3: Отсутствующий required-параметр → ChatToolValidationError."""
        from app.domains.chat.exceptions import ChatToolValidationError

        tool = ChatTool(
            name="req_tool",
            domain="test",
            description="С обязательным параметром",
            parameters=[
                ChatToolParam(
                    name="must_have",
                    type="string",
                    description="Обязательный",
                    required=True,
                ),
            ],
            handler=AsyncMock(return_value="ok"),
        )
        register_tools([tool])

        with pytest.raises(ChatToolValidationError) as exc_info:
            await orchestrator._execute_tool_call("req_tool", {})

        assert "must_have" in str(exc_info.value)
        assert exc_info.value.status_code == 400

    async def test_optional_param_missing_does_not_raise(self, orchestrator):
        """1.3: Отсутствие optional-параметра не считается ошибкой валидации."""
        tool = ChatTool(
            name="opt_tool",
            domain="test",
            description="С опциональным параметром",
            parameters=[
                ChatToolParam(
                    name="maybe",
                    type="string",
                    description="Опциональный",
                    required=False,
                ),
            ],
            handler=AsyncMock(return_value="ok"),
        )
        register_tools([tool])

        result = await orchestrator._execute_tool_call("opt_tool", {})
        assert result == "ok"

    async def test_tool_param_type_conversion(self, orchestrator):
        """Параметры инструмента конвертируются в правильные типы."""
        received_args = {}

        async def capture_handler(**kwargs):
            received_args.update(kwargs)
            return "OK"

        tool = ChatTool(
            name="typed_tool",
            domain="test",
            description="Типизированный инструмент",
            parameters=[
                ChatToolParam(name="count", type="integer", description="Кол-во"),
                ChatToolParam(name="active", type="boolean", description="Флаг"),
            ],
            handler=capture_handler,
        )
        register_tools([tool])

        await orchestrator._execute_tool_call("typed_tool", {
            "count": "5",
            "active": "true",
        })

        assert received_args["count"] == 5
        assert received_args["active"] is True


# -------------------------------------------------------------------------
# run_stream() — стриминговый agent loop
# -------------------------------------------------------------------------


class TestOrchestratorRunStream:

    async def test_stream_fallback_emits_full_lifecycle(self, orchestrator_no_api):
        """Без API: message_start → block_start → delta → block_end → message_end."""
        events = []
        async for event in orchestrator_no_api.run_stream(
            conversation_id="conv-1",
            user_message="Привет",
        ):
            events.append(event)

        event_types = [e.split("\n")[0].replace("event: ", "") for e in events]
        assert event_types == [
            "message_start",
            "block_start",
            "block_delta",
            "block_end",
            "message_end",
        ]

    async def test_stream_fallback_contains_message(self, orchestrator_no_api):
        """Fallback-стриминг содержит текст сообщения пользователя."""
        events = []
        async for event in orchestrator_no_api.run_stream(
            conversation_id="conv-1",
            user_message="Тестовое сообщение",
        ):
            events.append(event)

        all_text = "".join(events)
        assert "Тестовое сообщение" in all_text

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_stream_normal_response(self, mock_client_factory, orchestrator):
        """Нормальный стриминг с текстовым ответом."""
        mock_client = AsyncMock()

        # Создаём async iterable для стриминга
        async def mock_stream():
            # Чанк 1: текстовое содержимое
            chunk1 = MagicMock()
            delta1 = MagicMock()
            delta1.content = "Привет"
            delta1.tool_calls = None
            chunk1.choices = [MagicMock(delta=delta1, finish_reason=None)]

            # Чанк 2: продолжение текста
            chunk2 = MagicMock()
            delta2 = MagicMock()
            delta2.content = " мир!"
            delta2.tool_calls = None
            chunk2.choices = [MagicMock(delta=delta2, finish_reason=None)]

            # Чанк 3: завершение
            chunk3 = MagicMock()
            delta3 = MagicMock()
            delta3.content = None
            delta3.tool_calls = None
            chunk3.choices = [MagicMock(delta=delta3, finish_reason="stop")]

            for chunk in [chunk1, chunk2, chunk3]:
                yield chunk

        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        mock_client_factory.return_value = mock_client

        events = []
        async for event in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="Привет",
        ):
            events.append(event)

        event_types = [e.split("\n")[0].replace("event: ", "") for e in events]
        assert event_types[0] == "message_start"
        assert event_types[-1] == "message_end"
        assert "block_start" in event_types
        assert "block_delta" in event_types
        assert "block_end" in event_types

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_stream_error_guarantees_message_end(
        self, mock_client_factory, orchestrator,
    ):
        """1.4 (BUG #6 закрыт): при ошибке стриминга message_end гарантирован.

        Оркестратор ловит generic Exception, эмитит нейтральный SSE error
        и финализирует message_end в любом случае.
        """
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception("LLM API недоступен"),
        )
        mock_client_factory.return_value = mock_client

        events = []
        async for event in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="Привет",
        ):
            events.append(event)

        event_types = [e.split("\n")[0].replace("event: ", "") for e in events]
        # message_end ДОЛЖЕН быть последним событием даже при ошибке
        assert event_types[-1] == "message_end"
        # Ошибка должна быть отправлена
        assert "error" in event_types

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_stream_with_tool_calls(self, mock_client_factory, orchestrator):
        """Стриминг с вызовом инструмента: tool_call и tool_result."""
        test_tool = ChatTool(
            name="stream_tool",
            domain="test",
            description="Инструмент для стрим-теста",
            handler=AsyncMock(return_value="Результат инструмента"),
        )
        register_tools([test_tool])

        mock_client = AsyncMock()

        # Первый вызов: стриминг с tool_call
        async def mock_stream_with_tool():
            # Чанк с tool_call дельтами
            chunk1 = MagicMock()
            delta1 = MagicMock()
            delta1.content = None
            tc_delta = MagicMock()
            tc_delta.index = 0
            tc_delta.id = "tc-stream-1"
            tc_delta.function = MagicMock()
            tc_delta.function.name = "stream_tool"
            tc_delta.function.arguments = '{"query": "test"}'
            delta1.tool_calls = [tc_delta]
            chunk1.choices = [MagicMock(delta=delta1, finish_reason=None)]

            # Финальный чанк
            chunk2 = MagicMock()
            delta2 = MagicMock()
            delta2.content = None
            delta2.tool_calls = None
            chunk2.choices = [MagicMock(delta=delta2, finish_reason="tool_calls")]

            for chunk in [chunk1, chunk2]:
                yield chunk

        # Второй вызов: финальный ответ (non-streaming после tool)
        response_final = _make_mock_response(content="Ответ после инструмента")

        mock_client.chat.completions.create = AsyncMock(
            side_effect=[mock_stream_with_tool(), response_final],
        )
        mock_client_factory.return_value = mock_client

        events = []
        async for event in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="Используй инструмент",
        ):
            events.append(event)

        event_types = [e.split("\n")[0].replace("event: ", "") for e in events]
        assert "tool_call" in event_types
        assert "tool_result" in event_types
        assert event_types[-1] == "message_end"

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_stream_saves_assistant_message(
        self, mock_client_factory, orchestrator,
    ):
        """После стриминга сохраняется сообщение ассистента через свежее соединение."""
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

        # Mock для _save_assistant_message (свежее соединение из пула)
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value={
            "id": "msg-saved",
            "conversation_id": "conv-1",
            "role": "assistant",
            "content": [{"type": "text", "content": "Ответ"}],
            "model": "gpt-4o",
            "token_usage": None,
            "created_at": "2025-01-01T00:00:00",
        })
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_adapter = MagicMock(get_table_name=lambda n: n)

        # Потребляем стрим
        events = []
        with (
            patch("app.db.connection.get_db", return_value=ctx) as mock_get_db,
            patch("app.db.repositories.base.get_adapter", return_value=mock_adapter),
        ):
            async for event in orchestrator.run_stream(
                conversation_id="conv-1",
                user_message="Привет",
            ):
                events.append(event)

            # Проверяем, что get_db вызывался (свежее соединение для сохранения)
            mock_get_db.assert_called()

    @patch("app.domains.chat.services.orchestrator.Orchestrator._get_openai_client")
    async def test_stream_tool_validation_error_emits_neutral_tool_error(
        self, mock_client_factory, orchestrator,
    ):
        """1.3: При вызове tool'а без required параметра — SSE tool_error
        с нейтральным сообщением; сырой текст ошибки не утекает.
        """
        tool = ChatTool(
            name="strict_tool",
            domain="test",
            description="Требует параметр",
            parameters=[
                ChatToolParam(
                    name="needed",
                    type="string",
                    description="Должен быть",
                    required=True,
                ),
            ],
            handler=AsyncMock(return_value="ok"),
        )
        register_tools([tool])

        mock_client = AsyncMock()

        # Стрим: LLM зовёт инструмент БЕЗ required-параметра.
        async def stream_with_bad_tool():
            chunk = MagicMock()
            delta = MagicMock()
            delta.content = None
            tc_delta = MagicMock()
            tc_delta.index = 0
            tc_delta.id = "tc-bad"
            tc_delta.function = MagicMock()
            tc_delta.function.name = "strict_tool"
            tc_delta.function.arguments = "{}"  # пустые args
            delta.tool_calls = [tc_delta]
            chunk.choices = [MagicMock(delta=delta, finish_reason=None)]
            yield chunk

            chunk2 = MagicMock()
            delta2 = MagicMock()
            delta2.content = None
            delta2.tool_calls = None
            chunk2.choices = [MagicMock(delta=delta2, finish_reason="tool_calls")]
            yield chunk2

        # Финальный ответ после ошибки tool'а
        response_final = _make_mock_response(content="ok-final")
        mock_client.chat.completions.create = AsyncMock(
            side_effect=[stream_with_bad_tool(), response_final],
        )
        mock_client_factory.return_value = mock_client
        orchestrator._save_assistant_message = AsyncMock()

        events = []
        async for ev in orchestrator.run_stream(
            conversation_id="conv-1",
            user_message="без параметра",
        ):
            events.append(ev)

        event_types = [e.split("\n")[0].replace("event: ", "") for e in events]
        # Должно быть tool_error, не tool_result для этого вызова
        assert "tool_error" in event_types, f"events={event_types}"

        # Сырой текст ошибки (имя параметра в технической формулировке) НЕ должен
        # утекать наружу — в payload tool_error содержится нейтральное сообщение.
        joined = "\n".join(events)
        assert "Не удалось выполнить инструмент" in joined
        assert "Попробуйте переформулировать" in joined
        # "отсутствует обязательный параметр" (сырое сообщение исключения) —
        # только в логах; в SSE его быть не должно.
        assert "отсутствует обязательный параметр" not in joined

    async def test_stream_openai_not_installed(self, orchestrator):
        """При отсутствии openai пакета — fallback с сообщением."""
        # Патчим import openai чтобы он выбрасывал ImportError
        import builtins
        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "openai":
                raise ImportError("No module named 'openai'")
            return original_import(name, *args, **kwargs)

        events = []
        with patch("builtins.__import__", side_effect=mock_import):
            async for event in orchestrator.run_stream(
                conversation_id="conv-1",
                user_message="Привет",
            ):
                events.append(event)

        all_text = "".join(events)
        assert "message_end" in all_text


# -------------------------------------------------------------------------
# _get_history_messages
# -------------------------------------------------------------------------


class TestGetHistoryMessages:

    async def test_empty_history(self, orchestrator, msg_service):
        """Пустая история возвращает пустой список."""
        msg_service.get_history.return_value = []
        result = await orchestrator._get_history_messages("conv-1")
        assert result == []

    async def test_text_blocks_extracted(self, orchestrator, msg_service):
        """Текстовые блоки извлекаются в формат OpenAI."""
        msg_service.get_history.return_value = [
            {
                "role": "user",
                "content": [{"type": "text", "content": "Вопрос"}],
            },
            {
                "role": "assistant",
                "content": [{"type": "text", "content": "Ответ"}],
            },
        ]

        result = await orchestrator._get_history_messages("conv-1")
        assert len(result) == 2
        assert result[0] == {"role": "user", "content": "Вопрос"}
        assert result[1] == {"role": "assistant", "content": "Ответ"}

    async def test_code_blocks_formatted(self, orchestrator, msg_service):
        """Code-блоки форматируются как markdown fenced code."""
        msg_service.get_history.return_value = [
            {
                "role": "assistant",
                "content": [
                    {"type": "code", "language": "python", "content": "print('hi')"},
                ],
            },
        ]

        result = await orchestrator._get_history_messages("conv-1")
        assert "```python" in result[0]["content"]
        assert "print('hi')" in result[0]["content"]

    async def test_file_blocks_formatted(self, orchestrator, msg_service):
        """File-блоки форматируются как '[Прикреплён файл: ...]'."""
        msg_service.get_history.return_value = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "content": "Смотри файл"},
                    {"type": "file", "filename": "report.pdf"},
                ],
            },
        ]

        result = await orchestrator._get_history_messages("conv-1")
        assert "Прикреплён файл: report.pdf" in result[0]["content"]

    async def test_history_truncated_to_max_length(self, orchestrator, msg_service):
        """История обрезается до max_history_length."""
        orchestrator.settings.max_history_length = 3
        msg_service.get_history.return_value = [
            {"role": "user", "content": [{"type": "text", "content": f"Msg {i}"}]}
            for i in range(10)
        ]

        result = await orchestrator._get_history_messages("conv-1")
        assert len(result) == 3

    async def test_string_content_handled(self, orchestrator, msg_service):
        """Строковый контент (не список блоков) обрабатывается."""
        msg_service.get_history.return_value = [
            {"role": "user", "content": "Просто строка"},
        ]

        result = await orchestrator._get_history_messages("conv-1")
        assert result[0]["content"] == "Просто строка"

    async def test_reasoning_blocks_excluded_from_llm_context(
        self, orchestrator, msg_service,
    ):
        """Reasoning сохранён в истории для UI, но в контекст LLM не идёт.

        Иначе модель в следующем запросе увидит собственный chain-of-thought
        предыдущего ответа и контекст будет засоряться.
        """
        msg_service.get_history.return_value = [
            {
                "role": "assistant",
                "content": [
                    {"type": "reasoning", "content": "Думаю про КСО"},
                    {"type": "text", "content": "Ответ по КСО"},
                ],
            },
        ]

        result = await orchestrator._get_history_messages("conv-1")
        assert len(result) == 1
        assert result[0]["content"] == "Ответ по КСО"
        assert "Думаю про КСО" not in result[0]["content"]

    async def test_error_blocks_excluded_from_llm_context(
        self, orchestrator, msg_service,
    ):
        """Сохранённые error-блоки в контекст LLM не передаются."""
        msg_service.get_history.return_value = [
            {
                "role": "assistant",
                "content": [
                    {"type": "error", "message": "Сбой моста", "code": "x"},
                    {"type": "text", "content": "Запросите позже."},
                ],
            },
        ]

        result = await orchestrator._get_history_messages("conv-1")
        assert result[0]["content"] == "Запросите позже."
        assert "Сбой моста" not in result[0]["content"]


# -------------------------------------------------------------------------
# _fallback_response
# -------------------------------------------------------------------------


class TestFallbackResponse:

    def test_fallback_with_no_tools(self, orchestrator):
        """Fallback без зарегистрированных инструментов."""
        result = orchestrator._fallback_response("Привет")
        assert "Привет" in result["response"]
        assert "Инструменты не зарегистрированы" in result["response"]
        assert result["status"] == "fallback"

    def test_fallback_with_tools(self, orchestrator):
        """Fallback с зарегистрированными инструментами."""
        tool = ChatTool(
            name="test_tool",
            domain="test",
            description="Тестовый инструмент",
            handler=AsyncMock(),
        )
        register_tools([tool])

        result = orchestrator._fallback_response("Привет")
        assert "Доступно инструментов: 1" in result["response"]
        assert "CHAT__API_BASE" in result["response"]


@pytest.mark.asyncio
async def test_orchestrator_disables_streaming_for_gigachat_profile():
    """Профиль gigachat принудительно non-streaming даже при streaming_enabled=True."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from pydantic import SecretStr

    from app.domains.chat.services.orchestrator import Orchestrator
    from app.domains.chat.settings import ChatDomainSettings

    settings = ChatDomainSettings(
        profile="gigachat",
        api_base="http://liveaccess/v1/gc",
        api_key=SecretStr("t"),
        model="GigaChat-3-Ultra",
        streaming_enabled=True,  # включён в настройках
    )
    msg_service = MagicMock()
    msg_service.get_history = AsyncMock(return_value=[])
    conv_service = MagicMock()

    orch = Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings,
    )

    # Мокаем underlying API — отдаём простой текстовый ответ
    from openai.types.chat import ChatCompletion
    fake_resp = ChatCompletion.model_validate({
        "id": "x", "object": "chat.completion", "created": 0,
        "model": "GigaChat-3-Ultra",
        "choices": [{"index": 0, "message": {
            "role": "assistant", "content": "Привет",
        }, "finish_reason": "stop"}],
    })

    with patch(
        "app.domains.chat.services.orchestrator.build_llm_client",
    ) as mock_build:
        fake_client = MagicMock()
        fake_client.chat.completions.create = AsyncMock(return_value=fake_resp)
        mock_build.return_value = fake_client

        with patch.object(
            orch, "_save_assistant_message", new=AsyncMock(),
        ):
            chunks = []
            async for chunk in orch.run_stream(
                conversation_id="c1",
                user_message="привет",
            ):
                chunks.append(chunk)

    # Проверяем: ни одного вызова с stream=True
    for call in fake_client.chat.completions.create.await_args_list:
        assert call.kwargs.get("stream", False) is False, (
            "Оркестратор не должен звать LLM со stream=True для gigachat"
        )
