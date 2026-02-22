"""
Pydantic-схемы для чата с AI-ассистентом.
"""

from typing import List, Optional

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """Одно сообщение в истории диалога."""
    role: str = Field(..., description="Роль отправителя: 'user' или 'assistant'")
    content: str = Field(..., description="Текст сообщения")
    timestamp: Optional[int] = Field(None, description="Unix timestamp в миллисекундах")


class ChatRequest(BaseModel):
    """Запрос к чату."""
    message: str = Field(..., min_length=1, max_length=10000, description="Текст сообщения пользователя")
    history: List[ChatMessage] = Field(default_factory=list, description="История диалога")
    act_id: Optional[int] = Field(None, description="ID акта (контекст конструктора)")
    knowledge_bases: List[str] = Field(default_factory=list, description="Подключённые базы знаний")


class ChatResponse(BaseModel):
    """Ответ чата."""
    response: str = Field(..., description="Текст ответа ассистента")
    status: str = Field(default="ok", description="Статус обработки")
