"""
Эндпоинты для работы с актами.

Группирует все API-обработчики, связанные с актами:
управление, содержимое, экспорт и фактуры.
"""

from app.api.v1.endpoints.acts.management import router as management
from app.api.v1.endpoints.acts.content import router as content
from app.api.v1.endpoints.acts.export import router as export
from app.api.v1.endpoints.acts.invoice import router as invoice

__all__ = [
    "management",
    "content",
    "export",
    "invoice",
]
