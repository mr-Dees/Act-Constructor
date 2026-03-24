"""
Зависимости для проверки ролей пользователей.

Предоставляет get_user_roles, require_domain_access, require_admin
для использования в FastAPI Depends при регистрации роутеров.
"""

import logging
from typing import Callable

from cachetools import TTLCache
from fastapi import Depends, HTTPException

from app.api.v1.deps.auth_deps import get_username
from app.db.connection import get_db, get_adapter

logger = logging.getLogger("audit_workstation.deps.roles")

# Кеш ролей: maxsize=256, ttl=60 секунд
_roles_cache: TTLCache = TTLCache(maxsize=256, ttl=60)


async def get_user_roles(username: str = Depends(get_username)) -> list[dict]:
    """
    Возвращает список ролей текущего пользователя.

    Кешируется на 60 секунд. Если у пользователя нет ролей,
    автоматически назначает роль 'Цифровой акт'.
    """
    if username in _roles_cache:
        return _roles_cache[username]

    adapter = get_adapter()
    roles_table = adapter.get_table_name("roles")
    user_roles_table = adapter.get_table_name("user_roles")

    async with get_db() as conn:
        rows = await conn.fetch(
            f"""
            SELECT r.id, r.name, r.domain_name
            FROM {user_roles_table} ur
            JOIN {roles_table} r ON ur.role_id = r.id
            WHERE ur.username = $1
            """,
            username,
        )

        if not rows:
            rows = await _auto_assign_default_role(conn, username, roles_table, user_roles_table)

    result = [dict(r) for r in rows]
    _roles_cache[username] = result
    return result


async def _auto_assign_default_role(conn, username, roles_table, user_roles_table):
    """
    Автоматически назначает роль 'Цифровой акт' пользователю без ролей.
    """
    role_row = await conn.fetchrow(
        f"SELECT id FROM {roles_table} WHERE name = $1",
        "Цифровой акт",
    )
    if not role_row:
        logger.warning("Роль 'Цифровой акт' не найдена для auto-assign")
        return []

    role_id = role_row["id"]

    from app.db.connection import get_adapter as _get_adapter
    adapter = _get_adapter()

    if adapter.supports_on_conflict():
        await conn.execute(
            f"""
            INSERT INTO {user_roles_table} (username, role_id, assigned_by)
            VALUES ($1, $2, 'auto')
            ON CONFLICT (username, role_id) DO NOTHING
            """,
            username, role_id,
        )
    else:
        try:
            await conn.execute(
                f"""
                INSERT INTO {user_roles_table} (username, role_id, assigned_by)
                VALUES ($1, $2, 'auto')
                """,
                username, role_id,
            )
        except Exception:
            pass  # Already assigned by concurrent request

    logger.info(f"Auto-assign: роль 'Цифровой акт' назначена пользователю {username}")

    return await conn.fetch(
        f"""
        SELECT r.id, r.name, r.domain_name
        FROM {user_roles_table} ur
        JOIN {roles_table} r ON ur.role_id = r.id
        WHERE ur.username = $1
        """,
        username,
    )


def require_domain_access(domain_name: str) -> Callable:
    """
    Фабрика зависимости: проверяет доступ пользователя к домену.

    Админ имеет доступ ко всем доменам.
    """
    async def _check(roles: list[dict] = Depends(get_user_roles)):
        if any(r["name"] == "Админ" for r in roles):
            return
        if not any(r["domain_name"] == domain_name for r in roles):
            raise HTTPException(status_code=403, detail="Нет доступа к разделу")
    return _check


def require_admin() -> Callable:
    """Фабрика зависимости: только администраторы."""
    async def _check(roles: list[dict] = Depends(get_user_roles)):
        if not any(r["name"] == "Админ" for r in roles):
            raise HTTPException(status_code=403, detail="Только для администраторов")
    return _check


def invalidate_roles_cache(username: str) -> None:
    """Инвалидация кеша ролей при назначении/снятии."""
    _roles_cache.pop(username, None)
