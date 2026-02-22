"""
Эндпоинты API v1.

Содержит все HTTP-обработчики, сгруппированные по доменам:
- acts/     — операции с актами (управление, содержимое, экспорт, фактуры)
- auth.py   — авторизация
- chat.py   — чат с AI-ассистентом
- system.py — системные сервисные функции
"""

from app.api.v1.endpoints.acts.management import router as acts
from app.api.v1.endpoints.acts.content import router as acts_content
from app.api.v1.endpoints.acts.export import router as acts_export
from app.api.v1.endpoints.acts.invoice import router as acts_invoice
from app.api.v1.endpoints.auth import router as auth
from app.api.v1.endpoints.chat import router as chat
from app.api.v1.endpoints.system import router as system

__all__ = [
    "auth",
    "chat",
    "acts",
    "acts_content",
    "acts_export",
    "acts_invoice",
    "system",
]
