"""API роутеры домена актов."""

from app.domains.acts.api.management import router as management_router
from app.domains.acts.api.content import router as content_router
from app.domains.acts.api.export import router as export_router
from app.domains.acts.api.invoice import router as invoice_router
from app.domains.acts.api.audit_log import router as audit_log_router
from app.domains.acts.api.users import router as users_router


def get_api_routers():
    """Возвращает список API роутеров домена актов."""
    return [
        (management_router, "/acts", ["Менеджмент актов"]),
        (content_router, "/acts", ["Содержимое актов"]),
        (export_router, "/acts/export", ["Операции экспорта"]),
        (invoice_router, "/acts/invoice", ["Фактуры актов"]),
        (audit_log_router, "/acts", ["Аудит-лог актов"]),
        (users_router, "/acts", ["Пользователи актов"]),
    ]
