"""
Эндпоинты API v1.

Содержит все HTTP‑обработчики для операций с актами, авторизацией
и системными сервисными функциями.
"""

from app.api.v1.endpoints.acts import router as acts
from app.api.v1.endpoints.acts_content import router as acts_content
from app.api.v1.endpoints.acts_export import router as acts_export
from app.api.v1.endpoints.auth import router as auth
from app.api.v1.endpoints.system import router as system

__all__ = [
    "auth",
    "acts",
    "acts_content",
    "acts_export",
    "system",
]
