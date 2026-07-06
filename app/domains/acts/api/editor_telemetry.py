"""
Эндпоинт телеметрии здоровья редактора (§6.8, минимальная версия).

Принимает батч агрегированных счётчиков событий редактора и пишет их в
таблицу ``act_editor_telemetry``. Read-API нет — данные смотрят SQL'ем.

Порядок гейтов важен:
  1. kill-switch (``ACTS__EDITOR_TELEMETRY_ENABLED=false``) → 204 без записи;
  2. rate-guard (> ``MAX_EVENTS_PER_BATCH`` событий) → 422 (защита INSERT'а);
  3. пустой батч → 204;
  4. запись → 201.
Username берётся из auth-зависимости, НЕ из payload.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import require_domain_access
from app.domains.acts.deps import _get_acts_settings, get_editor_telemetry_repo
from app.domains.acts.repositories.act_editor_telemetry import (
    ActEditorTelemetryRepository,
)
from app.domains.acts.schemas.editor_telemetry import EditorTelemetryBatch
from app.domains.acts.settings import ActsSettings

logger = logging.getLogger("audit_workstation.api.acts.editor_telemetry")

router = APIRouter()

# Предел размера батча: защита от неограниченного executemany. В штатной работе
# фронт флашит по 50 событий (агрегированных ещё меньше), так что порог —
# страховка от кривого/злонамеренного клиента.
MAX_EVENTS_PER_BATCH = 200


@router.post(
    "/editor-telemetry",
    status_code=201,
    summary="Приём телеметрии здоровья редактора",
    dependencies=[Depends(require_domain_access("acts"))],
)
async def post_editor_telemetry(
    batch: EditorTelemetryBatch,
    username: str = Depends(get_username),
    acts_cfg: ActsSettings = Depends(_get_acts_settings),
    repo: ActEditorTelemetryRepository = Depends(get_editor_telemetry_repo),
):
    """Пишет батч счётчиков событий редактора; выключенная телеметрия → 204."""
    if not acts_cfg.editor_telemetry_enabled:
        return Response(status_code=204)

    events = batch.events
    if len(events) > MAX_EVENTS_PER_BATCH:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Слишком большой батч телеметрии редактора: {len(events)} "
                f"событий (максимум {MAX_EVENTS_PER_BATCH})"
            ),
        )
    if not events:
        return Response(status_code=204)

    rows = [
        (str(uuid.uuid4()), e.act_id, username, e.event_type, e.count)
        for e in events
    ]
    await repo.insert_many(rows)
    return {"written": len(rows)}
