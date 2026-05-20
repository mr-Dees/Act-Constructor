"""
Зависимости для проверки ролей пользователей.

Предоставляет get_user_roles, require_domain_access, require_admin
для использования в FastAPI Depends при регистрации роутеров.
"""

import logging
from typing import Callable

import asyncpg
from cachetools import TTLCache
from fastapi import Depends, HTTPException

from app.api.v1.deps.auth_deps import get_username
from app.db.connection import get_db, get_adapter

logger = logging.getLogger("audit_workstation.api.deps.roles")

# Кеш ролей: maxsize=256, ttl=5 секунд.
# TTL короткий — это последняя линия защиты от устаревших прав при отсутствии
# межпроцессной инвалидации (см. invalidate_user_roles_cache).
_roles_cache: TTLCache = TTLCache(maxsize=256, ttl=5)

# Роли, автоматически назначаемые пользователю при первом обращении.
DEFAULT_ROLE_NAMES: tuple[str, ...] = ("Цифровой акт", "Чат-ассистент")


async def get_user_roles(username: str = Depends(get_username)) -> list[dict]:
    """
    Возвращает список ролей текущего пользователя.

    Кешируется на 5 секунд. Если у пользователя нет ролей,
    автоматически назначает дефолтные роли (см. DEFAULT_ROLE_NAMES).
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
            rows = await _auto_assign_default_roles(conn, username, roles_table, user_roles_table)

    result = [dict(r) for r in rows]
    _roles_cache[username] = result
    return result


async def _auto_assign_default_roles(conn, username, roles_table, user_roles_table):
    """
    Автоматически назначает дефолтные роли (DEFAULT_ROLE_NAMES) пользователю без ролей.
    """
    role_rows = await conn.fetch(
        f"SELECT id, name FROM {roles_table} WHERE name = ANY($1::text[])",
        list(DEFAULT_ROLE_NAMES),
    )
    found_names = {r["name"] for r in role_rows}
    missing = [n for n in DEFAULT_ROLE_NAMES if n not in found_names]
    for name in missing:
        logger.warning(f"Роль '{name}' не найдена для auto-assign")

    if not role_rows:
        return []

    from app.db.connection import get_adapter as _get_adapter
    adapter = _get_adapter()

    for role_row in role_rows:
        role_id = role_row["id"]
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
            except asyncpg.UniqueViolationError:
                pass  # Already assigned by concurrent request

    assigned_names = ", ".join(sorted(found_names))
    logger.info(f"Auto-assign: роли [{assigned_names}] назначены пользователю {username}")

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


def invalidate_user_roles_cache(username: str) -> None:
    """Явная инвалидация кеша ролей при назначении/снятии роли.

    ВАЖНО: инвалидация работает только в пределах текущего процесса.
    В multi-process / multi-instance деплое (в первую очередь JupyterHub,
    где каждый пользователь запускает собственный процесс приложения)
    очистка кеша в одном процессе НЕ затронет кеш в других процессах.
    Для таких случаев единственной защитой остаётся короткий TTL (5 сек)
    — это сознательный компромисс между свежестью прав и нагрузкой на БД.
    """
    _roles_cache.pop(username, None)
