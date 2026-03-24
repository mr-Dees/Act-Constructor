"""
Эндпоинт чата с AI-ассистентом.

Реализует agent loop с OpenAI-совместимым function-calling:
1. Собирает ChatTool из всех доменов
2. Отправляет сообщение + tools LLM
3. Если LLM вызвал tool → выполняет → возвращает результат → повторяет
4. Возвращает финальный текстовый ответ
"""

import asyncio
import json
import logging
from datetime import date
from functools import lru_cache

from fastapi import APIRouter, Depends

from app.api.v1.deps.auth_deps import get_username
from app.core.chat_tools import get_all_tools, get_openai_tools, get_tool, get_tools_by_domain
from app.core.config import get_settings
from app.schemas.chat import ChatRequest, ChatResponse

logger = logging.getLogger("act_constructor.chat")

router = APIRouter()


@lru_cache(maxsize=1)
def _get_openai_client(api_base: str, api_key: str):
    """Singleton AsyncOpenAI клиент (кэшируется по параметрам подключения)."""
    from openai import AsyncOpenAI
    return AsyncOpenAI(base_url=api_base, api_key=api_key)


def _convert_param(value, param_type: str):
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


async def _execute_tool_call(tool_name: str, arguments: dict) -> str:
    """Выполняет один вызов ChatTool и возвращает результат."""
    chat_tool = get_tool(tool_name)
    if chat_tool is None:
        return f"Ошибка: инструмент '{tool_name}' не найден"
    if chat_tool.handler is None:
        return f"Ошибка: инструмент '{tool_name}' не имеет обработчика"

    # Конвертация типов параметров (неизвестные аргументы отбрасываются)
    param_types = {p.name: p.type for p in chat_tool.parameters}
    converted_args = {}
    for key, value in arguments.items():
        if key in param_types:
            converted_args[key] = _convert_param(value, param_types[key])

    try:
        settings = get_settings()
        timeout = settings.chat.tool_execution_timeout
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


@router.post("/message", response_model=ChatResponse)
async def send_message(
    request: ChatRequest,
    username: str = Depends(get_username),
):
    """
    Отправить сообщение AI-ассистенту.

    Если настроен OpenAI-совместимый API (CHAT__API_BASE, CHAT__API_KEY),
    выполняет agent loop с function-calling. Иначе — fallback-заглушка.
    """
    settings = get_settings()
    logger.info("Сообщение чата от %s: %s", username, request.message[:100])

    # Валидация context по лимитам из конфига
    if request.context:
        max_keys = settings.chat.max_context_keys
        max_val_len = settings.chat.max_context_value_length
        if len(request.context) > max_keys:
            request.context = dict(list(request.context.items())[:max_keys])
        # Санитизация ключей и значений: убираем угловые скобки для защиты от XML breakout
        def _sanitize(s: str, max_len: int) -> str:
            return s.replace("<", "").replace(">", "").replace("\n", " ")[:max_len]

        request.context = {
            _sanitize(str(k), 100): _sanitize(str(v), max_val_len)
            for k, v in request.context.items()
        }

    # Валидация history по лимитам из конфига
    if len(request.history) > settings.chat.max_history_length:
        request.history = request.history[-settings.chat.max_history_length:]

    # Fallback: если API не настроен
    if not settings.chat.api_base or not settings.chat.api_key.get_secret_value():
        return _fallback_response(request)

    try:
        from openai import NOT_GIVEN
    except ImportError:
        logger.warning("Пакет openai не установлен, используется заглушка")
        return _fallback_response(request)

    client = _get_openai_client(settings.chat.api_base, settings.chat.api_key.get_secret_value())

    # Сбор tools: фильтрация по доменам или все
    if request.domains:
        tools_list = []
        for domain in request.domains:
            tools_list.extend(get_tools_by_domain(domain))
        tools = [t.to_openai_tool() for t in tools_list]
    else:
        tools = get_openai_tools()

    # Собираем доменные дескрипторы для system prompt
    domain_descriptors = []
    if request.domains:
        from app.core.domain_registry import get_domain
        for domain_name in request.domains:
            d = get_domain(domain_name)
            if d:
                domain_descriptors.append(d)

    # Построение messages
    messages = _build_messages(settings, request, domain_descriptors)

    sources: list[str] = []

    try:
        response = await client.chat.completions.create(
            model=settings.chat.model,
            messages=messages,
            tools=tools if tools else NOT_GIVEN,
            temperature=settings.chat.temperature,
        )

        # Agent loop: выполнение tool calls
        rounds = 0
        while (
            response.choices[0].message.tool_calls
            and rounds < settings.chat.max_tool_rounds
        ):
            rounds += 1
            assistant_msg = response.choices[0].message

            # Добавляем assistant message с tool_calls
            messages.append(assistant_msg)

            # Выполняем каждый tool call
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
                result = await _execute_tool_call(tool_name, arguments)
                sources.append(tool_name)

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })

            # Следующий вызов LLM
            response = await client.chat.completions.create(
                model=settings.chat.model,
                messages=messages,
                tools=tools if tools else NOT_GIVEN,
                temperature=settings.chat.temperature,
            )

        answer = response.choices[0].message.content or ""
        return ChatResponse(
            response=answer,
            sources=list(dict.fromkeys(sources)),  # уникальные, в порядке вызова
        )

    except Exception as exc:
        logger.exception("Ошибка вызова LLM API")
        return ChatResponse(
            response="Временная ошибка AI-сервиса. Попробуйте позже.",
            status="error",
        )


def _build_messages(
    settings,
    request: ChatRequest,
    domain_descriptors: list | None = None,
) -> list[dict]:
    """Формирует список messages для OpenAI API."""
    # TODO: использовать request.knowledge_bases для расширения system prompt
    # (например, подключение RAG-контекста из выбранных баз знаний)
    base_prompt = settings.chat.system_prompt
    if domain_descriptors:
        domain_prompts = [
            d.chat_system_prompt
            for d in domain_descriptors
            if d.chat_system_prompt
        ]
        if domain_prompts:
            base_prompt = base_prompt + "\n\n" + "\n\n".join(domain_prompts)

    messages: list[dict] = [
        {"role": "system", "content": base_prompt},
    ]

    # История диалога
    for msg in request.history:
        messages.append({"role": msg.role, "content": msg.content})

    # Текущее сообщение пользователя
    user_content = request.message
    if request.act_id is not None:
        user_content += f"\n\n[Контекст: акт #{request.act_id}]"
    if request.context:
        context_parts = [f"  {k}: {v}" for k, v in request.context.items()]
        user_content += f"\n<user-context>\n{chr(10).join(context_parts)}\n</user-context>"

    messages.append({"role": "user", "content": user_content})
    return messages


def _fallback_response(request: ChatRequest) -> ChatResponse:
    """Заглушка при отсутствии настроек LLM API."""
    tools = get_all_tools()
    response_text = f'Вы написали: "{request.message}"'

    if request.act_id is not None:
        response_text += f"\n\nКонтекст: акт #{request.act_id}"

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

    return ChatResponse(response=response_text)
