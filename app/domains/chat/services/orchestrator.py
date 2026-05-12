"""
Оркестратор agent loop для AI-чата.

Управляет циклом: LLM → tool calls → результат → LLM → ... → финальный ответ.
Поддерживает полный (run) и стриминговый (run_stream) режимы.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncGenerator
from datetime import date
from typing import Any

from app.core.chat.tools import (
    get_openai_tools,
    get_tool,
    get_tools_by_domain,
)
from app.core.settings_registry import get as get_domain_settings
from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.llm_client import build_llm_client
from app.domains.chat.services.message_service import MessageService
from app.domains.chat.services.retry import retry_on_transient
from app.domains.chat.services.streaming import (
    sse_block_delta,
    sse_block_end,
    sse_block_start,
    sse_buttons,
    sse_client_action,
    sse_error,
    sse_message_end,
    sse_message_start,
    sse_tool_call,
    sse_tool_result,
)
from app.domains.chat.services.tool_call_accumulator import ToolCallAccumulator
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.orchestrator")


def _convert_param(value: Any, param_type: str) -> Any:
    """Конвертация значения параметра из JSON в Python-тип."""
    if value is None:
        return None
    if param_type == "boolean":
        if isinstance(value, bool):
            return value
        return str(value).lower() in ("true", "1")
    if param_type == "integer":
        return int(value)
    if param_type == "date":
        if isinstance(value, str):
            return date.fromisoformat(value)
        return value
    if param_type == "string":
        return str(value)
    return value


BASE_SYSTEM_PROMPT = (
    "Ты — ассистент в AuditWorkstation.\n\n"
    "ВАЖНОЕ ПРАВИЛО ПРИОРИТЕТА:\n"
    "По умолчанию любые вопросы пользователя про данные, контент, акты, "
    "нормативы, регламенты, фактуры, нарушения, метрики, реестры — "
    "передавай через chat.forward_to_knowledge_agent. Внешний агент сам "
    "найдёт информацию.\n\n"
    "Локальные action-tools (open_*, navigate_*, notify, ...) — вызывай "
    "ТОЛЬКО когда пользователь явно просит что-то сделать в интерфейсе "
    "(\"открой\", \"создай\", \"перейди\", \"покажи на странице\").\n\n"
    "Не сочиняй данные из БЗ — всегда передавай вопрос внешнему агенту."
)


class Orchestrator:
    """Оркестратор agent loop для AI-чата."""

    def __init__(
        self,
        *,
        msg_service: MessageService,
        conv_service: ConversationService,
        settings: ChatDomainSettings | None = None,
    ):
        self.msg_service = msg_service
        self.conv_service = conv_service
        self.settings = settings or get_domain_settings("chat", ChatDomainSettings)
        self._retry_call = retry_on_transient(
            on_429=self.settings.retry.on_429,
            on_5xx=self.settings.retry.on_5xx,
            max_attempts=self.settings.retry.max_attempts,
            backoff_base=self.settings.retry.backoff_base_sec,
        )

    async def _completions_create(self, client, **kwargs):
        """Обёрнутый retry'ем вызов chat.completions.create."""
        model = kwargs.get("model", self.settings.model)
        stream = kwargs.get("stream", False)
        msg_count = len(kwargs.get("messages") or [])
        logger.info(
            "LLM вызов: профиль=%s, модель=%s, история=%d сообщений, "
            "stream=%s",
            self.settings.profile, model, msg_count, stream,
        )
        logger.debug(
            "LLM запрос: модель=%s, max_tokens=%s, stream=%s, "
            "temperature=%s",
            model, kwargs.get("max_tokens"), stream,
            kwargs.get("temperature"),
        )
        started = time.monotonic()
        try:
            wrapped = self._retry_call(client.chat.completions.create)
            result = await wrapped(**kwargs)
        except Exception:
            logger.exception(
                "LLM вызов завершился ошибкой после ретраев: модель=%s",
                model,
            )
            raise
        if not stream:
            usage = getattr(result, "usage", None)
            tokens_in = getattr(usage, "prompt_tokens", None) if usage else None
            tokens_out = (
                getattr(usage, "completion_tokens", None) if usage else None
            )
            finish_reason = None
            if getattr(result, "choices", None):
                finish_reason = getattr(result.choices[0], "finish_reason", None)
            logger.info(
                "LLM ответ получен за %.2fс: tokens_in=%s, tokens_out=%s, "
                "finish=%s",
                time.monotonic() - started, tokens_in, tokens_out,
                finish_reason,
            )
        return result

    def _build_system_messages(
        self, domains: list[str] | None,
    ) -> list[dict[str, str]]:
        """Собирает системный промпт: базовый + правило small-talk + доменные."""
        smalltalk_line = (
            "\n\nДля small-talk (приветствия, вопросы о тебе) давай "
            "локальный краткий текстовый ответ без вызова инструментов."
            if self.settings.smalltalk_mode == "local"
            else "\n\nДля small-talk также вызывай chat.forward_to_knowledge_agent."
        )
        base_prompt = BASE_SYSTEM_PROMPT + smalltalk_line

        if domains:
            from app.core.domain_registry import get_domain
            domain_prompts = []
            for domain_name in domains:
                d = get_domain(domain_name)
                if d and d.chat_system_prompt:
                    domain_prompts.append(d.chat_system_prompt)
            if domain_prompts:
                base_prompt = base_prompt + "\n\n" + "\n\n".join(domain_prompts)

        # Раздел "Доступные страницы" — список NavItem всех известных доменов
        from app.core.domain_registry import get_all_domains
        available_pages: list[str] = []
        for d in get_all_domains():
            for nav in d.nav_items:
                if not nav.url:
                    continue
                line = f"- {nav.label} ({nav.url})"
                if nav.description:
                    line += f" — {nav.description}"
                available_pages.append(line)
        if available_pages:
            base_prompt += "\n\n## Доступные страницы\n" + "\n".join(
                available_pages,
            )

        base_prompt += (
            "\n\n## Открытие страниц\n"
            "- Когда пользователь спрашивает что ты умеешь, какие функции "
            "доступны, что есть в системе — вызови инструмент "
            "chat.list_pages. Не пиши свой текст перед или после — "
            "инструмент сам выдаст описание и кнопки.\n"
            "- Когда пользователь просит открыть конкретную страницу из "
            "списка — вызови соответствующий инструмент "
            "`<домен>.open_<...>` (например admin.open_admin_panel).\n"
            "- Для открытия конкретного акта по КМ-номеру или СЗ — вызови "
            "acts.open_act_page.\n"
        )

        return [{"role": "system", "content": base_prompt}]

    def _get_tools(self, domains: list[str] | None) -> list[dict]:
        """Возвращает tools в OpenAI-формате, опционально фильтруя по доменам."""
        if domains:
            tools_list = []
            for domain_name in domains:
                tools_list.extend(get_tools_by_domain(domain_name))
            return [t.to_openai_tool() for t in tools_list]
        return get_openai_tools()

    async def _get_history_messages(
        self, conversation_id: str,
    ) -> list[dict[str, str]]:
        """
        Загружает историю из БД и конвертирует в формат OpenAI messages.

        Извлекает текст из блоков контента:
        - text → текст
        - reasoning → текст
        - code → markdown fenced code block
        """
        history = await self.msg_service.get_history(conversation_id)
        messages: list[dict[str, str]] = []

        # Ограничиваем историю по настройкам
        if len(history) > self.settings.max_history_length:
            history = history[-self.settings.max_history_length:]

        for msg in history:
            role = msg.get("role", "user")
            content_blocks = msg.get("content", [])

            # Собираем текст из блоков
            text_parts: list[str] = []
            if isinstance(content_blocks, list):
                for block in content_blocks:
                    if not isinstance(block, dict):
                        continue
                    block_type = block.get("type", "")
                    if block_type == "text":
                        text_parts.append(block.get("content", block.get("text", "")))
                    elif block_type == "reasoning":
                        text_parts.append(block.get("content", block.get("text", "")))
                    elif block_type == "code":
                        lang = block.get("language", "")
                        code = block.get("content", block.get("code", ""))
                        text_parts.append(f"```{lang}\n{code}\n```")
                    elif block_type == "file":
                        fname = block.get("filename", "файл")
                        text_parts.append(f"[Прикреплён файл: {fname}]")
            elif isinstance(content_blocks, str):
                text_parts.append(content_blocks)

            content = "\n".join(text_parts)
            if content:
                messages.append({"role": role, "content": content})

        return messages

    async def _build_user_content(
        self,
        user_message: str,
        file_blocks: list[dict] | None,
        conversation_id: str | None = None,
    ) -> str:
        """Строит содержимое user-сообщения: текст + извлечённый контент файлов."""
        if not file_blocks:
            return user_message

        from app.db.connection import get_db
        from app.domains.chat.repositories.file_repository import FileRepository
        from app.domains.chat.services.file_extraction import extract_text

        parts = [user_message]
        async with get_db() as conn:
            file_repo = FileRepository(conn)
            for fb in file_blocks:
                file_id = fb.get("file_id")
                if not file_id:
                    continue
                # Получаем данные через репозиторий с проверкой conversation_id
                if conversation_id:
                    row = await file_repo.get_file_content(
                        file_id=file_id,
                        conversation_id=conversation_id,
                    )
                else:
                    row = await file_repo.get_file_content(
                        file_id=file_id,
                        conversation_id="",
                    )
                if not row:
                    continue
                text = extract_text(
                    row["file_data"], row["mime_type"], row["filename"],
                )
                parts.append(f"\n--- Файл: {row['filename']} ---\n{text}")

        return "\n".join(parts)

    def _get_openai_client(self):
        """Возвращает AsyncOpenAI клиент согласно профильным настройкам."""
        return build_llm_client(self.settings)

    async def _save_assistant_message(
        self,
        *,
        conversation_id: str,
        content_blocks: list[dict],
        token_usage: dict | None,
    ) -> None:
        """Сохраняет сообщение ассистента с отдельным соединением из пула.

        StreamingResponse может пережить dependency-соединение,
        поэтому для сохранения берём свежее соединение.
        """
        from app.db.connection import get_db
        from app.domains.chat.repositories.conversation_repository import (
            ConversationRepository,
        )
        from app.domains.chat.repositories.message_repository import (
            MessageRepository,
        )

        async with get_db() as conn:
            msg_service = MessageService(
                msg_repo=MessageRepository(conn),
                conv_repo=ConversationRepository(conn),
                settings=self.settings,
            )
            await msg_service.save_assistant_message(
                conversation_id=conversation_id,
                content=content_blocks,
                model=self.settings.model,
                token_usage=token_usage if token_usage else None,
            )

    async def _handle_forward_call(
        self,
        *,
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
        """Создаёт agent_request и стримит ответы внешнего агента как SSE.

        Yield-ит кортежи (kind, payload):
          - ("sse", "...SSE-строка...") — событие для StreamingResponse
          - ("error", "...SSE-error...") — ошибка регистрации запроса
          - ("final", {"blocks": [...], "token_usage": {...}}) — финальные данные
            для сохранения ассистент-сообщения
        """
        from app.db.connection import get_db
        from app.domains.chat.integrations.forward_handler import (
            FORWARD_SENTINEL_PATTERN,
            build_forward_handler,
        )
        from app.domains.chat.services.agent_bridge import (
            AgentBridgeService,
            AgentBridgeTimeout,
        )

        # Открываем свежее соединение из пула — соединение из dependency
        # может закрыться к моменту, когда мы окажемся внутри SSE-стрима.
        async with get_db() as conn:
            handler = build_forward_handler(
                conn=conn,
                conversation_id=conversation_id,
                message_id=message_id,
                user_id=user_id,
                domain_name=domain_name,
                knowledge_bases=knowledge_bases,
                history=history,
                files=files,
            )
            sentinel = await handler(**arguments)
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

            bridge = AgentBridgeService(conn)
            try:
                async for upd in bridge.wait_for_completion(
                    request_id,
                    poll_interval_sec=self.settings.agent_bridge.poll_interval_sec,
                    initial_response_timeout_sec=self.settings.agent_bridge.initial_response_timeout_sec,
                    event_timeout_sec=self.settings.agent_bridge.event_timeout_sec,
                    max_total_duration_sec=self.settings.agent_bridge.max_total_duration_sec,
                ):
                    if upd.event:
                        ev = upd.event
                        if ev["event_type"] == "reasoning":
                            chunk_text = (ev["payload"] or {}).get("text", "")
                            if not chunk_text:
                                continue
                            logger.info(
                                "Событие агента: тип=reasoning, длина=%d",
                                len(chunk_text),
                            )
                            # Каждый reasoning-чанк — отдельный сворачиваемый
                            # блок (start + delta + end), со своим block_index.
                            yield (
                                "sse",
                                sse_block_start(
                                    block_index=block_index,
                                    block_type="reasoning",
                                ),
                            )
                            yield (
                                "sse",
                                sse_block_delta(
                                    block_index=block_index,
                                    delta=chunk_text,
                                ),
                            )
                            yield (
                                "sse",
                                sse_block_end(block_index=block_index),
                            )
                            block_index += 1
                        elif ev["event_type"] == "error":
                            payload = ev["payload"] or {}
                            yield (
                                "sse",
                                sse_error(
                                    error=payload.get(
                                        "message", "Ошибка внешнего агента",
                                    ),
                                    code=payload.get("code"),
                                ),
                            )
                        # status — пока игнорируем
                    if upd.response:
                        logger.info(
                            "Финальный ответ агента: request_id=%s, "
                            "blocks=%d, tokens=%s",
                            request_id,
                            len(upd.response.get("blocks") or []),
                            upd.response.get("token_usage"),
                        )
                        # Финальные блоки от агента: эмитим их как SSE-блоки
                        for raw_block in upd.response["blocks"]:
                            btype = raw_block.get("type", "text")
                            if btype == "buttons":
                                # buttons — отдельный SSE-канал, без block_index;
                                # серверные action_id (имена ChatTool) переводим
                                # в клиентские действия через button_translator.
                                translated = await self._translate_buttons(
                                    raw_block.get("buttons", []),
                                )
                                # Мутируем raw_block в response, чтобы в БД
                                # сохранилась уже транслированная версия.
                                raw_block["buttons"] = translated
                                yield (
                                    "sse",
                                    sse_buttons(buttons=translated),
                                )
                                continue
                            if btype == "client_action":
                                # client_action исполняется фронтом сразу
                                yield (
                                    "sse",
                                    sse_client_action(block=raw_block),
                                )
                                continue
                            yield (
                                "sse",
                                sse_block_start(
                                    block_index=block_index, block_type=btype,
                                ),
                            )
                            if btype in ("text", "code"):
                                content_key = "code" if btype == "code" else "text"
                                delta = raw_block.get(content_key, "")
                                yield (
                                    "sse",
                                    sse_block_delta(
                                        block_index=block_index,
                                        delta=delta,
                                    ),
                                )
                            # Остальные типы (file, image, ...) — block_start/end
                            # без дельты; фронт возьмёт из сохранённого сообщения.
                            yield (
                                "sse",
                                sse_block_end(block_index=block_index),
                            )
                            block_index += 1
                        yield (
                            "final",
                            {
                                "blocks": upd.response["blocks"],
                                "token_usage": upd.response.get("token_usage") or {},
                            },
                        )
                        return
            except AgentBridgeTimeout:
                logger.warning(
                    "Forward: внешний агент не ответил вовремя, "
                    "request_id=%s",
                    request_id,
                )
                yield (
                    "sse",
                    sse_error(
                        error="Внешний агент не ответил вовремя. Попробуйте позже.",
                        code="agent_timeout",
                    ),
                )
                return

    def _parse_client_action_result(self, raw: str) -> dict | None:
        """Если result tool'а — JSON-блок client_action, возвращает dict.

        Иначе возвращает None (это обычный текстовый результат tool'а).
        """
        try:
            obj = json.loads(raw)
        except (ValueError, TypeError):
            return None
        if not isinstance(obj, dict):
            return None
        if obj.get("type") != "client_action":
            return None
        # Минимальная валидация
        if "action" not in obj:
            return None
        return obj

    def _parse_buttons_result(self, raw: str) -> dict | None:
        """Если result tool'а — JSON-блок buttons, возвращает dict.

        Иначе None.
        """
        try:
            obj = json.loads(raw)
        except (ValueError, TypeError):
            return None
        if not isinstance(obj, dict):
            return None
        if obj.get("type") != "buttons":
            return None
        if not isinstance(obj.get("buttons"), list):
            return None
        return obj

    def _parse_blocks_list_result(self, raw: str) -> list[dict] | None:
        """Если result tool'а — JSON-список блоков, возвращает список dict.

        Иначе None.
        """
        try:
            obj = json.loads(raw)
        except (ValueError, TypeError):
            return None
        if not isinstance(obj, list):
            return None
        if not all(isinstance(b, dict) and "type" in b for b in obj):
            return None
        return obj

    async def _translate_buttons(self, buttons: list[dict]) -> list[dict]:
        """Транслирует серверные action_id (имена ChatTool) в клиентские действия.

        Для каждой кнопки:
          - Если action_id — имя зарегистрированного ChatTool с button_translator,
            вызывает транслятор и заменяет action_id+params результатом.
          - Иначе пропускает кнопку без изменений. Если action_id похож на
            имя tool'а (содержит точку), но транслятор не зарегистрирован —
            пишет WARNING (это конфигурационный пробел).
        """
        result: list[dict] = []
        for btn in buttons:
            if not isinstance(btn, dict):
                result.append(btn)
                continue
            action_id = btn.get("action_id")
            tool = get_tool(action_id) if action_id else None
            if tool is not None:
                translator = getattr(tool, "button_translator", None)
                if translator is None:
                    logger.warning(
                        "Кнопка с action_id='%s' указывает на ChatTool, но "
                        "button_translator не зарегистрирован — кнопка не "
                        "будет обработана клиентом",
                        action_id,
                    )
                    result.append(btn)
                    continue
                try:
                    translated = await translator(btn.get("params") or {})
                except Exception as exc:
                    logger.exception(
                        "button_translator '%s' завершился ошибкой: %s",
                        action_id, exc,
                    )
                    translated = None
                if translated:
                    result.append({
                        "action_id": translated["action"],
                        "label": btn.get("label", ""),
                        "params": translated.get("params", {}),
                    })
                    continue
            result.append(btn)
        return result

    async def _execute_tool_call(
        self, tool_name: str, arguments: dict,
    ) -> str:
        """Выполняет один вызов ChatTool и возвращает результат."""
        chat_tool = get_tool(tool_name)
        if chat_tool is None:
            return f"Ошибка: инструмент '{tool_name}' не найден"
        if chat_tool.handler is None:
            return f"Ошибка: инструмент '{tool_name}' не имеет обработчика"

        # Конвертация типов параметров
        param_types = {p.name: p.type for p in chat_tool.parameters}
        converted_args = {}
        for key, value in arguments.items():
            if key in param_types:
                converted_args[key] = _convert_param(value, param_types[key])

        try:
            timeout = self.settings.tool_execution_timeout
            result = await asyncio.wait_for(
                chat_tool.handler(**converted_args),
                timeout=timeout,
            )
            if isinstance(result, dict):
                out = json.dumps(result, ensure_ascii=False, default=str)
            else:
                out = str(result)
            preview = out[:200] + "..." if len(out) > 200 else out
            logger.info(
                "Tool result: %s, длина=%d, preview=%s",
                tool_name, len(out), preview,
            )
            return out
        except asyncio.TimeoutError:
            logger.warning(
                "Таймаут выполнения ChatTool %s (%dс)", tool_name, timeout,
            )
            return f"Ошибка: таймаут выполнения инструмента '{tool_name}'"
        except Exception as exc:
            logger.exception("Ошибка выполнения ChatTool %s", tool_name)
            return f"Ошибка выполнения инструмента: {exc}"

    async def run(
        self,
        *,
        conversation_id: str,
        user_message: str,
        domains: list[str] | None = None,
        file_blocks: list[dict] | None = None,
    ) -> dict[str, Any]:
        """
        Полный (не стриминговый) agent loop.

        Возвращает dict с полями: response, sources, model, token_usage.
        """
        # Fallback при отсутствии настроек API
        if not self.settings.api_base or not self.settings.api_key.get_secret_value():
            return self._fallback_response(user_message)

        try:
            from openai import NOT_GIVEN
        except ImportError:
            logger.warning("Пакет openai не установлен, используется заглушка")
            return self._fallback_response(user_message)

        client = self._get_openai_client()
        tools = self._get_tools(domains)

        # Собираем messages: system + history + текущее сообщение
        messages = self._build_system_messages(domains)
        history = await self._get_history_messages(conversation_id)
        # Убираем последнее сообщение из истории — оно уже сохранено как user message,
        # но мы добавим его явно ниже
        if history and history[-1].get("role") == "user":
            history = history[:-1]
        messages.extend(history)

        user_content = await self._build_user_content(user_message, file_blocks, conversation_id)
        messages.append({"role": "user", "content": user_content})

        sources: list[str] = []
        token_usage: dict[str, Any] = {}

        try:
            response = await self._completions_create(
                client,
                model=self.settings.model,
                messages=messages,
                tools=tools if tools else NOT_GIVEN,
                temperature=self.settings.temperature,
            )

            # Agent loop
            rounds = 0
            while (
                response.choices[0].message.tool_calls
                and rounds < self.settings.max_tool_rounds
            ):
                rounds += 1
                assistant_msg = response.choices[0].message
                messages.append(assistant_msg)

                for tc in assistant_msg.tool_calls:
                    tool_name = tc.function.name
                    try:
                        arguments = json.loads(tc.function.arguments)
                    except json.JSONDecodeError:
                        arguments = {}

                    logger.info(
                        "Tool call #%d: %s(%s)", rounds, tool_name,
                        ", ".join(f"{k}={v!r}" for k, v in arguments.items()),
                    )
                    result = await self._execute_tool_call(tool_name, arguments)
                    sources.append(tool_name)

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    })

                response = await self._completions_create(
                    client,
                    model=self.settings.model,
                    messages=messages,
                    tools=tools if tools else NOT_GIVEN,
                    temperature=self.settings.temperature,
                )

            answer = (response.choices[0].message.content or "").lstrip("\n")

            if response.usage:
                token_usage = {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens,
                }

            # Сохраняем сообщение ассистента через свежее соединение из пула
            # (DI-соединение может быть закрыто при StreamingResponse)
            content_blocks = [{"type": "text", "content": answer}]
            await self._save_assistant_message(
                conversation_id=conversation_id,
                content_blocks=content_blocks,
                token_usage=token_usage if token_usage else None,
            )

            return {
                "response": answer,
                "sources": list(dict.fromkeys(sources)),
                "model": self.settings.model,
                "token_usage": token_usage,
            }

        except Exception as exc:
            logger.exception("Ошибка вызова LLM API")
            return {
                "response": "Временная ошибка AI-сервиса. Попробуйте позже.",
                "status": "error",
            }

    async def run_stream(
        self,
        *,
        conversation_id: str,
        user_message: str,
        domains: list[str] | None = None,
        file_blocks: list[dict] | None = None,
        message_id: str | None = None,
        user_id: str | None = None,
        knowledge_bases: list[str] | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        Стриминговый agent loop — генерирует SSE-события.

        Если streaming_enabled, использует stream=True с автофолбеком.
        Всегда yield-ит message_start/message_end.

        message_id, user_id, knowledge_bases используются для tool-call
        chat.forward_to_knowledge_agent — оркестратор подставляет
        замыкание-handler с контекстом текущего сообщения.
        """
        message_id = message_id or str(uuid.uuid4())
        run_started = time.monotonic()
        logger.info(
            "Старт оркестрации: conversation=%s, message=%s, домены=%s, "
            "files=%d",
            conversation_id, message_id, domains,
            len(file_blocks or []),
        )
        yield sse_message_start(
            conversation_id=conversation_id,
            message_id=message_id,
        )

        # Fallback при отсутствии настроек API
        if not self.settings.api_base or not self.settings.api_key.get_secret_value():
            fallback = self._fallback_response(user_message)
            yield sse_block_start(block_index=0, block_type="text")
            yield sse_block_delta(block_index=0, delta=fallback["response"])
            yield sse_block_end(block_index=0)
            yield sse_message_end(message_id=message_id)
            return

        try:
            from openai import NOT_GIVEN
        except ImportError:
            yield sse_block_start(block_index=0, block_type="text")
            yield sse_block_delta(
                block_index=0,
                delta="Пакет openai не установлен. Установите: pip install openai",
            )
            yield sse_block_end(block_index=0)
            yield sse_message_end(message_id=message_id)
            return

        client = self._get_openai_client()
        tools = self._get_tools(domains)

        # Собираем messages
        messages = self._build_system_messages(domains)
        history = await self._get_history_messages(conversation_id)
        if history and history[-1].get("role") == "user":
            history = history[:-1]
        messages.extend(history)

        user_content = await self._build_user_content(user_message, file_blocks, conversation_id)
        messages.append({"role": "user", "content": user_content})

        sources: list[str] = []
        token_usage: dict[str, Any] = {}
        full_answer = ""
        block_index = 0
        emitted_blocks: list[dict] = []  # ClientActionBlock'и, эмитнутые до финала

        try:
            use_streaming = self.settings.streaming_enabled
            rounds = 0

            while rounds <= self.settings.max_tool_rounds:
                if use_streaming:
                    # Стриминговый вызов LLM
                    try:
                        response_stream = await self._completions_create(
                            client,
                            model=self.settings.model,
                            messages=messages,
                            tools=tools if tools else NOT_GIVEN,
                            temperature=self.settings.temperature,
                            stream=True,
                        )
                    except Exception as exc:
                        logger.warning(
                            "Стриминг не удался, фолбек на обычный вызов: "
                            "%s: %s",
                            type(exc).__name__,
                            exc,
                        )
                        use_streaming = False

                if use_streaming:
                    # Собираем стриминговый ответ
                    accumulated_content = ""
                    acc = ToolCallAccumulator()
                    block_started = False
                    finish_reason = None
                    first_chunk_at: float | None = None
                    stream_started_at = time.monotonic()

                    async for chunk in response_stream:
                        if first_chunk_at is None:
                            first_chunk_at = time.monotonic()
                            logger.debug(
                                "LLM первый чанк за %.2fс",
                                first_chunk_at - stream_started_at,
                            )
                        if not chunk.choices:
                            continue

                        if chunk.choices[0].finish_reason:
                            finish_reason = chunk.choices[0].finish_reason

                        # Аккумулятор сам собирает tool_calls и reasoning_details
                        for event in acc.consume(chunk):
                            kind, payload = event
                            if kind == "content":
                                text = payload
                                # Убираем ведущие переносы строк
                                # (модели с thinking отдают \n\n перед ответом)
                                if not block_started:
                                    text = text.lstrip("\n")
                                    if not text:
                                        continue
                                    yield sse_block_start(
                                        block_index=block_index,
                                        block_type="text",
                                    )
                                    block_started = True
                                yield sse_block_delta(
                                    block_index=block_index,
                                    delta=text,
                                )
                                accumulated_content += text

                    if block_started:
                        yield sse_block_end(block_index=block_index)
                        block_index += 1

                    # Обработка tool calls из стриминга
                    finalized_tool_calls = (
                        acc.finalize() if finish_reason == "tool_calls" else []
                    )
                    if finalized_tool_calls:
                        tool_calls_for_msg = [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.name,
                                    "arguments": tc.arguments,
                                },
                            }
                            for tc in finalized_tool_calls
                        ]

                        assistant_msg = {
                            "role": "assistant",
                            "content": accumulated_content or None,
                            "tool_calls": tool_calls_for_msg,
                        }
                        # MiniMax M2: пробрасываем reasoning_details обратно
                        # в сообщение, чтобы качество tool-call не падало.
                        if acc.reasoning_details:
                            assistant_msg["reasoning_details"] = acc.reasoning_details
                        messages.append(assistant_msg)

                        for tc in finalized_tool_calls:
                            tool_name = tc.name
                            try:
                                arguments = json.loads(tc.arguments)
                            except json.JSONDecodeError:
                                arguments = {}

                            args_str = json.dumps(
                                arguments, ensure_ascii=False, default=str,
                            )
                            args_preview = (
                                args_str[:200] + "..."
                                if len(args_str) > 200 else args_str
                            )
                            logger.info(
                                "Tool call: %s, args=%s",
                                tool_name, args_preview,
                            )
                            yield sse_tool_call(
                                tool_name=tool_name,
                                tool_call_id=tc.id,
                                arguments=arguments,
                            )

                            if tool_name == "chat.forward_to_knowledge_agent":
                                # Терминальный tool: переключаемся в стрим из bridge
                                history_messages = await self._get_history_messages(
                                    conversation_id,
                                )
                                # Последнее user-сообщение уже сохранено —
                                # из истории его убираем, форвардим вопрос отдельно.
                                if (
                                    history_messages
                                    and history_messages[-1].get("role") == "user"
                                ):
                                    history_messages = history_messages[:-1]
                                final_blocks_for_save: list[dict] = []
                                final_token_usage: dict = {}
                                async for kind, payload in self._handle_forward_call(
                                    conversation_id=conversation_id,
                                    message_id=message_id,
                                    user_id=user_id or "",
                                    domain_name=(domains[0] if domains else None),
                                    knowledge_bases=knowledge_bases or [],
                                    history=history_messages,
                                    files=file_blocks or [],
                                    arguments=arguments,
                                    block_index=block_index,
                                ):
                                    if kind in ("sse", "error"):
                                        yield payload
                                    elif kind == "final":
                                        final_blocks_for_save = payload["blocks"]
                                        final_token_usage = payload["token_usage"]
                                sources.append(tool_name)
                                if final_blocks_for_save:
                                    try:
                                        await self._save_assistant_message(
                                            conversation_id=conversation_id,
                                            content_blocks=final_blocks_for_save,
                                            token_usage=final_token_usage or None,
                                        )
                                    except Exception:
                                        logger.exception(
                                            "Не удалось сохранить ответ агента",
                                        )
                                yield sse_message_end(
                                    message_id=message_id,
                                    model=self.settings.model,
                                    token_usage=(
                                        final_token_usage if final_token_usage else None
                                    ),
                                )
                                return

                            result = await self._execute_tool_call(
                                tool_name, arguments,
                            )
                            sources.append(tool_name)

                            yield sse_tool_result(
                                tool_name=tool_name,
                                tool_call_id=tc.id,
                                result=result,
                            )

                            client_action = self._parse_client_action_result(result)
                            blocks_list = (
                                None if client_action is not None
                                else self._parse_blocks_list_result(result)
                            )
                            buttons_block = (
                                None if (client_action is not None or blocks_list is not None)
                                else self._parse_buttons_result(result)
                            )
                            if client_action is not None:
                                # Команда выполняется фронтом сразу при получении.
                                # block_index НЕ инкрементим — это не блок контента
                                # в потоке; в _save_assistant_message блок сохранится
                                # как content для отображения в истории (где он будет
                                # показан как чип без исполнения).
                                yield sse_client_action(block=client_action)
                                emitted_blocks.append(client_action)
                                # LLM получает краткий итог, не JSON
                                tool_result_for_llm = (
                                    f"<выполнено: {tool_name}>"
                                )
                            elif blocks_list is not None:
                                for raw_block in blocks_list:
                                    btype = raw_block.get("type", "text")
                                    if btype == "buttons":
                                        translated = await self._translate_buttons(
                                            raw_block.get("buttons", []),
                                        )
                                        yield sse_buttons(buttons=translated)
                                        emitted_blocks.append(
                                            {"type": "buttons", "buttons": translated},
                                        )
                                        continue
                                    if btype == "client_action":
                                        yield sse_client_action(block=raw_block)
                                        emitted_blocks.append(raw_block)
                                        continue
                                    yield sse_block_start(
                                        block_index=block_index, block_type=btype,
                                    )
                                    if btype in ("text", "code"):
                                        content_key = (
                                            "code" if btype == "code" else "text"
                                        )
                                        delta = raw_block.get(content_key, "")
                                        yield sse_block_delta(
                                            block_index=block_index, delta=delta,
                                        )
                                    yield sse_block_end(block_index=block_index)
                                    # Сохраняем блок для истории в едином формате
                                    # (text → content)
                                    if btype == "text":
                                        emitted_blocks.append({
                                            "type": "text",
                                            "content": raw_block.get("text", ""),
                                        })
                                    else:
                                        emitted_blocks.append(raw_block)
                                    block_index += 1
                                tool_result_for_llm = (
                                    f"<выполнено: {tool_name}>"
                                )
                            elif buttons_block is not None:
                                # Группа кнопок — отдельный SSE-канал
                                translated = await self._translate_buttons(
                                    buttons_block.get("buttons", []),
                                )
                                yield sse_buttons(buttons=translated)
                                emitted_blocks.append(
                                    {"type": "buttons", "buttons": translated},
                                )
                                tool_result_for_llm = (
                                    f"<выполнено: {tool_name}>"
                                )
                            else:
                                tool_result_for_llm = result

                            messages.append({
                                "role": "tool",
                                "tool_call_id": tc.id,
                                "content": tool_result_for_llm,
                            })

                        rounds += 1
                        continue

                    # Финальный ответ (без tool calls)
                    full_answer = accumulated_content
                    break

                # Non-streaming вызов (фолбек или tool-call раунды)
                response = await self._completions_create(
                    client,
                    model=self.settings.model,
                    messages=messages,
                    tools=tools if tools else NOT_GIVEN,
                    temperature=self.settings.temperature,
                )

                if response.choices[0].message.tool_calls:
                    assistant_msg = response.choices[0].message
                    messages.append(assistant_msg)

                    for tc in assistant_msg.tool_calls:
                        tool_name = tc.function.name
                        try:
                            arguments = json.loads(tc.function.arguments)
                        except json.JSONDecodeError:
                            arguments = {}

                        args_str = json.dumps(
                            arguments, ensure_ascii=False, default=str,
                        )
                        args_preview = (
                            args_str[:200] + "..."
                            if len(args_str) > 200 else args_str
                        )
                        logger.info(
                            "Tool call: %s, args=%s",
                            tool_name, args_preview,
                        )
                        yield sse_tool_call(
                            tool_name=tool_name,
                            tool_call_id=tc.id,
                            arguments=arguments,
                        )

                        if tool_name == "chat.forward_to_knowledge_agent":
                            # Терминальный tool: переключаемся в стрим из bridge
                            history_messages = await self._get_history_messages(
                                conversation_id,
                            )
                            if (
                                history_messages
                                and history_messages[-1].get("role") == "user"
                            ):
                                history_messages = history_messages[:-1]
                            final_blocks_for_save: list[dict] = []
                            final_token_usage: dict = {}
                            async for kind, payload in self._handle_forward_call(
                                conversation_id=conversation_id,
                                message_id=message_id,
                                user_id=user_id or "",
                                domain_name=(domains[0] if domains else None),
                                knowledge_bases=knowledge_bases or [],
                                history=history_messages,
                                files=file_blocks or [],
                                arguments=arguments,
                                block_index=block_index,
                            ):
                                if kind in ("sse", "error"):
                                    yield payload
                                elif kind == "final":
                                    final_blocks_for_save = payload["blocks"]
                                    final_token_usage = payload["token_usage"]
                            sources.append(tool_name)
                            if final_blocks_for_save:
                                try:
                                    await self._save_assistant_message(
                                        conversation_id=conversation_id,
                                        content_blocks=final_blocks_for_save,
                                        token_usage=final_token_usage or None,
                                    )
                                except Exception:
                                    logger.exception(
                                        "Не удалось сохранить ответ агента",
                                    )
                            yield sse_message_end(
                                message_id=message_id,
                                model=self.settings.model,
                                token_usage=(
                                    final_token_usage if final_token_usage else None
                                ),
                            )
                            return

                        result = await self._execute_tool_call(
                            tool_name, arguments,
                        )
                        sources.append(tool_name)

                        yield sse_tool_result(
                            tool_name=tool_name,
                            tool_call_id=tc.id,
                            result=result,
                        )

                        client_action = self._parse_client_action_result(result)
                        blocks_list = (
                            None if client_action is not None
                            else self._parse_blocks_list_result(result)
                        )
                        buttons_block = (
                            None if (client_action is not None or blocks_list is not None)
                            else self._parse_buttons_result(result)
                        )
                        if client_action is not None:
                            # Эмитим client_action как полноценный блок ответа
                            yield sse_block_start(
                                block_index=block_index,
                                block_type="client_action",
                            )
                            yield sse_block_delta(
                                block_index=block_index,
                                delta=json.dumps(
                                    client_action, ensure_ascii=False,
                                ),
                            )
                            yield sse_block_end(block_index=block_index)
                            # Сохраняем для итогового _save_assistant_message
                            emitted_blocks.append(client_action)
                            block_index += 1
                            # LLM получает краткий итог, не JSON
                            tool_result_for_llm = (
                                f"<выполнено: {tool_name}>"
                            )
                        elif blocks_list is not None:
                            for raw_block in blocks_list:
                                btype = raw_block.get("type", "text")
                                if btype == "buttons":
                                    translated = await self._translate_buttons(
                                        raw_block.get("buttons", []),
                                    )
                                    yield sse_buttons(buttons=translated)
                                    emitted_blocks.append(
                                        {"type": "buttons", "buttons": translated},
                                    )
                                    continue
                                if btype == "client_action":
                                    yield sse_client_action(block=raw_block)
                                    emitted_blocks.append(raw_block)
                                    continue
                                yield sse_block_start(
                                    block_index=block_index, block_type=btype,
                                )
                                if btype in ("text", "code"):
                                    content_key = (
                                        "code" if btype == "code" else "text"
                                    )
                                    delta = raw_block.get(content_key, "")
                                    yield sse_block_delta(
                                        block_index=block_index, delta=delta,
                                    )
                                yield sse_block_end(block_index=block_index)
                                if btype == "text":
                                    emitted_blocks.append({
                                        "type": "text",
                                        "content": raw_block.get("text", ""),
                                    })
                                else:
                                    emitted_blocks.append(raw_block)
                                block_index += 1
                            tool_result_for_llm = (
                                f"<выполнено: {tool_name}>"
                            )
                        elif buttons_block is not None:
                            translated = await self._translate_buttons(
                                buttons_block.get("buttons", []),
                            )
                            yield sse_buttons(buttons=translated)
                            emitted_blocks.append(
                                {"type": "buttons", "buttons": translated},
                            )
                            tool_result_for_llm = (
                                f"<выполнено: {tool_name}>"
                            )
                        else:
                            tool_result_for_llm = result

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": tool_result_for_llm,
                        })

                    rounds += 1
                    continue

                # Финальный текстовый ответ (non-streaming)
                answer = (response.choices[0].message.content or "").lstrip("\n")
                yield sse_block_start(block_index=block_index, block_type="text")
                yield sse_block_delta(block_index=block_index, delta=answer)
                yield sse_block_end(block_index=block_index)
                full_answer = answer

                if response.usage:
                    token_usage = {
                        "prompt_tokens": response.usage.prompt_tokens,
                        "completion_tokens": response.usage.completion_tokens,
                        "total_tokens": response.usage.total_tokens,
                    }
                break

            # Сохраняем сообщение ассистента (свежее соединение из пула,
            # т.к. dependency-соединение может быть закрыто к этому моменту).
            # Ошибка сохранения не должна emit'ить error SSE после контента.
            content_blocks: list[dict] = list(emitted_blocks)
            if full_answer:
                content_blocks.append({"type": "text", "content": full_answer})
            if content_blocks:
                try:
                    await self._save_assistant_message(
                        conversation_id=conversation_id,
                        content_blocks=content_blocks,
                        token_usage=token_usage,
                    )
                except Exception:
                    logger.exception("Не удалось сохранить сообщение ассистента")

        except Exception as exc:
            logger.exception("Ошибка стримингового agent loop")
            yield sse_error(error="Временная ошибка AI-сервиса. Попробуйте позже.")

        logger.info(
            "Оркестрация завершена: conversation=%s, длительность=%.2fс, "
            "tokens=%s",
            conversation_id, time.monotonic() - run_started,
            token_usage if token_usage else None,
        )
        yield sse_message_end(
            message_id=message_id,
            model=self.settings.model,
            token_usage=token_usage if token_usage else None,
        )

    def _fallback_response(self, user_message: str) -> dict[str, Any]:
        """Заглушка при отсутствии настроек LLM API."""
        from app.core.chat.tools import get_all_tools

        tools = get_all_tools()
        response_text = f'Вы написали: "{user_message}"'

        if tools:
            response_text += (
                f"\n\nДоступно инструментов: {len(tools)}. "
                "Для полноценной работы AI-ассистента настройте "
                "CHAT__API_BASE и CHAT__API_KEY в .env."
            )
        else:
            response_text += "\n\nИнструменты не зарегистрированы."

        response_text += (
            "\n\nAI-ассистент работает в режиме заглушки. "
            "Настройте подключение к LLM API для полноценных ответов."
        )

        return {"response": response_text, "sources": [], "status": "fallback"}
