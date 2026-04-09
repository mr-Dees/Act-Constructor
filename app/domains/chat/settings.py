"""Настройки домена чата."""

from pydantic import BaseModel, Field, SecretStr


class ChatDomainSettings(BaseModel):
    """Настройки AI-ассистента и чата."""

    # LLM
    model: str = "gpt-4o"
    api_base: str = ""
    api_key: SecretStr = SecretStr("")
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    max_tool_rounds: int = Field(default=5, gt=0)
    streaming_enabled: bool = True

    # Оркестрация
    system_prompt: str = (
        "Ты — AI-ассистент рабочей станции аудитора. "
        "Помогаешь с анализом актов, поиском информации и ответами на вопросы. "
        "Отвечай на русском языке, кратко и по делу."
    )
    max_history_length: int = Field(default=50, gt=0)
    max_message_content_length: int = Field(default=10000, gt=0)
    tool_execution_timeout: int = Field(default=30, gt=0)

    # Файлы
    max_file_size: int = Field(default=10 * 1024 * 1024, gt=0)
    allowed_mime_types: list[str] = [
        "text/*",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.*",
        "application/vnd.ms-excel",
        "image/*",
    ]
    max_files_per_message: int = Field(default=5, gt=0)
    max_total_file_size: int = Field(default=30 * 1024 * 1024, gt=0)

    # Хранение
    max_conversations_per_user: int = Field(default=100, gt=0)
    max_messages_per_conversation: int = Field(default=500, gt=0)
