"""Streaming agent loop оркестратора.

Логика жила в ``Orchestrator.run_stream`` (~960 строк). Вынесена сюда
pure-генератор-функцией, принимающей ссылку на ``Orchestrator``: все
зависимости (LLM-вызов, tool executor, save_assistant_message, parse_*,
build_*) — методы класса, которые тесты могут патчить через
``patch.object`` / instance assign. Pure-функция зовёт их через ``orch.``,
поэтому существующие mock'и продолжают работать.

В ``Orchestrator.run_stream`` остаётся тонкий wrapper-генератор, который
устанавливает context-атрибуты (``_current_conversation_id`` /
``_current_user_id``) и делегирует сюда.

GigaChat non-streaming fallback — внутренняя if-ветка функции, ровно как
было в исходнике (forward к внешнему агенту работает в обеих ветках через
``forward_bridge.handle_forward_call``).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING, Any

from app.core.chat.names import TOOL_FORWARD_TO_KNOWLEDGE_AGENT
from app.domains.chat.exceptions import ChatToolValidationError
from app.domains.chat.services.forward_bridge import handle_forward_call
from app.domains.chat.services.orchestrator_helpers import (
    TOOL_VALIDATION_NEUTRAL_MESSAGE,
    safe_args as _safe_args,
)
from app.domains.chat.services.streaming import (
    BlockDeltaLimiter,
    emit_text_block_with_limit,
    sse_block_complete,
    sse_block_delta,
    sse_block_end,
    sse_block_start,
    sse_buttons,
    sse_client_action,
    sse_error,
    sse_message_end,
    sse_message_start,
    sse_tool_call,
    sse_tool_error,
    sse_tool_result,
)
from app.domains.chat.services.tool_call_accumulator import ToolCallAccumulator

if TYPE_CHECKING:
    from app.domains.chat.services.orchestrator import Orchestrator

logger = logging.getLogger("audit_workstation.domains.chat.stream_loop")


async def run_stream_loop(
    orch: "Orchestrator",
    *,
    conversation_id: str,
    user_message: str,
    message_id: str,
    domains: list[str] | None = None,
    file_blocks: list[dict] | None = None,
    user_id: str | None = None,
    knowledge_bases: list[str] | None = None,
) -> AsyncGenerator[str, None]:
    """Стриминговый agent loop — генерирует SSE-события.

    Если streaming_enabled, использует stream=True с автофолбеком.
    Всегда yield-ит message_start/message_end.

    ``message_id`` обязателен — тот же id, что попадёт в БД через
    ``_save_assistant_message`` (используется для детерминированного
    ``block_id`` и для контекста forward'а к внешнему агенту).
    """
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
    if (
        not orch.settings.api_base
        or not orch.settings.api_key.get_secret_value()
    ):
        fallback = orch._fallback_response(user_message)
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

    client = orch._get_openai_client()
    tools = orch._get_tools(domains)

    # Собираем messages
    messages = orch._build_system_messages(domains)
    history = await orch._get_history_messages(conversation_id)
    if history and history[-1].get("role") == "user":
        history = history[:-1]
    messages.extend(history)

    user_content = await orch._build_user_content(
        user_message, file_blocks, conversation_id,
    )
    messages.append({"role": "user", "content": user_content})

    sources: list[str] = []
    token_usage: dict[str, Any] = {}
    full_answer = ""
    block_index = 0
    # Счётчик client_action-блоков для детерминированного block_id
    # ``f"{message_id}:ca:{i}"``. Обёрнут в list, чтобы parser-методы
    # могли инкрементировать его in-place.
    ca_counter: list[int] = [0]
    emitted_blocks: list[dict] = []  # ClientActionBlock'и, эмитнутые до финала
    # GigaChat поддерживает только 1 function_call за раунд. Если LLM
    # вернул >1 tool_call, первый исполняем сейчас, остальные — в очередь.
    pending_tool_calls: list[Any] = []
    is_gigachat = orch.settings.profile == "gigachat"
    # Отслеживание повторяющихся ошибок валидации tool'ов.
    _last_validation_error: tuple[str, str] | None = None
    _consecutive_validation_errors = 0

    try:
        # GigaChat-proxy не поддерживает SSE — выключаем streaming
        # для этого профиля даже если в .env стоит true.
        use_streaming = (
            orch.settings.streaming_enabled
            and orch.settings.profile != "gigachat"
        )
        rounds = 0
        # Семантика max_tool_rounds — максимальное число tool-call
        # раундов (см. зеркальный non-streaming run()). Используем
        # строгое `<` с пост-инкрементом внутри, чтобы при
        # max_tool_rounds=N инструмент вызывался ровно N раз; на N+1
        # итерации модель уже не получает шанс вызвать tool. Иначе
        # стримящий путь делал N+1 раунд (off-by-one).
        max_tool_rounds = orch.settings.max_tool_rounds

        while rounds < max_tool_rounds:
            # Если очередь GigaChat не пуста — исполняем следующий tool
            # без вызова LLM. Очередь заполняется ниже, когда профиль
            # gigachat и LLM вернул >1 tool_call.
            if pending_tool_calls:
                tc = pending_tool_calls.pop(0)
                tool_name = tc["name"] if isinstance(tc, dict) else tc.name
                tc_id = tc["id"] if isinstance(tc, dict) else tc.id
                raw_args = (tc.get("arguments") if isinstance(tc, dict)
                            else getattr(getattr(tc, "function", None), "arguments", ""))
                try:
                    arguments = json.loads(_safe_args(raw_args))
                except json.JSONDecodeError:
                    arguments = {}
                logger.info(
                    "GigaChat queue tool call #%d: %s(%s)", rounds, tool_name,
                    ", ".join(f"{k}={v!r}" for k, v in arguments.items()),
                )
                yield sse_tool_call(
                    tool_name=tool_name,
                    tool_call_id=tc_id,
                    arguments=arguments,
                )
                try:
                    result = await orch._execute_tool_call(tool_name, arguments)
                    _last_validation_error = None
                    _consecutive_validation_errors = 0
                except ChatToolValidationError as exc:
                    error_key = (exc.message, tool_name)
                    if _last_validation_error == error_key:
                        _consecutive_validation_errors += 1
                    else:
                        _last_validation_error = error_key
                        _consecutive_validation_errors = 1
                    logger.warning(
                        "Tool validation error (queue): %s (consecutive=%d)",
                        exc.message, _consecutive_validation_errors,
                    )
                    if _consecutive_validation_errors >= 2:
                        error_answer = (
                            f"Модель не смогла корректно вызвать инструмент "
                            f"`{tool_name}`. Перефразируйте запрос."
                        )
                        yield sse_error(error=error_answer, code="tool_validation_loop")
                        content_blocks = list(emitted_blocks)
                        content_blocks.append({
                            "type": "error",
                            "message": error_answer,
                            "code": "tool_validation_loop",
                        })
                        await orch._save_assistant_message(
                            conversation_id=conversation_id,
                            content_blocks=content_blocks,
                            token_usage=token_usage,
                            message_id=message_id,
                        )
                        yield sse_message_end(
                            message_id=message_id,
                            model=orch.settings.model,
                            token_usage=token_usage if token_usage else None,
                        )
                        return
                    result = TOOL_VALIDATION_NEUTRAL_MESSAGE
                    yield sse_tool_error(
                        tool_name=tool_name,
                        tool_call_id=tc_id,
                        message=TOOL_VALIDATION_NEUTRAL_MESSAGE,
                    )
                sources.append(tool_name)
                yield sse_tool_result(
                    tool_name=tool_name, tool_call_id=tc_id, result=result,
                )
                messages.append({"role": "tool", "tool_call_id": tc_id, "content": result})
                rounds += 1
                if pending_tool_calls:
                    continue
                # Очередь опустела — звоним LLM
                if use_streaming:
                    try:
                        response_stream = await orch._completions_create(
                            client,
                            model=orch.settings.model,
                            messages=messages,
                            tools=tools if tools else NOT_GIVEN,
                            temperature=orch.settings.temperature,
                            stream=True,
                        )
                    except Exception as exc:
                        logger.warning(
                            "Стриминг не удался после GigaChat-queue, "
                            "фолбек: %s: %s", type(exc).__name__, exc,
                        )
                        use_streaming = False
                if not use_streaming:
                    response, _fb_used, client = await orch._llm_call_with_fallback(
                        client,
                        model=orch.settings.model,
                        messages=messages,
                        tools=tools if tools else NOT_GIVEN,
                        temperature=orch.settings.temperature,
                        force_non_streaming=True,
                    )
                    if _fb_used and orch._fallback_is_gigachat():
                        is_gigachat = True
                continue

            if use_streaming:
                # Стриминговый вызов LLM. При сбое primary до первого
                # чанка может сработать fallback: если он gigachat —
                # перейдём на non-streaming, иначе — повторим streaming
                # через fallback-клиента. Уже эмитированные блоки
                # делают fallback невозможным; если стрим начался и
                # сорвался — оригинальный exception пробрасывается.
                try:
                    response_stream = await orch._completions_create(
                        client,
                        model=orch.settings.model,
                        messages=messages,
                        tools=tools if tools else NOT_GIVEN,
                        temperature=orch.settings.temperature,
                        stream=True,
                    )
                except Exception as exc:
                    is_provider = orch._is_provider_failure(exc)
                    if is_provider:
                        breaker = orch._get_circuit_breaker()
                        await breaker.record_failure(exc)
                    # Pre-stream fallback (только если ни одного блока
                    # ещё не yield-нули клиенту).
                    if (
                        is_provider
                        and not emitted_blocks
                        and block_index == 0
                        and orch._has_fallback()
                    ):
                        fb_client = orch._get_fallback_client()
                        if fb_client is not None:
                            logger.warning(
                                "Streaming primary упал (%s); "
                                "fallback на profile=%s",
                                type(exc).__name__,
                                orch.settings.fallback_profile,
                            )
                            client = fb_client
                            if orch._fallback_is_gigachat():
                                use_streaming = False
                                is_gigachat = True
                                # Переход на non-streaming-ветку ниже.
                            else:
                                try:
                                    response_stream = (
                                        await orch._completions_create(
                                            client,
                                            model=(
                                                orch.settings.fallback_model
                                                or orch.settings.model
                                            ),
                                            messages=messages,
                                            tools=(
                                                tools if tools else NOT_GIVEN
                                            ),
                                            temperature=(
                                                orch.settings.temperature
                                            ),
                                            stream=True,
                                        )
                                    )
                                except Exception as exc2:
                                    logger.warning(
                                        "Streaming fallback тоже упал "
                                        "(%s); переход на non-streaming",
                                        type(exc2).__name__,
                                    )
                                    use_streaming = False
                    else:
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
                limiter: BlockDeltaLimiter | None = None
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
                                limiter = BlockDeltaLimiter(
                                    block_index=block_index,
                                    chunk_flush_bytes=(
                                        orch.settings.delta_chunk_flush_bytes
                                    ),
                                    block_max_bytes=(
                                        orch.settings.delta_block_max_bytes
                                    ),
                                    block_type="text",
                                )
                            # Сохраняем полный текст для истории — лимит
                            # касается только сетевого SSE-стрима.
                            accumulated_content += text
                            if limiter is not None and not limiter.closed:
                                for sse in limiter.push(text):
                                    yield sse

                if block_started:
                    if limiter is not None and not limiter.closed:
                        for sse in limiter.flush_remaining():
                            yield sse
                        yield sse_block_end(block_index=block_index)
                    # Если limiter сам закрыл блок (truncate) — block_end
                    # уже отправлен внутри push().
                    block_index += 1

                # Обработка tool calls из стриминга
                finalized_tool_calls = (
                    acc.finalize() if finish_reason == "tool_calls" else []
                )
                if finalized_tool_calls:
                    # arguments через _safe_args: аккумулятор отдаёт ""
                    # для no-args tool_call'ов, что ломает Qwen/SGLang
                    # chat-template на следующем раунде (json.loads("")).
                    tool_calls_for_msg = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": _safe_args(tc.arguments),
                            },
                        }
                        for tc in finalized_tool_calls
                    ]

                    # content="" (не None) — иначе Qwen/SGLang chat-template
                    # рендерит пустой документ (400 "zero-length"), а
                    # GigaChat-proxy отдаёт 422 на null content. OpenAI-spec
                    # null разрешает, но эти провайдеры — нет.
                    assistant_msg = {
                        "role": "assistant",
                        "content": accumulated_content or "",
                        "tool_calls": tool_calls_for_msg,
                    }
                    # MiniMax M2: пробрасываем reasoning_details обратно
                    # в сообщение, чтобы качество tool-call не падало.
                    if acc.reasoning_details:
                        assistant_msg["reasoning_details"] = acc.reasoning_details
                    messages.append(assistant_msg)

                    # GigaChat: ≤1 tool за раунд; лишние — в очередь
                    if is_gigachat and len(finalized_tool_calls) > 1:
                        logger.info(
                            "GigaChat: %d tool_calls из стрима → "
                            "исполняем 1, %d в очередь",
                            len(finalized_tool_calls),
                            len(finalized_tool_calls) - 1,
                        )
                        # Сохраняем в очередь как dict (не pydantic)
                        pending_tool_calls = [
                            {
                                "id": tc.id,
                                "name": tc.name,
                                "arguments": _safe_args(tc.arguments),
                            }
                            for tc in finalized_tool_calls[1:]
                        ]
                    tcs_this_round = (
                        finalized_tool_calls[:1]
                        if is_gigachat
                        else finalized_tool_calls
                    )

                    for tc in tcs_this_round:
                        tool_name = tc.name
                        try:
                            arguments = json.loads(_safe_args(tc.arguments))
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

                        if tool_name == TOOL_FORWARD_TO_KNOWLEDGE_AGENT:
                            # Терминальный tool: переключаемся в стрим из bridge
                            history_messages = await orch._get_history_messages(
                                conversation_id,
                            )
                            # Последнее user-сообщение уже сохранено —
                            # из истории его убираем, форвардим вопрос отдельно.
                            if (
                                history_messages
                                and history_messages[-1].get("role") == "user"
                            ):
                                history_messages = history_messages[:-1]
                            # Forward к внешнему агенту: SSE-стрим идёт
                            # из forward_bridge.handle_forward_call,
                            # сохранение ассистент-сообщения делает фоновый
                            # раннер (agent_bridge_runner) — даже если
                            # клиент закроет соединение посреди ответа.
                            async for kind, payload in handle_forward_call(
                                settings=orch.settings,
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
                            sources.append(tool_name)
                            yield sse_message_end(
                                message_id=message_id,
                                model=orch.settings.model,
                                token_usage=None,
                            )
                            return

                        try:
                            result = await orch._execute_tool_call(
                                tool_name, arguments,
                            )
                            _last_validation_error = None
                            _consecutive_validation_errors = 0
                        except ChatToolValidationError as exc:
                            # Валидация параметров tool'а упала.
                            error_key = (exc.message, tool_name)
                            if _last_validation_error == error_key:
                                _consecutive_validation_errors += 1
                            else:
                                _last_validation_error = error_key
                                _consecutive_validation_errors = 1
                            logger.warning(
                                "Tool validation error: %s (consecutive=%d)",
                                exc.message, _consecutive_validation_errors,
                            )
                            if _consecutive_validation_errors >= 2:
                                logger.warning(
                                    "Tool-loop exit: 2 одинаковых ошибки "
                                    "валидации подряд для tool=%s",
                                    tool_name,
                                )
                                error_answer = (
                                    f"Модель не смогла корректно вызвать "
                                    f"инструмент `{tool_name}`. "
                                    f"Перефразируйте запрос."
                                )
                                yield sse_error(
                                    error=error_answer,
                                    code="tool_validation_loop",
                                )
                                content_blocks = list(emitted_blocks)
                                content_blocks.append({
                                    "type": "error",
                                    "message": error_answer,
                                    "code": "tool_validation_loop",
                                })
                                try:
                                    await orch._save_assistant_message(
                                        conversation_id=conversation_id,
                                        content_blocks=content_blocks,
                                        token_usage=token_usage,
                                        message_id=message_id,
                                    )
                                except Exception:
                                    logger.exception(
                                        "Не удалось сохранить error-block "
                                        "при tool-loop exit",
                                    )
                                yield sse_message_end(
                                    message_id=message_id,
                                    model=orch.settings.model,
                                    token_usage=token_usage if token_usage else None,
                                )
                                return
                            yield sse_tool_error(
                                tool_name=tool_name,
                                tool_call_id=tc.id,
                                message=TOOL_VALIDATION_NEUTRAL_MESSAGE,
                            )
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tc.id,
                                "content": TOOL_VALIDATION_NEUTRAL_MESSAGE,
                            })
                            sources.append(tool_name)
                            continue
                        sources.append(tool_name)

                        yield sse_tool_result(
                            tool_name=tool_name,
                            tool_call_id=tc.id,
                            result=result,
                        )

                        client_action = orch._parse_client_action_result(
                            result, message_id=message_id, ca_counter=ca_counter,
                        )
                        blocks_list = (
                            None if client_action is not None
                            else orch._parse_blocks_list_result(
                                result, message_id=message_id, ca_counter=ca_counter,
                            )
                        )
                        buttons_block = (
                            None if (client_action is not None or blocks_list is not None)
                            else orch._parse_buttons_result(result)
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
                                    translated = await orch._translate_buttons(
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
                                if btype in ("text", "code"):
                                    for sse in emit_text_block_with_limit(
                                        block_index=block_index,
                                        block_type=btype,
                                        text=raw_block.get("content", ""),
                                        chunk_flush_bytes=(
                                            orch.settings.delta_chunk_flush_bytes
                                        ),
                                        block_max_bytes=(
                                            orch.settings.delta_block_max_bytes
                                        ),
                                    ):
                                        yield sse
                                    emitted_blocks.append(raw_block)
                                else:
                                    yield sse_block_complete(
                                        block_index=block_index,
                                        block=raw_block,
                                    )
                                    emitted_blocks.append(raw_block)
                                block_index += 1
                            tool_result_for_llm = (
                                f"<выполнено: {tool_name}>"
                            )
                        elif buttons_block is not None:
                            # Группа кнопок — отдельный SSE-канал
                            translated = await orch._translate_buttons(
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
            response, _fb_used, client = await orch._llm_call_with_fallback(
                client,
                model=orch.settings.model,
                messages=messages,
                tools=tools if tools else NOT_GIVEN,
                temperature=orch.settings.temperature,
                force_non_streaming=True,
            )
            if _fb_used and orch._fallback_is_gigachat():
                is_gigachat = True

            if response.choices[0].message.tool_calls:
                raw_msg = response.choices[0].message
                # Не передаём Pydantic-объект как есть: его сериализация
                # с content=None ломает Qwen/SGLang (400) и GigaChat-proxy
                # (422). Собираем dict с гарантированно строковым content и
                # arguments через _safe_args (no-args → "{}").
                assistant_msg = {
                    "role": "assistant",
                    "content": raw_msg.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": _safe_args(tc.function.arguments),
                            },
                        }
                        for tc in raw_msg.tool_calls
                    ],
                }
                messages.append(assistant_msg)

                # GigaChat: ≤1 tool за раунд; лишние — в очередь
                if is_gigachat and len(raw_msg.tool_calls) > 1:
                    logger.info(
                        "GigaChat: %d tool_calls (non-stream) → "
                        "исполняем 1, %d в очередь",
                        len(raw_msg.tool_calls),
                        len(raw_msg.tool_calls) - 1,
                    )
                    pending_tool_calls = list(raw_msg.tool_calls[1:])
                tcs_this_round = (
                    raw_msg.tool_calls[:1]
                    if is_gigachat
                    else raw_msg.tool_calls
                )

                for tc in tcs_this_round:
                    tool_name = tc.function.name
                    try:
                        arguments = json.loads(_safe_args(tc.function.arguments))
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

                    if tool_name == TOOL_FORWARD_TO_KNOWLEDGE_AGENT:
                        # Терминальный tool: переключаемся в стрим из bridge
                        history_messages = await orch._get_history_messages(
                            conversation_id,
                        )
                        if (
                            history_messages
                            and history_messages[-1].get("role") == "user"
                        ):
                            history_messages = history_messages[:-1]
                        # Forward к внешнему агенту: SSE-стрим идёт
                        # из forward_bridge.handle_forward_call,
                        # сохранение ассистент-сообщения делает фоновый
                        # раннер (agent_bridge_runner) — даже если
                        # клиент закроет соединение посреди ответа.
                        async for kind, payload in handle_forward_call(
                            settings=orch.settings,
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
                        sources.append(tool_name)
                        yield sse_message_end(
                            message_id=message_id,
                            model=orch.settings.model,
                            token_usage=None,
                        )
                        return

                    try:
                        result = await orch._execute_tool_call(
                            tool_name, arguments,
                        )
                        _last_validation_error = None
                        _consecutive_validation_errors = 0
                    except ChatToolValidationError as exc:
                        error_key = (exc.message, tool_name)
                        if _last_validation_error == error_key:
                            _consecutive_validation_errors += 1
                        else:
                            _last_validation_error = error_key
                            _consecutive_validation_errors = 1
                        logger.warning(
                            "Tool validation error: %s (consecutive=%d)",
                            exc.message, _consecutive_validation_errors,
                        )
                        if _consecutive_validation_errors >= 2:
                            logger.warning(
                                "Tool-loop exit: 2 одинаковых ошибки "
                                "валидации подряд для tool=%s",
                                tool_name,
                            )
                            error_answer = (
                                f"Модель не смогла корректно вызвать "
                                f"инструмент `{tool_name}`. "
                                f"Перефразируйте запрос."
                            )
                            yield sse_error(
                                error=error_answer,
                                code="tool_validation_loop",
                            )
                            content_blocks = list(emitted_blocks)
                            content_blocks.append({
                                "type": "error",
                                "message": error_answer,
                                "code": "tool_validation_loop",
                            })
                            try:
                                await orch._save_assistant_message(
                                    conversation_id=conversation_id,
                                    content_blocks=content_blocks,
                                    token_usage=token_usage,
                                    message_id=message_id,
                                )
                            except Exception:
                                logger.exception(
                                    "Не удалось сохранить error-block "
                                    "при tool-loop exit",
                                )
                            yield sse_message_end(
                                message_id=message_id,
                                model=orch.settings.model,
                                token_usage=token_usage if token_usage else None,
                            )
                            return
                        yield sse_tool_error(
                            tool_name=tool_name,
                            tool_call_id=tc.id,
                            message=TOOL_VALIDATION_NEUTRAL_MESSAGE,
                        )
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": TOOL_VALIDATION_NEUTRAL_MESSAGE,
                        })
                        sources.append(tool_name)
                        continue
                    sources.append(tool_name)

                    yield sse_tool_result(
                        tool_name=tool_name,
                        tool_call_id=tc.id,
                        result=result,
                    )

                    client_action = orch._parse_client_action_result(
                        result, message_id=message_id, ca_counter=ca_counter,
                    )
                    blocks_list = (
                        None if client_action is not None
                        else orch._parse_blocks_list_result(
                            result, message_id=message_id, ca_counter=ca_counter,
                        )
                    )
                    buttons_block = (
                        None if (client_action is not None or blocks_list is not None)
                        else orch._parse_buttons_result(result)
                    )
                    if client_action is not None:
                        # client_action идёт собственным SSE-каналом
                        # (sse_client_action). block_index НЕ инкрементим:
                        # это не блок контента в потоке, а одноразовая
                        # команда фронту — он исполнит её один раз и
                        # сохранит как чип в истории при пере-загрузке.
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
                                translated = await orch._translate_buttons(
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
                            if btype in ("text", "code"):
                                for sse in emit_text_block_with_limit(
                                    block_index=block_index,
                                    block_type=btype,
                                    text=raw_block.get("content", ""),
                                    chunk_flush_bytes=(
                                        orch.settings.delta_chunk_flush_bytes
                                    ),
                                    block_max_bytes=(
                                        orch.settings.delta_block_max_bytes
                                    ),
                                ):
                                    yield sse
                                emitted_blocks.append(raw_block)
                            else:
                                yield sse_block_complete(
                                    block_index=block_index,
                                    block=raw_block,
                                )
                                emitted_blocks.append(raw_block)
                            block_index += 1
                        tool_result_for_llm = (
                            f"<выполнено: {tool_name}>"
                        )
                    elif buttons_block is not None:
                        translated = await orch._translate_buttons(
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
            for sse in emit_text_block_with_limit(
                block_index=block_index,
                block_type="text",
                text=answer,
                chunk_flush_bytes=orch.settings.delta_chunk_flush_bytes,
                block_max_bytes=orch.settings.delta_block_max_bytes,
            ):
                yield sse
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
                await orch._save_assistant_message(
                    conversation_id=conversation_id,
                    content_blocks=content_blocks,
                    token_usage=token_usage,
                    message_id=message_id,
                )
            except (OSError, asyncio.TimeoutError):
                logger.exception("Не удалось сохранить сообщение ассистента")
            except Exception:
                logger.exception("Не удалось сохранить сообщение ассистента")

    except asyncio.TimeoutError:
        logger.warning(
            "LLM timeout",
            extra={
                "stage": "run_stream",
                "model": orch.settings.model,
                "elapsed_sec": time.monotonic() - run_started,
                "conversation_id": conversation_id,
            },
        )
        yield sse_error(error="Временная ошибка AI-сервиса. Попробуйте позже.")
    except Exception:
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
        model=orch.settings.model,
        token_usage=token_usage if token_usage else None,
    )
