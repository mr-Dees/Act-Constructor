"""Настройки домена чата."""

from typing import Literal

from pydantic import BaseModel, Field, SecretStr, field_validator


class RetryPolicy(BaseModel):
    """Политика повторных попыток для transient-ошибок LLM-провайдера."""

    on_429: bool = True   # rate-limit (transient)
    on_5xx: bool = True   # server errors (transient)
    max_attempts: int = Field(default=5, ge=1)
    backoff_base_sec: float = Field(default=2.0, ge=0.0)


class AgentChannelSettings(BaseModel):
    """Параметры канала к внешнему агенту через bus-таблицу agent_messages."""

    table_name: str = Field(default="agent_messages")
    poll_min_interval_sec: float = Field(default=2.0, gt=0.0)
    poll_max_interval_sec: float = Field(default=10.0, gt=0.0)
    poll_backoff_multiplier: float = Field(default=1.5, gt=1.0)
    answer_timeout_sec: int = Field(default=600, gt=0)  # 10 минут
    max_block_text_size: int = Field(default=262144, gt=0)


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
        default=5,
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

    # Retry-политика и канал к внешнему агенту через bus-таблицу
    retry: RetryPolicy = Field(default_factory=RetryPolicy)
    agent_channel: AgentChannelSettings = Field(default_factory=AgentChannelSettings)

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

    # Максимум параллельных SSE-стримов на одного пользователя.
    # При превышении новый запрос с Accept: text/event-stream получает 429.
    max_parallel_streams_per_user: int = Field(default=3, ge=1, le=20)

    # Лимиты размера SSE delta-блоков (защита от self-DoS при гигантских
    # чанках LLM, особенно reasoning). delta_chunk_flush_bytes — порог,
    # при превышении которого накопленный буфер немедленно эмитится
    # отдельным block_delta; delta_block_max_bytes — общий лимит на
    # блок (от block_start до block_end), при превышении блок усекается
    # маркером и закрывается, последующие deltas игнорируются.
    delta_chunk_flush_bytes: int = Field(default=65536, ge=1024)
    delta_block_max_bytes: int = Field(default=5242880, ge=65536)

    # Хранение
    max_conversations_per_user: int = Field(default=100, gt=0)
    max_messages_per_conversation: int = Field(default=500, gt=0)
