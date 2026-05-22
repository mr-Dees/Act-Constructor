"""Endpoint наблюдаемости батчеров и фоновых задач.

Возвращает снимок состояния всех компонентов, зарегистрированных в
``observability_registry``. Доступ — только для роли «Админ» (через
``require_domain_access('admin')``).
"""

from fastapi import APIRouter, Depends

from app.api.v1.deps.role_deps import require_domain_access
from app.core.observability_registry import get_all_statuses

router = APIRouter()


@router.get(
    "",
    dependencies=[Depends(require_domain_access("admin"))],
    summary="Состояние всех батчеров и фоновых задач",
)
async def diagnostics() -> dict:
    """Снимок состояний всех зарегистрированных компонентов.

    Поля:

    * ``batchers`` — ``dict[name, {name, buffer_size, max_buffer_size,
      max_batch_size, flush_interval_sec, dropped_count,
      last_flush_ago_sec, last_error, running}]``;
    * ``background_tasks`` — ``dict[name, {name, running, ...task-specific}]``.
    """
    return get_all_statuses()
