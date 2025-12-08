"""
API пакет приложения.

Содержит версионированные эндпоинты для работы с актами.
"""

from app.api.v1 import api_router as api_v1_router

__all__ = [
    "api_v1_router",
]
