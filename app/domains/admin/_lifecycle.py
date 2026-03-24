"""Жизненный цикл домена администрирования."""

import logging

from fastapi import FastAPI

logger = logging.getLogger("audit_workstation.domains.admin.lifecycle")


async def on_startup(app: FastAPI) -> None:
    """
    Инициализация домена при старте приложения.

    Проверяет, заполнена ли таблица user_roles.
    Если пуста — заполняет начальными ролями из справочника пользователей.
    """
    from app.core.settings_registry import get as get_domain_settings
    from app.db.connection import get_db
    from app.domains.admin.services.admin_service import AdminService
    from app.domains.admin.settings import AdminSettings

    settings = get_domain_settings("admin", AdminSettings)

    try:
        async with get_db() as conn:
            service = AdminService(conn=conn, settings=settings)
            await service.seed_initial_roles(
                branch_filter=settings.user_directory.branch_filter,
                default_admin=settings.user_directory.default_admin,
            )
    except Exception as exc:
        logger.error(f"Ошибка начального заполнения ролей: {exc}")
        # Не прерываем запуск приложения — роли можно назначить позже
