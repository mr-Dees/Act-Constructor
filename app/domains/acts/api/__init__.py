"""API роутеры домена актов."""

from app.domains.acts.api.management import router as management_router
from app.domains.acts.api.content import router as content_router
from app.domains.acts.api.export import router as export_router
from app.domains.acts.api.invoice import router as invoice_router


def get_api_routers():
    """Возвращает список API роутеров домена актов."""
    return [
        (management_router, "/acts", ["Менеджмент актов"]),
        (content_router, "/acts", ["Содержимое актов"]),
        (export_router, "/acts/export", ["Операции экспорта"]),
        (invoice_router, "/acts/invoice", ["Фактуры актов"]),
    ]
