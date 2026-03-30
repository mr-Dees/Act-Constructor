"""
Pydantic-схемы для чата с AI-ассистентом.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """Одно сообщение в истории диалога."""
    role: Literal["user", "assistant"] = Field(..., description="Роль отправителя")
    content: str = Field(..., max_length=10000, description="Текст сообщения")
    timestamp: Optional[int] = Field(None, description="Unix timestamp в миллисекундах")


class ChatRequest(BaseModel):
    """Запрос к чату."""
    message: str = Field(..., min_length=1, max_length=10000, description="Текст сообщения пользователя")
    history: List[ChatMessage] = Field(default_factory=list, max_length=50, description="История диалога")
    act_id: Optional[int] = Field(None, description="ID акта (контекст конструктора)")
    knowledge_bases: List[str] = Field(default_factory=list, description="Подключённые базы знаний")
    domains: Optional[List[str]] = Field(None, description="Список доменов для фильтрации tools (None = все)")
    context: Optional[dict] = Field(None, description="Дополнительный контекст от доменов")


class ChatResponse(BaseModel):
    """Ответ чата."""
    response: str = Field(..., description="Текст ответа ассистента")
    status: str = Field(default="ok", description="Статус обработки")
    sources: List[str] = Field(default_factory=list, description="Вызванные инструменты")
