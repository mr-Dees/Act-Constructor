"""Non-streaming agent loop оркестратора.

Логика жила в ``Orchestrator.run`` (~320 строк). Вынесена сюда отдельной
pure-функцией, принимающей ссылку на ``Orchestrator``: все зависимости
(LLM-вызов, tool executor, save_assistant_message, parse_*, build_*) —
методы класса, которые тесты могут патчить через ``patch.object`` / instance
assign. Pure-функция зовёт их через ``orch.``, поэтому существующие mock'и
продолжают работать.

В ``Orchestrator.run`` остаётся тонкий wrapper, который устанавливает
context-атрибуты (``_current_conversation_id`` / ``_current_user_id``) и
делегирует сюда.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING, Any

from app.domains.chat.exceptions import ChatToolValidationError
from app.domains.chat.services.orchestrator_helpers import (
    TOOL_VALIDATION_NEUTRAL_MESSAGE,
    safe_args as _safe_args,
)

if TYPE_CHECKING:
    from app.domains.chat.services.orchestrator import Orchestrator

logger = logging.getLogger("audit_workstation.domains.chat.agent_loop")


async def run_agent_loop(
    orch: "Orchestrator",
    *,
    conversation_id: str,
    user_message: str,
    message_id: str,
    domains: list[str] | None = None,
    file_blocks: list[dict] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Полный (не стриминговый) agent loop.

    Возвращает dict с полями: response, sources, model, token_usage.
    На ошибку — dict с ``status="error"``.

    ``message_id`` обязателен и должен быть тем же id, что попадёт в БД
    через ``_save_assistant_message``: на нём строится детерминированный
    ``block_id`` ClientActionBlock (``f"{message_id}:ca:{i}"``).
    """
    # Fallback при отсутствии настроек API
    if (
        not orch.settings.api_base
        or not orch.settings.api_key.get_secret_value()
    ):
        return orch._fallback_response(user_message)

    try:
        from openai import NOT_GIVEN
    except ImportError:
        logger.warning("Пакет openai не установлен, используется заглушка")
        return orch._fallback_response(user_message)

    client = orch._get_openai_client()
    tools = orch._get_tools(domains)

    # Собираем messages: system + history + текущее сообщение
    messages = orch._build_system_messages(domains)
    history = await orch._get_history_messages(conversation_id)
    # Убираем последнее сообщение из истории — оно уже сохранено как user message,
    # но мы добавим его явно ниже
    if history and history[-1].get("role") == "user":
        history = history[:-1]
    messages.extend(history)

    user_content = await orch._build_user_content(
        user_message, file_blocks, conversation_id,
    )
    messages.append({"role": "user", "content": user_content})

    sources: list[str] = []
    token_usage: dict[str, Any] = {}
    # GigaChat поддерживает только 1 function_call за раунд. Если LLM
    # вернул >1 tool_call, первый исполняем сейчас, остальные — в очередь.
    pending_tool_calls: list[Any] = []
    is_gigachat = orch.settings.profile == "gigachat"
    # Отслеживание повторяющихся ошибок валидации tool'ов.
    # Формат: (error_message_key, tool_name)
    _last_validation_error: tuple[str, str] | None = None
    _consecutive_validation_errors = 0
    # Счётчик client_action-блоков для построения детерминированного
    # block_id (см. _parse_client_action_result). message_id передан
    # вызывающим — тот же id будет использован в _save_assistant_message.
    ca_counter: list[int] = [0]  # noqa: F841 (не используется в non-streaming, но симметрия с stream_loop)

    try:
        response, _fb_used, client = await orch._llm_call_with_fallback(
            client,
            model=orch.settings.model,
            messages=messages,
            tools=tools if tools else NOT_GIVEN,
            temperature=orch.settings.temperature,
        )
        if _fb_used and orch._fallback_is_gigachat():
            # После переключения на GigaChat — соблюдаем его ограничения
            is_gigachat = True

        # Agent loop
        rounds = 0
        while rounds < orch.settings.max_tool_rounds:
            # Если очередь GigaChat не пуста — берём следующий tool без LLM
            if pending_tool_calls:
                tc = pending_tool_calls.pop(0)
                tool_name = tc.function.name
                try:
                    arguments = json.loads(_safe_args(tc.function.arguments))
                except json.JSONDecodeError:
                    arguments = {}
                logger.info(
                    "GigaChat queue tool call #%d: %s(%s)", rounds, tool_name,
                    ", ".join(f"{k}={v!r}" for k, v in arguments.items()),
                )
                try:
                    result = await orch._execute_tool_call(
                        tool_name, arguments,
                    )
                except ChatToolValidationError as exc:
                    logger.warning("Tool validation error: %s", exc.message)
                    result = TOOL_VALIDATION_NEUTRAL_MESSAGE
                sources.append(tool_name)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })
                rounds += 1
                if pending_tool_calls:
                    continue
                # Очередь опустела — вызываем LLM с обновлённой историей
                response, _fb_used, client = await orch._llm_call_with_fallback(
                    client,
                    model=orch.settings.model,
                    messages=messages,
                    tools=tools if tools else NOT_GIVEN,
                    temperature=orch.settings.temperature,
                )
                if _fb_used and orch._fallback_is_gigachat():
                    is_gigachat = True
                # Переходим к началу цикла: проверяем новый ответ LLM
                continue

            if not response.choices[0].message.tool_calls:
                break

            raw_msg = response.choices[0].message
            # Не передаём Pydantic-объект как есть: см. комментарий в
            # run_stream — Qwen/SGLang и GigaChat-proxy не принимают
            # null content при наличии tool_calls. По той же причине
            # arguments санитизируется через _safe_args (пустая строка
            # → "{}", иначе провайдеры ломают чат-template).
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
                    "GigaChat: %d tool_calls → исполняем 1, %d в очередь",
                    len(raw_msg.tool_calls), len(raw_msg.tool_calls) - 1,
                )
                pending_tool_calls = list(raw_msg.tool_calls[1:])
            tcs_this_round = (
                raw_msg.tool_calls[:1] if is_gigachat else raw_msg.tool_calls
            )

            for tc in tcs_this_round:
                tool_name = tc.function.name
                try:
                    arguments = json.loads(_safe_args(tc.function.arguments))
                except json.JSONDecodeError:
                    arguments = {}

                logger.info(
                    "Tool call #%d: %s(%s)", rounds, tool_name,
                    ", ".join(f"{k}={v!r}" for k, v in arguments.items()),
                )
                try:
                    result = await orch._execute_tool_call(
                        tool_name, arguments,
                    )
                    _last_validation_error = None
                    _consecutive_validation_errors = 0
                except ChatToolValidationError as exc:
                    # Отслеживаем повторяющиеся ошибки валидации.
                    # Ключ: сообщение ошибки + имя tool (охватывает
                    # класс ошибки + имя параметра + имя инструмента).
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
                            "Tool-loop exit: 2 одинаковых ошибки валидации "
                            "подряд для tool=%s, прерываем цикл",
                            tool_name,
                        )
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": TOOL_VALIDATION_NEUTRAL_MESSAGE,
                        })
                        sources.append(tool_name)
                        # Финальный ответ — error block
                        error_answer = (
                            f"Модель не смогла корректно вызвать инструмент "
                            f"`{tool_name}`. Перефразируйте запрос."
                        )
                        await orch._save_assistant_message(
                            conversation_id=conversation_id,
                            content_blocks=[{
                                "type": "error",
                                "message": error_answer,
                                "code": "tool_validation_loop",
                            }],
                            token_usage=None,
                            message_id=message_id,
                        )
                        return {
                            "response": error_answer,
                            "sources": list(dict.fromkeys(sources)),
                            "model": orch.settings.model,
                            "token_usage": token_usage,
                        }
                    result = TOOL_VALIDATION_NEUTRAL_MESSAGE
                sources.append(tool_name)

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })

            rounds += 1
            # Если в очереди GigaChat ещё есть tool_call'ы — не зовём LLM,
            # переходим к следующей итерации, где очередь будет обработана.
            if pending_tool_calls:
                continue
            response, _fb_used, client = await orch._llm_call_with_fallback(
                client,
                model=orch.settings.model,
                messages=messages,
                tools=tools if tools else NOT_GIVEN,
                temperature=orch.settings.temperature,
            )
            if _fb_used and orch._fallback_is_gigachat():
                is_gigachat = True

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
        await orch._save_assistant_message(
            conversation_id=conversation_id,
            content_blocks=content_blocks,
            token_usage=token_usage if token_usage else None,
            message_id=message_id,
        )

        return {
            "response": answer,
            "sources": list(dict.fromkeys(sources)),
            "model": orch.settings.model,
            "token_usage": token_usage,
        }

    except asyncio.TimeoutError:
        logger.warning(
            "LLM timeout",
            extra={
                "stage": "run",
                "model": orch.settings.model,
                "conversation_id": conversation_id,
            },
        )
        error_message = "Временная ошибка AI-сервиса. Попробуйте позже."
        try:
            await orch._save_assistant_message(
                conversation_id=conversation_id,
                content_blocks=[{
                    "type": "error",
                    "message": error_message,
                    "code": "llm_unavailable",
                }],
                token_usage=None,
                message_id=message_id,
            )
        except Exception:
            logger.exception(
                "Не удалось сохранить error-block ассистент-сообщения",
            )
        return {"response": error_message, "status": "error"}
    except Exception:
        logger.exception("Ошибка вызова LLM API")
        # Сохраняем ErrorBlock в историю: без этого при перезагрузке
        # страницы пользователь не увидит, что произошло — будет только
        # его user-message без ответа. Сырые детали (stack/код провайдера)
        # наружу не пробрасываем — только нейтральное сообщение.
        error_message = "Временная ошибка AI-сервиса. Попробуйте позже."
        try:
            await orch._save_assistant_message(
                conversation_id=conversation_id,
                content_blocks=[{
                    "type": "error",
                    "message": error_message,
                    "code": "llm_unavailable",
                }],
                token_usage=None,
                message_id=message_id,
            )
        except Exception:
            # save может упасть, если БД тоже недоступна — это не фатально,
            # ответ всё равно вернём.
            logger.exception(
                "Не удалось сохранить error-block ассистент-сообщения",
            )
        return {
            "response": error_message,
            "status": "error",
        }
