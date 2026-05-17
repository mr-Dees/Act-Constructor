"""Настройки домена чата."""

from typing import Literal

from pydantic import BaseModel, Field, SecretStr, field_validator


class RetryPolicy(BaseModel):
    """Политика повторных попыток для transient-ошибок LLM-провайдера."""

    on_429: bool = True   # rate-limit (transient)
    on_5xx: bool = True   # server errors (transient)
    max_attempts: int = Field(default=5, ge=1)
    backoff_base_sec: float = Field(default=2.0, ge=0.0)


class AgentBridgeSettings(BaseModel):
    """Настройки моста к внешнему ИИ-агенту через таблицы БД."""

    poll_interval_sec: float = Field(default=1.0, gt=0.0)
    initial_response_timeout_sec: int = Field(default=300, gt=0)
    event_timeout_sec: int = Field(default=120, gt=0)
    max_total_duration_sec: int = Field(default=1800, gt=0)
    history_limit: int = Field(default=30, gt=0)


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

    # Поведение small-talk
    smalltalk_mode: Literal["local", "forward"] = "local"

    # Retry-политика и мост к внешнему агенту
    retry: RetryPolicy = Field(default_factory=RetryPolicy)
    agent_bridge: AgentBridgeSettings = Field(default_factory=AgentBridgeSettings)

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

    # Хранение
    max_conversations_per_user: int = Field(default=100, gt=0)
    max_messages_per_conversation: int = Field(default=500, gt=0)
