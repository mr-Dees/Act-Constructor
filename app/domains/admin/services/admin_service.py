"""
Сервис администрирования — бизнес-логика управления ролями.
"""

import logging

import asyncpg

from app.domains.admin.exceptions import RoleNotFoundError, UserNotFoundError
from app.domains.admin.repositories.admin_repository import AdminRepository
from app.domains.admin.settings import AdminSettings

logger = logging.getLogger("audit_workstation.domains.admin.service")


class AdminService:
    """Управление ролями и справочником пользователей."""

    def __init__(self, conn: asyncpg.Connection, settings: AdminSettings):
        self.conn = conn
        self.settings = settings
        self.repo = AdminRepository(conn, settings)

    async def get_all_roles(self) -> list[dict]:
        """Возвращает все роли системы."""
        return await self.repo.get_all_roles()

    async def get_user_roles(self, username: str) -> dict:
        """
        Возвращает роли пользователя.

        Returns:
            dict с ключами username, roles, is_admin.
        """
        roles = await self.repo.get_user_roles(username)
        is_admin = any(r["name"] == "Админ" for r in roles)
        return {
            "username": username,
            "roles": roles,
            "is_admin": is_admin,
        }

    async def assign_role(self, username: str, role_id: int, assigned_by: str) -> bool:
        """
        Назначает роль пользователю.

        Raises:
            RoleNotFoundError: если роль не существует.
        """
        role = await self.repo.get_role_by_id(role_id)
        if not role:
            raise RoleNotFoundError(f"Роль с id={role_id} не найдена")

        assigned = await self.repo.assign_role(username, role_id, assigned_by)
        if assigned:
            logger.info(
                f"Роль '{role['name']}' назначена пользователю {username} "
                f"(назначил: {assigned_by})"
            )
        return assigned

    async def remove_role(self, username: str, role_id: int) -> bool:
        """
        Снимает роль с пользователя.

        Raises:
            RoleNotFoundError: если роль не существует.
        """
        role = await self.repo.get_role_by_id(role_id)
        if not role:
            raise RoleNotFoundError(f"Роль с id={role_id} не найдена")

        removed = await self.repo.remove_role(username, role_id)
        if removed:
            logger.info(
                f"Роль '{role['name']}' снята с пользователя {username}"
            )
        return removed

    async def get_user_directory(self) -> list[dict]:
        """
        Возвращает справочник пользователей с назначенными ролями.

        Для каждого пользователя загружаются его роли из user_roles.
        """
        users = await self.repo.get_user_directory()
        for user in users:
            roles = await self.repo.get_user_roles(user["username"])
            user["roles"] = roles
        return users

    async def seed_initial_roles(self, branch_filter: str, default_admin: str) -> None:
        """
        Начальное заполнение ролей при первом запуске.

        Если таблица user_roles пуста:
        1. Получает роли 'Цифровой акт' и 'Админ'
        2. Выбирает пользователей из справочника по подразделению
        3. Назначает 'Цифровой акт' всем пользователям подразделения
        4. Назначает 'Админ' пользователю default_admin
        """
        count = await self.repo.count_user_roles()
        if count > 0:
            logger.info(
                f"Таблица user_roles не пуста ({count} записей), "
                f"начальное заполнение пропущено"
            )
            return

        digital_act_role = await self.repo.get_role_by_name("Цифровой акт")
        admin_role = await self.repo.get_role_by_name("Админ")

        if not digital_act_role:
            logger.warning("Роль 'Цифровой акт' не найдена, заполнение пропущено")
            return
        if not admin_role:
            logger.warning("Роль 'Админ' не найдена, заполнение пропущено")
            return

        usernames = await self.repo.get_users_from_directory(branch_filter)
        if not usernames:
            logger.warning(
                f"Пользователи с branch='{branch_filter}' не найдены, "
                f"заполнение пропущено"
            )
            return

        # Назначаем 'Цифровой акт' всем пользователям подразделения
        assignments: list[tuple[str, int, str]] = [
            (u, digital_act_role["id"], "system")
            for u in usernames
        ]

        # Назначаем 'Админ' дефолтному администратору
        if default_admin in usernames:
            assignments.append((default_admin, admin_role["id"], "system"))

        assigned_count = await self.repo.bulk_assign_roles(assignments)
        logger.info(
            f"Начальное заполнение ролей: назначено {assigned_count} ролей "
            f"для {len(usernames)} пользователей из '{branch_filter}'"
        )
