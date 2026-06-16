"""
Эндпоинт лимитов контента актов.

Отдаёт фронту лимиты картинок нарушений (ACTS__IMAGES__*) и жёсткие
границы таблиц/текстблоков из констант схем — чтобы UI-валидация
совпадала с серверной (образец — chat GET /limits).
"""

import logging

from fastapi import APIRouter, Depends

from app.api.v1.deps.auth_deps import get_username
from app.domains.acts.deps import _get_acts_settings
from app.domains.acts.settings import ActsSettings

logger = logging.getLogger("audit_workstation.api.acts.limits")

router = APIRouter()


@router.get(
    "/limits",
    summary="Лимиты контента актов",
)
async def get_acts_limits(
    acts_cfg: ActsSettings = Depends(_get_acts_settings),
    _: str = Depends(get_username),
):
    """Возвращает лимиты картинок нарушений и границы таблиц/текстблоков.

    Фронт читает один раз при инициализации конструктора: валидация
    картинок (MIME/размер/число) и границы grid/fontSize синхронизируются
    с серверными настройками (ACTS__IMAGES__* / ACTS__TABLES__* /
    ACTS__TEXTBLOCKS__*) — единый источник для UI-гейтов и схемы.
    """
    images = acts_cfg.images
    tables = acts_cfg.tables
    textblocks = acts_cfg.textblocks
    return {
        "images": {
            "max_file_size": images.max_file_size,
            "max_total_size_per_act": images.max_total_size_per_act,
            "allowed_mime_types": images.allowed_mime_types,
            "max_items_per_violation": images.max_items_per_violation,
            "preview_max_height_percent": images.preview_max_height_percent,
        },
        "tables": {
            "max_rows": tables.max_rows,
            "max_cols": tables.max_cols,
            "min_col_width_px": tables.min_col_width_px,
        },
        "textblocks": {
            "font_size_min": textblocks.font_size_min,
            "font_size_max": textblocks.font_size_max,
        },
    }
