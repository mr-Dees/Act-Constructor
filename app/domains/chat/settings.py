"""Настройки домена чата."""

from typing import Literal

from pydantic import BaseModel, Field, SecretStr, field_validator


class RetryPolicy(BaseModel):
    """Политика повторных попыток для transient-ошибок LLM-провайдера."""

    on_429: bool = True   # rate-limit (transient)
    on_5xx: bool = True   # server errors (transient)
    max_attempts: int = Field(default=5, ge=1)
    backoff_base_sec: float = Field(default=2.0, ge=0.0)
    # Отдельный кап для обрывов соединения (ConnectError/APIConnectionError/
    # PoolTimeout): сервер лёг — нет смысла ждать полный цикл из max_attempts,
    # быстро падаем на fallback. APITimeoutError («сервер медленный»)
    # сюда НЕ относится — он идёт по обычному max_attempts.
    connect_max_attempts: int = Field(default=2, ge=1)


class AgentChannelSettings(BaseModel):
    """Параметры канала к внешнему агенту через bus-таблицу chat_agent_messages_bus."""

    table_name: str = Field(default="chat_agent_messages_bus")
    # Схема БД bus-таблицы. Пусто → fallback на схему домена чата
    # (ChatDomainSettings.schema_name), затем на основную схему адаптера.
    # Позволяет вынести шину в общую integration-схему с внешним агентом.
    schema_name: str = Field(default="")
    poll_min_interval_sec: float = Field(default=2.0, gt=0.0)
    poll_max_interval_sec: float = Field(default=10.0, gt=0.0)
    poll_backoff_multiplier: float = Field(default=1.5, gt=1.0)
    answer_timeout_sec: int = Field(default=600, gt=0)  # 10 минут
    max_block_text_size: int = Field(default=262144, gt=0)


class LLMHealthProbeSettings(BaseModel):
    """Фоновая перепроверка доступности primary-LLM при открытом circuit breaker.

    Убирает «пробу живым запросом» из пути пользователя: пока primary лежит,
    все запросы мгновенно идут на fallback, а отдельная фоновая задача
    пингует primary с adaptive-backoff и закрывает breaker, как только
    primary отвечает (best-practice: Azure Architecture Center).
    """

    enabled: bool = True
    poll_min_interval_sec: float = Field(default=2.0, gt=0.0)
    poll_max_interval_sec: float = Field(default=30.0, gt=0.0)
    poll_backoff_multiplier: float = Field(default=1.5, gt=1.0)
    timeout_sec: float = Field(default=5.0, gt=0.0)


class ChatDomainSettings(BaseModel):
    """Настройки AI-ассистента и чата."""

    # Профиль провайдера LLM
    profile: Literal["openrouter", "sglang", "openai", "gigachat"] = "sglang"
    extra_headers: dict[str, str] = Field(default_factory=dict)

    # LLM
    model: str = "gpt-4o"
    api_base: str = ""
    api_key: SecretStr = SecretStr("")
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    max_tool_rounds: int = Field(default=5, gt=0)
    streaming_enabled: bool = True
    request_timeout: int = Field(default=60, gt=0)

    # Fallback-провайдер на случай сбоя primary (circuit breaker).
    # Поля используют default_factory=lambda: None: settings_registry
    # пропускает поля с default=None при подъёме .env-loader'а, и они
    # становятся required (вместо желаемых Optional). default_factory
    # обходит эту особенность.
    fallback_profile: Literal["openrouter", "sglang", "openai", "gigachat"] | None = Field(
        default_factory=lambda: None,
        description=(
            "Профиль провайдера для fallback при сбое primary. "
            "None = fallback отключён."
        ),
    )
    fallback_api_base: str | None = Field(default_factory=lambda: None)
    fallback_api_key: SecretStr | None = Field(default_factory=lambda: None)
    fallback_model: str | None = Field(default_factory=lambda: None)
    fallback_extra_headers: dict[str, str] = Field(default_factory=dict)

    circuit_breaker_failure_threshold: int = Field(
        default=2,
        ge=1,
        description=(
            "Подряд ошибок primary, после которого circuit размыкается"
        ),
    )
    circuit_breaker_recovery_timeout_sec: int = Field(
        default=60,
        ge=10,
        description=(
            "Сколько секунд circuit остаётся разомкнутым, "
            "пока probe не попробует primary"
        ),
    )

    # Поведение small-talk
    smalltalk_mode: Literal["local", "forward"] = "local"

    # Схема БД для собственных таблиц чата (conversations, messages, files,
    # tool_metrics, audit_log). Пусто → основная схема адаптера (GP) /
    # без квалификатора (PG). Учитывается и при создании, и при доступе.
    schema_name: str = ""

    # Retry-политика и канал к внешнему агенту через bus-таблицу
    retry: RetryPolicy = Field(default_factory=RetryPolicy)
    agent_channel: AgentChannelSettings = Field(default_factory=AgentChannelSettings)
    health_probe: LLMHealthProbeSettings = Field(
        default_factory=LLMHealthProbeSettings,
    )

    # Оркестрация
    system_prompt: str = (
        "Ты — AI-ассистент рабочей станции аудитора. "
        "Помогаешь с анализом актов, поиском информации и ответами на вопросы. "
        "Отвечай на русском языке, кратко и по делу."
    )
    max_history_length: int = Field(default=50, gt=0)
    max_message_content_length: int = Field(default=10000, gt=0)
    tool_execution_timeout: int = Field(default=30, gt=0)
    # Количество последних сообщений истории с полным контентом (включая file/image-блоки).
    # Более старые сообщения получают placeholder вместо бинарного контента.
    history_full_context_depth: int = Field(default=5, ge=1)

    # Файлы
    max_file_size: int = Field(default=10 * 1024 * 1024, gt=0)
    # Жёсткий whitelist точных MIME-типов (БЕЗ подстановок). Сравнение
    # производится посимвольно — браузерные "text/html; charset=utf-8"
    # отклоняются, что блокирует попытки залить HTML под видом текста.
    allowed_mime_types: list[str] = [
        "text/plain",
        "text/csv",
        "text/markdown",
        "application/pdf",
        "application/json",
        "application/xml",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
    ]
    max_files_per_message: int = Field(default=5, gt=0)
    max_total_file_size: int = Field(default=30 * 1024 * 1024, gt=0)

    @field_validator("allowed_mime_types")
    @classmethod
    def _no_wildcards_in_mime_types(cls, v: list[str]) -> list[str]:
        """Запрещает подстановки и пустые элементы в whitelist."""
        for item in v:
            if not item or not item.strip():
                raise ValueError(
                    "allowed_mime_types: пустой элемент недопустим",
                )
            if "*" in item:
                raise ValueError(
                    f"allowed_mime_types: подстановки запрещены ('{item}'). "
                    "Используй точные MIME-типы.",
                )
        return v

    # Per-user rate limit на отправку сообщений
    rate_limit_messages_per_minute_per_user: int = Field(default=10, ge=1)

    # Максимум одновременных активных запросов к агенту на одного
    # пользователя. При превышении submit бросает ChatLimitError → HTTP 422.
    max_parallel_streams_per_user: int = Field(default=3, ge=1, le=20)

    # Лимиты размера текстовых блоков (защита от self-DoS при гигантских
    # ответах LLM, особенно reasoning). delta_chunk_flush_bytes — порог
    # накопления буфера; delta_block_max_bytes — общий лимит на блок,
    # при превышении блок усекается маркером.
    delta_chunk_flush_bytes: int = Field(default=65536, ge=1024)
    delta_block_max_bytes: int = Field(default=5242880, ge=65536)

    # Хранение
    max_conversations_per_user: int = Field(default=100, gt=0)
    max_messages_per_conversation: int = Field(default=500, gt=0)


def resolve_chat_schema() -> str:
    """Схема собственных таблиц чата. Пусто → основная схема адаптера.

    Безопасно при незарегистрированном домене (юнит-тесты): вернёт "".
    """
    from app.core.settings_registry import get

    try:
        return get("chat", ChatDomainSettings).schema_name
    except KeyError:
        return ""


def resolve_bus_schema() -> str:
    """Схема bus-таблицы: agent_channel.schema_name → схема чата → основная."""
    from app.core.settings_registry import get

    try:
        s = get("chat", ChatDomainSettings)
    except KeyError:
        return ""
    return s.agent_channel.schema_name or s.schema_name


def schema_qualifier(domain_schema: str) -> str:
    """Квалификатор '<schema>.' для подстановки в миграции.

    Пустая доменная схема воспроизводит дефолтное поведение адаптера:
    основная схема GP (`<main>.`) либо без квалификатора на PG (``).
    """
    if domain_schema:
        return f"{domain_schema}."
    from app.db.connection import get_adapter

    main = getattr(get_adapter(), "schema", "")
    return f"{main}." if main else ""
