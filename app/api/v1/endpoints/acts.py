# app/api/v1/endpoints/acts.py
"""
API эндпоинты для управления актами.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Header, Depends

from app.core.config import get_settings, Settings
from app.db.connection import get_db
from app.db.models import ActCreate, ActUpdate, ActListItem, ActResponse
from app.db.service import ActDBService

logger = logging.getLogger("act_constructor.api")
router = APIRouter()


def get_username(
        x_jupyterhub_user: Annotated[str | None, Header()] = None,
        settings: Settings = Depends(get_settings)
) -> str:
    """Извлекает имя пользователя из заголовка или настроек."""
    return x_jupyterhub_user or settings.jupyterhub_user


@router.get("/list", response_model=list[ActListItem])
async def list_user_acts(
        username: str = Depends(get_username),
        conn=Depends(get_db)
):
    """Получает список актов пользователя (только те, где участвует)."""
    db_service = ActDBService(conn)
    try:
        acts = await db_service.get_user_acts(username)
        logger.info(f"Получен список актов для {username}: {len(acts)} шт.")
        return acts
    except Exception as e:
        logger.exception(f"Ошибка получения списка актов: {e}")
        raise HTTPException(status_code=500, detail="Ошибка получения списка актов")


@router.post("/create", response_model=ActResponse)
async def create_act(
        act_data: ActCreate,
        username: str = Depends(get_username),
        conn=Depends(get_db)
):
    """Создает новый акт."""
    db_service = ActDBService(conn)
    try:
        act = await db_service.create_act(act_data, username)
        logger.info(f"Создан акт ID={act.id}, КМ={act.km_number}")
        return act
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Ошибка создания акта: {e}")
        raise HTTPException(status_code=500, detail="Ошибка создания акта")


@router.get("/{act_id}", response_model=ActResponse)
async def get_act(
        act_id: int,
        username: str = Depends(get_username),
        conn=Depends(get_db)
):
    """Получает полную информацию об акте."""
    db_service = ActDBService(conn)
    has_access = await db_service.check_user_access(act_id, username)
    if not has_access:
        raise HTTPException(status_code=403, detail="Нет доступа к акту")
    try:
        return await db_service.get_act_by_id(act_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception(f"Ошибка получения акта ID={act_id}: {e}")
        raise HTTPException(status_code=500, detail="Ошибка получения акта")


@router.patch("/{act_id}", response_model=ActResponse)
async def update_act_metadata(
        act_id: int,
        act_update: ActUpdate,
        username: str = Depends(get_username),
        conn=Depends(get_db)
):
    """Обновляет метаданные выбранного акта."""
    db_service = ActDBService(conn)
    has_access = await db_service.check_user_access(act_id, username)
    if not has_access:
        raise HTTPException(status_code=403, detail="Нет доступа к акту")
    try:
        return await db_service.update_act_metadata(act_id, act_update, username)
    except Exception as e:
        logger.exception(f"Ошибка обновления акта ID={act_id}: {e}")
        raise HTTPException(status_code=500, detail="Ошибка обновления акта")


@router.post("/{act_id}/duplicate", response_model=ActResponse)
async def duplicate_act(
        act_id: int,
        new_km_number: str,
        username: str = Depends(get_username),
        conn=Depends(get_db)
):
    """Создает дубликат акта с новым номером КМ."""
    db_service = ActDBService(conn)
    has_access = await db_service.check_user_access(act_id, username)
    if not has_access:
        raise HTTPException(status_code=403, detail="Нет доступа к акту")
    try:
        return await db_service.duplicate_act(act_id, new_km_number, username)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Ошибка дублирования акта ID={act_id}: {e}")
        raise HTTPException(status_code=500, detail="Ошибка дублирования акта")
