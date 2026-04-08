"""
Оркестратор agent loop для AI-чата.

Управляет циклом: LLM → tool calls → результат → LLM → ... → финальный ответ.
Поддерживает полный (run) и стриминговый (run_stream) режимы.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncGenerator
from datetime import date
from functools import lru_cache
from typing import Any

from app.core.chat.tools import (
    get_openai_tools,
    get_tool,
    get_tools_by_domain,
)
from app.core.settings_registry import get as get_domain_settings
from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.message_service import MessageService
from app.domains.chat.services.streaming import (
    sse_block_delta,
    sse_block_end,
    sse_block_start,
    sse_error,
    sse_message_end,
    sse_message_start,
    sse_tool_call,
    sse_tool_result,
)
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.orchestrator")


@lru_cache(maxsize=1)
def _get_openai_client(api_base: str, api_key: str):
    """Singleton AsyncOpenAI клиент (кэшируется по параметрам подключения)."""
    from openai import AsyncOpenAI
    return AsyncOpenAI(base_url=api_base, api_key=api_key)


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

    def _build_system_messages(
        self, domains: list[str] | None,
    ) -> list[dict[str, str]]:
        """Собирает системный промпт из базового + доменных промптов."""
        base_prompt = self.settings.system_prompt

        if domains:
            from app.core.domain_registry import get_domain
            domain_prompts = []
            for domain_name in domains:
                d = get_domain(domain_name)
                if d and d.chat_system_prompt:
                    domain_prompts.append(d.chat_system_prompt)
            if domain_prompts:
                base_prompt = base_prompt + "\n\n" + "\n\n".join(domain_prompts)

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
            elif isinstance(content_blocks, str):
                text_parts.append(content_blocks)

            content = "\n".join(text_parts)
            if content:
                messages.append({"role": role, "content": content})

        return messages

    def _get_openai_client(self):
        """Возвращает AsyncOpenAI клиент."""
        return _get_openai_client(
            self.settings.api_base,
            self.settings.api_key.get_secret_value(),
        )

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
                return json.dumps(result, ensure_ascii=False, default=str)
            return str(result)
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
        messages.append({"role": "user", "content": user_message})

        sources: list[str] = []
        token_usage: dict[str, Any] = {}

        try:
            response = await client.chat.completions.create(
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

                response = await client.chat.completions.create(
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

            # Сохраняем сообщение ассистента в БД
            content_blocks = [{"type": "text", "content": answer}]
            await self.msg_service.save_assistant_message(
                conversation_id=conversation_id,
                content=content_blocks,
                model=self.settings.model,
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
    ) -> AsyncGenerator[str, None]:
        """
        Стриминговый agent loop — генерирует SSE-события.

        Если streaming_enabled, использует stream=True с автофолбеком.
        Всегда yield-ит message_start/message_end.
        """
        message_id = str(uuid.uuid4())
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
        messages.append({"role": "user", "content": user_message})

        sources: list[str] = []
        token_usage: dict[str, Any] = {}
        full_answer = ""
        block_index = 0

        try:
            use_streaming = self.settings.streaming_enabled
            rounds = 0

            while rounds <= self.settings.max_tool_rounds:
                if use_streaming:
                    # Стриминговый вызов LLM
                    try:
                        response_stream = await client.chat.completions.create(
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
                    accumulated_tool_calls: dict[int, dict] = {}
                    block_started = False
                    finish_reason = None

                    async for chunk in response_stream:
                        if not chunk.choices:
                            continue
                        delta = chunk.choices[0].delta
                        if delta is None:
                            continue

                        if chunk.choices[0].finish_reason:
                            finish_reason = chunk.choices[0].finish_reason

                        # Текстовый контент
                        if delta.content:
                            text = delta.content
                            # Убираем ведущие переносы строк
                            # (модели с thinking отдают \n\n перед ответом)
                            if not block_started:
                                text = text.lstrip("\n")
                                if not text:
                                    continue
                            if not block_started:
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

                        # Tool calls (инкрементальная сборка)
                        if delta.tool_calls:
                            for tc_delta in delta.tool_calls:
                                idx = tc_delta.index
                                if idx not in accumulated_tool_calls:
                                    accumulated_tool_calls[idx] = {
                                        "id": "",
                                        "name": "",
                                        "arguments": "",
                                    }
                                if tc_delta.id:
                                    accumulated_tool_calls[idx]["id"] = tc_delta.id
                                if tc_delta.function:
                                    if tc_delta.function.name:
                                        accumulated_tool_calls[idx]["name"] = (
                                            tc_delta.function.name
                                        )
                                    if tc_delta.function.arguments:
                                        accumulated_tool_calls[idx]["arguments"] += (
                                            tc_delta.function.arguments
                                        )

                    if block_started:
                        yield sse_block_end(block_index=block_index)
                        block_index += 1

                    # Обработка tool calls из стриминга
                    if accumulated_tool_calls and finish_reason == "tool_calls":
                        tool_calls_for_msg = []
                        for idx in sorted(accumulated_tool_calls):
                            tc_data = accumulated_tool_calls[idx]
                            tool_calls_for_msg.append({
                                "id": tc_data["id"],
                                "type": "function",
                                "function": {
                                    "name": tc_data["name"],
                                    "arguments": tc_data["arguments"],
                                },
                            })

                        messages.append({
                            "role": "assistant",
                            "content": accumulated_content or None,
                            "tool_calls": tool_calls_for_msg,
                        })

                        for tc_data in [
                            accumulated_tool_calls[i]
                            for i in sorted(accumulated_tool_calls)
                        ]:
                            tool_name = tc_data["name"]
                            try:
                                arguments = json.loads(tc_data["arguments"])
                            except json.JSONDecodeError:
                                arguments = {}

                            yield sse_tool_call(
                                tool_name=tool_name,
                                tool_call_id=tc_data["id"],
                                arguments=arguments,
                            )

                            result = await self._execute_tool_call(
                                tool_name, arguments,
                            )
                            sources.append(tool_name)

                            yield sse_tool_result(
                                tool_name=tool_name,
                                tool_call_id=tc_data["id"],
                                result=result,
                            )

                            messages.append({
                                "role": "tool",
                                "tool_call_id": tc_data["id"],
                                "content": result,
                            })

                        rounds += 1
                        continue

                    # Финальный ответ (без tool calls)
                    full_answer = accumulated_content
                    break

                # Non-streaming вызов (фолбек или tool-call раунды)
                response = await client.chat.completions.create(
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

                        yield sse_tool_call(
                            tool_name=tool_name,
                            tool_call_id=tc.id,
                            arguments=arguments,
                        )

                        result = await self._execute_tool_call(
                            tool_name, arguments,
                        )
                        sources.append(tool_name)

                        yield sse_tool_result(
                            tool_name=tool_name,
                            tool_call_id=tc.id,
                            result=result,
                        )

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": result,
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

            # Сохраняем сообщение ассистента
            if full_answer:
                content_blocks = [{"type": "text", "content": full_answer}]
                await self.msg_service.save_assistant_message(
                    conversation_id=conversation_id,
                    content=content_blocks,
                    model=self.settings.model,
                    token_usage=token_usage if token_usage else None,
                )

        except Exception as exc:
            logger.exception("Ошибка стримингового agent loop")
            yield sse_error(error="Временная ошибка AI-сервиса. Попробуйте позже.")

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
