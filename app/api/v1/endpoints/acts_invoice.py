"""
API эндпоинты для работы с фактурами актов.

Предоставляет операции:
- Поиск таблиц в БД (autocomplete)
- Сохранение фактуры (UPSERT)
- Верификация фактуры (заглушка)
- Получение списка фактур акта
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.deps.auth_deps import get_username
from app.db.connection import get_db
from app.db.repositories.act_repository import ActDBService
from app.schemas.act_invoice import InvoiceSave, InvoiceVerifyRequest

logger = logging.getLogger("act_constructor.api.invoice")
router = APIRouter()


@router.get("/tables/{db_type}")
async def list_tables(
        db_type: str,
        username: str = Depends(get_username),
) -> list[dict]:
    """
    Возвращает полный список таблиц в указанной БД.

    Args:
        db_type: Тип БД (hive, greenplum)
        username: Имя пользователя (из зависимости)

    Returns:
        Список таблиц [{schema_name, table_name}, ...]
    """
    if db_type not in ("hive", "greenplum"):
        raise HTTPException(
            status_code=400,
            detail=f"Неподдерживаемый тип БД: {db_type}. Допустимые: hive, greenplum"
        )

    async with get_db() as conn:
        db_service = ActDBService(conn)
        try:
            results = await db_service.list_tables(db_type)
            return results
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.exception(f"Ошибка загрузки таблиц ({db_type}): {e}")
            raise HTTPException(
                status_code=500,
                detail="Ошибка загрузки таблиц"
            )


@router.post("/save")
async def save_invoice(
        data: InvoiceSave,
        username: str = Depends(get_username),
) -> dict:
    """
    Сохраняет фактуру (UPSERT по act_id + node_id).

    Args:
        data: Данные фактуры
        username: Имя пользователя (из зависимости)

    Returns:
        Сохраненная фактура с id и статусом
    """
    async with get_db() as conn:
        db_service = ActDBService(conn)

        # Проверяем доступ к акту
        has_access = await db_service.check_user_access(data.act_id, username)
        if not has_access:
            raise HTTPException(status_code=403, detail="Нет доступа к акту")

        try:
            result = await db_service.save_invoice(data.model_dump(), username)
            logger.info(
                f"Фактура сохранена: act_id={data.act_id}, "
                f"node_id={data.node_id}, user={username}"
            )
            return result
        except Exception as e:
            logger.exception(f"Ошибка сохранения фактуры: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Ошибка сохранения фактуры: {str(e)}"
            )


@router.post("/verify")
async def verify_invoice(
        data: InvoiceVerifyRequest,
        username: str = Depends(get_username),
) -> dict:
    """
    Верификация фактуры (TODO-заглушка).

    Args:
        data: Запрос верификации с invoice_id
        username: Имя пользователя (из зависимости)

    Returns:
        Статус верификации
    """
    async with get_db() as conn:
        db_service = ActDBService(conn)
        try:
            result = await db_service.verify_invoice(data.invoice_id)
            return result
        except Exception as e:
            logger.exception(f"Ошибка верификации фактуры: {e}")
            raise HTTPException(
                status_code=500,
                detail="Ошибка верификации фактуры"
            )


@router.get("/{act_id}/invoices")
async def get_act_invoices(
        act_id: int,
        username: str = Depends(get_username),
) -> list[dict]:
    """
    Получает список всех фактур для акта.

    Args:
        act_id: ID акта
        username: Имя пользователя (из зависимости)

    Returns:
        Список фактур акта
    """
    async with get_db() as conn:
        db_service = ActDBService(conn)

        # Проверяем доступ к акту
        has_access = await db_service.check_user_access(act_id, username)
        if not has_access:
            raise HTTPException(status_code=403, detail="Нет доступа к акту")

        try:
            results = await db_service.get_invoices_for_act(act_id)
            return results
        except Exception as e:
            logger.exception(f"Ошибка получения фактур акта ID={act_id}: {e}")
            raise HTTPException(
                status_code=500,
                detail="Ошибка получения фактур"
            )
