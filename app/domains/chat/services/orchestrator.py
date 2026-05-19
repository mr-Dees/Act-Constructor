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
from typing import Any

from app.core.chat.names import TOOL_FORWARD_TO_KNOWLEDGE_AGENT
from app.core.chat.tools import (
    get_openai_tools,
    get_tool,
    get_tools_by_domain,
)
from app.core.settings_registry import get as get_domain_settings
from app.domains.chat.exceptions import ChatToolValidationError
from app.domains.chat.services.circuit_breaker import get_breaker
from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.forward_bridge import handle_forward_call
from app.domains.chat.services.llm_client import (
    build_fallback_client,
    build_llm_client,
)
from app.domains.chat.services.message_service import MessageService
from app.domains.chat.services.orchestrator_helpers import (
    BASE_SYSTEM_PROMPT,
    TOOL_VALIDATION_NEUTRAL_MESSAGE,
    convert_param as _convert_param,
    safe_args as _safe_args,
)
from app.domains.chat.services.retry import retry_on_transient
from app.domains.chat.services.streaming import (
    BlockDeltaLimiter,
    emit_text_block_with_limit,
    sse_agent_request_started,
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
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.orchestrator")


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
        # Контекст для метрик: устанавливается в run/run_stream перед
        # agent loop и читается в _execute_tool_call. Так избегаем менять
        # сигнатуру _execute_tool_call и передачу параметров через все
        # 5 callsite'ов внутри agent loop.
        self._current_conversation_id: str | None = None
        self._current_user_id: str | None = None

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

    @staticmethod
    def _format_block_full(block: dict) -> str | None:
        """Конвертирует блок контента в текст (полный режим)."""
        block_type = block.get("type", "")
        if block_type == "text":
            return block.get("content", "") or None
        if block_type == "code":
            lang = block.get("language", "")
            return f"```{lang}\n{block.get('content', '')}\n```"
        if block_type == "file":
            fname = block.get("filename", "файл")
            size = block.get("size")
            if size:
                try:
                    size_mb = int(size) / (1024 * 1024)
                    size_str = f"{size_mb:.1f} МБ"
                except (TypeError, ValueError):
                    size_str = str(size)
            else:
                size_str = ""
            return f"[Прикреплён файл: {fname}" + (f", {size_str}" if size_str else "") + "]"
        if block_type == "image":
            fname = block.get("filename", "изображение")
            return f"[Прикреплено изображение: {fname}]"
        return None

    @staticmethod
    def _format_block_shallow(block: dict) -> str | None:
        """Конвертирует блок контента в текст (shallow режим — без бинарных данных).

        file/image блоки заменяются на placeholder без base64/бинарного контента.
        """
        block_type = block.get("type", "")
        if block_type == "text":
            return block.get("content", "") or None
        if block_type == "code":
            lang = block.get("language", "")
            return f"```{lang}\n{block.get('content', '')}\n```"
        if block_type in ("file", "image"):
            fname = block.get("filename", "файл" if block_type == "file" else "изображение")
            size = block.get("size")
            if size:
                try:
                    size_mb = int(size) / (1024 * 1024)
                    size_str = f"{size_mb:.1f} МБ"
                except (TypeError, ValueError):
                    size_str = str(size)
            else:
                size_str = ""
            label = "файл" if block_type == "file" else "изображение"
            parts = [fname]
            if size_str:
                parts.append(size_str)
            parts.append("не загружен в этом ходу")
            return f"[{label}: {', '.join(parts)}]"
        return None

    async def _get_history_messages(
        self, conversation_id: str,
    ) -> list[dict[str, str]]:
        """
        Загружает историю из БД и конвертирует в формат OpenAI messages.

        Извлекает текст из блоков контента:
        - text → текст
        - code → markdown fenced code block
        - file/image → placeholder (только для сообщений вне ``history_full_context_depth``)

        Блоки reasoning и error сохранены в истории только для отображения
        в UI; в контекст модели они не попадают (чтобы не засорять контекст
        служебной информацией).

        Lazy-loading: последние ``history_full_context_depth`` сообщений
        передаются с полным контентом; более старые — с placeholder'ами
        вместо file/image-блоков, чтобы не расходовать RAM на base64.
        """
        history = await self.msg_service.get_history(conversation_id)

        # Ограничиваем историю по настройкам
        if len(history) > self.settings.max_history_length:
            history = history[-self.settings.max_history_length:]

        depth = self.settings.history_full_context_depth
        cutoff = max(0, len(history) - depth)

        messages: list[dict[str, str]] = []

        for idx, msg in enumerate(history):
            role = msg.get("role", "user")
            content_blocks = msg.get("content", [])
            full_mode = idx >= cutoff  # True — полный контент, False — shallow

            # Собираем текст из блоков
            text_parts: list[str] = []
            if isinstance(content_blocks, list):
                for block in content_blocks:
                    if not isinstance(block, dict):
                        continue
                    if full_mode:
                        part = self._format_block_full(block)
                    else:
                        part = self._format_block_shallow(block)
                    if part:
                        text_parts.append(part)
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
        from app.domains.chat.services.file_extraction import extract_text_async

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
                text = await extract_text_async(
                    row["file_data"], row["mime_type"], row["filename"],
                )
                parts.append(f"\n--- Файл: {row['filename']} ---\n{text}")

        return "\n".join(parts)

    def _get_openai_client(self):
        """Возвращает AsyncOpenAI клиент согласно профильным настройкам."""
        return build_llm_client(self.settings)

    def _get_fallback_client(self):
        """Возвращает fallback-клиент или None, если fallback не настроен."""
        return build_fallback_client(self.settings)

    def _has_fallback(self) -> bool:
        """True если все необходимые fallback-настройки заданы."""
        return (
            self.settings.fallback_profile is not None
            and bool(self.settings.fallback_api_base)
            and self.settings.fallback_api_key is not None
            and bool(self.settings.fallback_api_key.get_secret_value())
        )

    def _fallback_is_gigachat(self) -> bool:
        """True если fallback-профиль — gigachat (нельзя streaming)."""
        return self.settings.fallback_profile == "gigachat"

    @staticmethod
    def _is_provider_failure(exc: BaseException) -> bool:
        """Считается ли исключение сбоем primary-провайдера.

        Условия (true → инкремент circuit breaker, может тригерить fallback):
          - openai.APIConnectionError / APITimeoutError (транспорт)
          - asyncio.TimeoutError (наш request_timeout)
          - openai.APIStatusError со status_code >= 500

        4xx (auth, rate-limit, validation) — это клиентские ошибки,
        НЕ считаются сбоем провайдера. Логика retry на 429 уже есть
        в retry_on_transient; здесь её дублировать нельзя.
        """
        try:
            from openai import (
                APIConnectionError,
                APIStatusError,
                APITimeoutError,
            )
        except ImportError:  # pragma: no cover
            return False

        if isinstance(exc, APITimeoutError):
            return True
        if isinstance(exc, APIConnectionError):
            return True
        if isinstance(exc, asyncio.TimeoutError):
            return True
        if isinstance(exc, APIStatusError):
            code = getattr(exc, "status_code", None)
            return code is not None and 500 <= code < 600
        return False

    def _get_circuit_breaker(self):
        """Возвращает singleton-breaker с актуальной конфигурацией."""
        return get_breaker(
            failure_threshold=self.settings.circuit_breaker_failure_threshold,
            recovery_timeout_sec=(
                self.settings.circuit_breaker_recovery_timeout_sec
            ),
        )

    async def _llm_call_with_fallback(
        self,
        client,
        *,
        force_non_streaming: bool = False,
        **kwargs,
    ) -> tuple[Any, bool, Any]:
        """Вызывает LLM с поддержкой fallback при сбое primary.

        Возвращает кортеж ``(result, fallback_used, active_client)``, где
        ``active_client`` — клиент, через который реально прошёл вызов
        (primary либо fallback). При успешном primary fallback_used=False.

        Логика:
          1. Если circuit-breaker open (и fallback есть) — сразу fallback.
          2. Иначе пробуем primary. На provider-failure инкрементим
             счётчик breaker'а; если fallback настроен — пробуем fallback.
             4xx (auth/validation/etc.) пробрасываем без fallback.
          3. На успехе primary — record_success.

        ``force_non_streaming`` — если True и fallback=gigachat, перед
        вызовом fallback'а удаляется stream=True из kwargs.
        """
        breaker = self._get_circuit_breaker()
        has_fallback = self._has_fallback()

        # Если circuit разомкнут — primary даже не дёргаем (fast-path)
        if has_fallback and await breaker.is_open():
            fb_client = self._get_fallback_client()
            if fb_client is not None:
                fb_kwargs = self._adjust_kwargs_for_fallback(
                    kwargs, force_non_streaming=force_non_streaming,
                )
                logger.warning(
                    "Circuit breaker open — вызов идёт через fallback "
                    "(profile=%s)",
                    self.settings.fallback_profile,
                )
                result = await self._completions_create(
                    fb_client, **fb_kwargs,
                )
                return result, True, fb_client

        try:
            result = await self._completions_create(client, **kwargs)
        except Exception as exc:
            if not self._is_provider_failure(exc):
                # Клиентская ошибка / NotFound / 4xx — fallback не помогает
                raise
            await breaker.record_failure(exc)
            if not has_fallback:
                raise
            fb_client = self._get_fallback_client()
            if fb_client is None:
                raise
            fb_kwargs = self._adjust_kwargs_for_fallback(
                kwargs, force_non_streaming=force_non_streaming,
            )
            logger.warning(
                "Primary LLM упал (%s); fallback на profile=%s",
                type(exc).__name__, self.settings.fallback_profile,
            )
            result = await self._completions_create(fb_client, **fb_kwargs)
            return result, True, fb_client

        await breaker.record_success()
        return result, False, client

    def _adjust_kwargs_for_fallback(
        self, kwargs: dict, *, force_non_streaming: bool,
    ) -> dict:
        """Перестраивает kwargs LLM-вызова под fallback-провайдера.

        Подменяет model на fallback_model (если задан). Если fallback —
        GigaChat и ``force_non_streaming`` True (или kwargs содержит
        stream=True) — выключает streaming, иначе GigaChat-proxy отдаст
        422 EventException.
        """
        out = dict(kwargs)
        if self.settings.fallback_model:
            out["model"] = self.settings.fallback_model
        if self._fallback_is_gigachat():
            if force_non_streaming or out.get("stream"):
                out.pop("stream", None)
        return out

    async def _save_assistant_message(
        self,
        *,
        conversation_id: str,
        content_blocks: list[dict],
        token_usage: dict | None,
        message_id: str,
    ) -> None:
        """Сохраняет сообщение ассистента с отдельным соединением из пула.

        StreamingResponse может пережить dependency-соединение,
        поэтому для сохранения берём свежее соединение.

        ``message_id`` обязан совпадать с id, который оркестратор использовал
        в ``_parse_client_action_result`` для построения детерминированного
        ``block_id``. Иначе после reload фронт увидит «новый» message id и
        повторно исполнит уже отработанные client_action-блоки.
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
                message_id=message_id,
            )

    def _parse_client_action_result(
        self,
        raw: str,
        *,
        message_id: str,
        ca_counter: list[int],
    ) -> dict | None:
        """Если result tool'а — JSON-блок client_action, возвращает dict.

        Иначе возвращает None (это обычный текстовый результат tool'а).

        ``block_id`` всегда переписывается на детерминированный
        ``f"{message_id}:ca:{index}"`` (даже если handler выставил свой uuid):
        это гарантирует, что при перезагрузке вкладки и реплее истории
        фронт получит ТОТ ЖЕ id и пропустит повторное исполнение через
        ``sessionStorage['chat:executedActions']``. ``ca_counter`` — список-
        обёртка из одного int (для shared-state между вызовами в рамках
        одного ассистент-сообщения).
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
        idx = ca_counter[0]
        ca_counter[0] = idx + 1
        obj["block_id"] = f"{message_id}:ca:{idx}"
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

    def _parse_blocks_list_result(
        self,
        raw: str,
        *,
        message_id: str,
        ca_counter: list[int],
    ) -> list[dict] | None:
        """Если result tool'а — JSON-список блоков, возвращает список dict.

        Иначе None.

        Для каждого client_action внутри списка ``block_id`` переписывается
        детерминированно как ``f"{message_id}:ca:{index}"`` (см. doc-string
        :meth:`_parse_client_action_result`).
        """
        try:
            obj = json.loads(raw)
        except (ValueError, TypeError):
            return None
        if not isinstance(obj, list):
            return None
        if not all(isinstance(b, dict) and "type" in b for b in obj):
            return None
        for b in obj:
            if b.get("type") == "client_action":
                idx = ca_counter[0]
                ca_counter[0] = idx + 1
                b["block_id"] = f"{message_id}:ca:{idx}"
        return obj

    async def _translate_buttons(self, buttons: list[dict]) -> list[dict]:
        """Транслирует серверные action_id в клиентские действия.

        Делегирует общему хелперу ``button_translator.translate_buttons``,
        чтобы оркестратор, раннер и resume-эндпоинт использовали один и
        тот же код.
        """
        from app.domains.chat.services.button_translator import translate_buttons
        return await translate_buttons(buttons)

    async def _record_tool_metric(
        self,
        *,
        tool_name: str,
        status: str,
        latency_ms: int,
        error_message: str | None = None,
    ) -> None:
        """Пишет одну метрику выполнения tool'а через DI-фабрику.

        Сбой записи метрик НЕ должен ломать tool-loop: исключения
        проглатываются, ошибка логируется warning'ом.
        """
        try:
            # Lazy-import: deps зависит от services, импорт на module-level
            # создал бы цикл и завязал бы orchestrator на DI-инфраструктуру.
            from app.domains.chat.deps import (
                get_tool_metrics_batcher,
                get_tool_metrics_repository,
            )
            from app.domains.chat.repositories.chat_tool_metrics_repository import (
                ChatToolMetricRecord,
            )

            batcher = get_tool_metrics_batcher()
            if batcher is not None:
                await batcher.add(
                    ChatToolMetricRecord(
                        tool_name=tool_name,
                        status=status,
                        latency_ms=int(latency_ms),
                        username=self._current_user_id,
                        conversation_id=self._current_conversation_id,
                        error_message=error_message,
                    )
                )
                return
            # Fallback: батчер не инициализирован (тесты, dev без lifespan).
            agen = get_tool_metrics_repository()
            repo = await agen.__anext__()
            try:
                await repo.record(
                    tool_name=tool_name,
                    status=status,
                    latency_ms=latency_ms,
                    username=self._current_user_id,
                    conversation_id=self._current_conversation_id,
                    error_message=error_message,
                )
            finally:
                # Закрываем async-generator, освобождая соединение в пул.
                try:
                    await agen.aclose()
                except Exception:
                    pass
        except Exception:
            logger.warning(
                "Не удалось записать tool-метрику",
                extra={"tool_name": tool_name},
                exc_info=True,
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

        # Валидация обязательных параметров. Если LLM не передал required-параметр,
        # дальше нельзя — handler упадёт с TypeError или вернёт мусор.
        # Кидаем доменное исключение, его ловит _run_loop и эмитит
        # нейтральный tool_error SSE (без сырого текста для пользователя).
        for param in chat_tool.parameters:
            if param.required and param.name not in arguments:
                err_msg = (
                    f"Tool {tool_name}: отсутствует обязательный "
                    f"параметр {param.name}"
                )
                # Метрика валидации фиксируется до raise (latency=0 — handler
                # ещё не запускался). Это нужно для observability таких
                # случаев в отдельном статусе.
                await self._record_tool_metric(
                    tool_name=tool_name,
                    status="validation_error",
                    latency_ms=0,
                    error_message=err_msg[:1000],
                )
                raise ChatToolValidationError(err_msg)

        # Конвертация типов параметров
        param_types = {p.name: p.type for p in chat_tool.parameters}
        converted_args = {}
        for key, value in arguments.items():
            if key in param_types:
                converted_args[key] = _convert_param(value, param_types[key])

        timeout = self.settings.tool_execution_timeout
        started = time.perf_counter()
        status = "success"
        error_message: str | None = None
        try:
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
            status = "error"
            error_message = f"timeout {timeout}s"
            logger.warning(
                "Таймаут выполнения ChatTool %s (%dс)", tool_name, timeout,
            )
            return f"Ошибка: таймаут выполнения инструмента '{tool_name}'"
        except Exception as exc:
            status = "error"
            error_message = str(exc)[:1000]
            # Никаких деталей exception в выходе LLM: stack trace, имена БД,
            # SQL-фрагменты и пр. могут содержать чувствительные данные.
            # Полный stack логируем под error_id; LLM получает нейтральный
            # текст с этим id для трассировки администратором.
            error_id = str(uuid.uuid4())[:8]
            logger.exception(
                "Ошибка выполнения tool=%s error_id=%s",
                tool_name, error_id,
            )
            return (
                f"Инструмент завершился с ошибкой. error_id={error_id}. "
                "Сообщите администратору."
            )
        finally:
            latency_ms = int((time.perf_counter() - started) * 1000)
            await self._record_tool_metric(
                tool_name=tool_name,
                status=status,
                latency_ms=latency_ms,
                error_message=error_message,
            )

    async def run(
        self,
        *,
        conversation_id: str,
        user_message: str,
        message_id: str,
        domains: list[str] | None = None,
        file_blocks: list[dict] | None = None,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Полный (не стриминговый) agent loop.

        ``message_id`` обязателен и должен быть тем же id, что попадёт в БД
        через ``_save_assistant_message``: на нём строится детерминированный
        ``block_id`` ClientActionBlock (``f"{message_id}:ca:{i}"``).

        Возвращает dict с полями: response, sources, model, token_usage.
        """
        # Фиксируем контекст для метрик; читается из _execute_tool_call.
        self._current_conversation_id = conversation_id
        self._current_user_id = user_id

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
        # GigaChat поддерживает только 1 function_call за раунд. Если LLM
        # вернул >1 tool_call, первый исполняем сейчас, остальные — в очередь.
        pending_tool_calls: list[Any] = []
        is_gigachat = self.settings.profile == "gigachat"
        # Отслеживание повторяющихся ошибок валидации tool'ов.
        # Формат: (error_message_key, tool_name)
        _last_validation_error: tuple[str, str] | None = None
        _consecutive_validation_errors = 0
        # Счётчик client_action-блоков для построения детерминированного
        # block_id (см. _parse_client_action_result). message_id передан
        # вызывающим — тот же id будет использован в _save_assistant_message.
        ca_counter: list[int] = [0]

        try:
            response, _fb_used, client = await self._llm_call_with_fallback(
                client,
                model=self.settings.model,
                messages=messages,
                tools=tools if tools else NOT_GIVEN,
                temperature=self.settings.temperature,
            )
            if _fb_used and self._fallback_is_gigachat():
                # После переключения на GigaChat — соблюдаем его ограничения
                is_gigachat = True

            # Agent loop
            rounds = 0
            while rounds < self.settings.max_tool_rounds:
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
                        result = await self._execute_tool_call(tool_name, arguments)
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
                    response, _fb_used, client = await self._llm_call_with_fallback(
                        client,
                        model=self.settings.model,
                        messages=messages,
                        tools=tools if tools else NOT_GIVEN,
                        temperature=self.settings.temperature,
                    )
                    if _fb_used and self._fallback_is_gigachat():
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
                tcs_this_round = raw_msg.tool_calls[:1] if is_gigachat else raw_msg.tool_calls

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
                        result = await self._execute_tool_call(
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
                            await self._save_assistant_message(
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
                                "model": self.settings.model,
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
                response, _fb_used, client = await self._llm_call_with_fallback(
                    client,
                    model=self.settings.model,
                    messages=messages,
                    tools=tools if tools else NOT_GIVEN,
                    temperature=self.settings.temperature,
                )
                if _fb_used and self._fallback_is_gigachat():
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
            await self._save_assistant_message(
                conversation_id=conversation_id,
                content_blocks=content_blocks,
                token_usage=token_usage if token_usage else None,
                message_id=message_id,
            )

            return {
                "response": answer,
                "sources": list(dict.fromkeys(sources)),
                "model": self.settings.model,
                "token_usage": token_usage,
            }

        except asyncio.TimeoutError:
            logger.warning(
                "LLM timeout",
                extra={
                    "stage": "run",
                    "model": self.settings.model,
                    "conversation_id": conversation_id,
                },
            )
            error_message = "Временная ошибка AI-сервиса. Попробуйте позже."
            try:
                await self._save_assistant_message(
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
                await self._save_assistant_message(
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

    async def run_stream(
        self,
        *,
        conversation_id: str,
        user_message: str,
        message_id: str,
        domains: list[str] | None = None,
        file_blocks: list[dict] | None = None,
        user_id: str | None = None,
        knowledge_bases: list[str] | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        Стриминговый agent loop — генерирует SSE-события.

        Если streaming_enabled, использует stream=True с автофолбеком.
        Всегда yield-ит message_start/message_end.

        ``message_id`` обязателен — тот же id, что попадёт в БД через
        ``_save_assistant_message`` (используется для детерминированного
        ``block_id`` и для контекста forward'а к внешнему агенту).
        """
        # Фиксируем контекст для метрик; читается из _execute_tool_call.
        self._current_conversation_id = conversation_id
        self._current_user_id = user_id
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
        # Счётчик client_action-блоков для детерминированного block_id
        # ``f"{message_id}:ca:{i}"``. Обёрнут в list, чтобы parser-методы
        # могли инкрементировать его in-place.
        ca_counter: list[int] = [0]
        emitted_blocks: list[dict] = []  # ClientActionBlock'и, эмитнутые до финала
        # GigaChat поддерживает только 1 function_call за раунд. Если LLM
        # вернул >1 tool_call, первый исполняем сейчас, остальные — в очередь.
        pending_tool_calls: list[Any] = []
        is_gigachat = self.settings.profile == "gigachat"
        # Отслеживание повторяющихся ошибок валидации tool'ов.
        _last_validation_error: tuple[str, str] | None = None
        _consecutive_validation_errors = 0

        try:
            # GigaChat-proxy не поддерживает SSE — выключаем streaming
            # для этого профиля даже если в .env стоит true.
            use_streaming = (
                self.settings.streaming_enabled
                and self.settings.profile != "gigachat"
            )
            rounds = 0
            # Семантика max_tool_rounds — максимальное число tool-call
            # раундов (см. зеркальный non-streaming run()). Используем
            # строгое `<` с пост-инкрементом внутри, чтобы при
            # max_tool_rounds=N инструмент вызывался ровно N раз; на N+1
            # итерации модель уже не получает шанс вызвать tool. Иначе
            # стримящий путь делал N+1 раунд (off-by-one).
            max_tool_rounds = self.settings.max_tool_rounds

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
                        result = await self._execute_tool_call(tool_name, arguments)
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
                            await self._save_assistant_message(
                                conversation_id=conversation_id,
                                content_blocks=content_blocks,
                                token_usage=token_usage,
                                message_id=message_id,
                            )
                            yield sse_message_end(
                                message_id=message_id,
                                model=self.settings.model,
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
                                "Стриминг не удался после GigaChat-queue, "
                                "фолбек: %s: %s", type(exc).__name__, exc,
                            )
                            use_streaming = False
                    if not use_streaming:
                        response, _fb_used, client = await self._llm_call_with_fallback(
                            client,
                            model=self.settings.model,
                            messages=messages,
                            tools=tools if tools else NOT_GIVEN,
                            temperature=self.settings.temperature,
                            force_non_streaming=True,
                        )
                        if _fb_used and self._fallback_is_gigachat():
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
                        response_stream = await self._completions_create(
                            client,
                            model=self.settings.model,
                            messages=messages,
                            tools=tools if tools else NOT_GIVEN,
                            temperature=self.settings.temperature,
                            stream=True,
                        )
                    except Exception as exc:
                        is_provider = self._is_provider_failure(exc)
                        if is_provider:
                            breaker = self._get_circuit_breaker()
                            await breaker.record_failure(exc)
                        # Pre-stream fallback (только если ни одного блока
                        # ещё не yield-нули клиенту).
                        if (
                            is_provider
                            and not emitted_blocks
                            and block_index == 0
                            and self._has_fallback()
                        ):
                            fb_client = self._get_fallback_client()
                            if fb_client is not None:
                                logger.warning(
                                    "Streaming primary упал (%s); "
                                    "fallback на profile=%s",
                                    type(exc).__name__,
                                    self.settings.fallback_profile,
                                )
                                client = fb_client
                                if self._fallback_is_gigachat():
                                    use_streaming = False
                                    is_gigachat = True
                                    # Переход на non-streaming-ветку ниже.
                                else:
                                    try:
                                        response_stream = (
                                            await self._completions_create(
                                                client,
                                                model=(
                                                    self.settings.fallback_model
                                                    or self.settings.model
                                                ),
                                                messages=messages,
                                                tools=(
                                                    tools if tools else NOT_GIVEN
                                                ),
                                                temperature=(
                                                    self.settings.temperature
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
                                            self.settings.delta_chunk_flush_bytes
                                        ),
                                        block_max_bytes=(
                                            self.settings.delta_block_max_bytes
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

                        loop_broken_streaming = False
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
                                # Forward к внешнему агенту: SSE-стрим идёт
                                # из forward_bridge.handle_forward_call,
                                # сохранение ассистент-сообщения делает фоновый
                                # раннер (agent_bridge_runner) — даже если
                                # клиент закроет соединение посреди ответа.
                                async for kind, payload in handle_forward_call(
                                    settings=self.settings,
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
                                    model=self.settings.model,
                                    token_usage=None,
                                )
                                return

                            try:
                                result = await self._execute_tool_call(
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
                                        await self._save_assistant_message(
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
                                        model=self.settings.model,
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

                            client_action = self._parse_client_action_result(
                                result, message_id=message_id, ca_counter=ca_counter,
                            )
                            blocks_list = (
                                None if client_action is not None
                                else self._parse_blocks_list_result(
                                    result, message_id=message_id, ca_counter=ca_counter,
                                )
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
                                    if btype in ("text", "code"):
                                        for sse in emit_text_block_with_limit(
                                            block_index=block_index,
                                            block_type=btype,
                                            text=raw_block.get("content", ""),
                                            chunk_flush_bytes=(
                                                self.settings.delta_chunk_flush_bytes
                                            ),
                                            block_max_bytes=(
                                                self.settings.delta_block_max_bytes
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
                response, _fb_used, client = await self._llm_call_with_fallback(
                    client,
                    model=self.settings.model,
                    messages=messages,
                    tools=tools if tools else NOT_GIVEN,
                    temperature=self.settings.temperature,
                    force_non_streaming=True,
                )
                if _fb_used and self._fallback_is_gigachat():
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

                    loop_broken_ns = False
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
                            history_messages = await self._get_history_messages(
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
                                settings=self.settings,
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
                                model=self.settings.model,
                                token_usage=None,
                            )
                            return

                        try:
                            result = await self._execute_tool_call(
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
                                    await self._save_assistant_message(
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
                                    model=self.settings.model,
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

                        client_action = self._parse_client_action_result(
                            result, message_id=message_id, ca_counter=ca_counter,
                        )
                        blocks_list = (
                            None if client_action is not None
                            else self._parse_blocks_list_result(
                                result, message_id=message_id, ca_counter=ca_counter,
                            )
                        )
                        buttons_block = (
                            None if (client_action is not None or blocks_list is not None)
                            else self._parse_buttons_result(result)
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
                                if btype in ("text", "code"):
                                    for sse in emit_text_block_with_limit(
                                        block_index=block_index,
                                        block_type=btype,
                                        text=raw_block.get("content", ""),
                                        chunk_flush_bytes=(
                                            self.settings.delta_chunk_flush_bytes
                                        ),
                                        block_max_bytes=(
                                            self.settings.delta_block_max_bytes
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
                for sse in emit_text_block_with_limit(
                    block_index=block_index,
                    block_type="text",
                    text=answer,
                    chunk_flush_bytes=self.settings.delta_chunk_flush_bytes,
                    block_max_bytes=self.settings.delta_block_max_bytes,
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
                    await self._save_assistant_message(
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
                    "model": self.settings.model,
                    "elapsed_sec": time.monotonic() - run_started,
                    "conversation_id": conversation_id,
                },
            )
            yield sse_error(error="Временная ошибка AI-сервиса. Попробуйте позже.")
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
