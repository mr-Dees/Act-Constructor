"""
Shared эндпоинты API v1.

Доменные эндпоинты живут в app/domains/*/api/.
"""

from app.api.v1.endpoints.auth import router as auth
from app.api.v1.endpoints.chat import router as chat
from app.api.v1.endpoints.system import router as system

__all__ = [
    "auth",
    "chat",
    "system",
]
