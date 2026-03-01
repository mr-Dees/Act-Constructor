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
from app.core.exceptions import AccessDeniedError
from app.db.connection import get_db
from app.db.repositories.acts import ActInvoiceRepository, ActAccessRepository
from app.schemas.acts.act_invoice import InvoiceSave, InvoiceVerifyRequest

logger = logging.getLogger("act_constructor.api.invoice")
router = APIRouter()


@router.get("/metrics")
async def list_metrics(
        username: str = Depends(get_username),
) -> list[dict]:
    """
    Возвращает справочник метрик.

    Returns:
        Список метрик [{code, metric_name, metric_group}, ...]
    """
    async with get_db() as conn:
        invoice_repo = ActInvoiceRepository(conn)
        try:
            results = await invoice_repo.list_metric_dict()
            return results
        except Exception as e:
            logger.exception(f"Ошибка загрузки справочника метрик: {e}")
            raise HTTPException(
                status_code=500,
                detail="Ошибка загрузки справочника метрик"
            )


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
        Список таблиц [{table_name}, ...]
    """
    async with get_db() as conn:
        invoice_repo = ActInvoiceRepository(conn)
        results = await invoice_repo.list_tables(db_type)
        return results


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
        access = ActAccessRepository(conn)
        invoice_repo = ActInvoiceRepository(conn)

        # Проверяем доступ к акту
        has_access = await access.check_user_access(data.act_id, username)
        if not has_access:
            raise AccessDeniedError("Нет доступа к акту")

        result = await invoice_repo.save_invoice(data.model_dump(), username)
        logger.info(
            f"Фактура сохранена: act_id={data.act_id}, "
            f"node_id={data.node_id}, user={username}"
        )
        return result


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
        invoice_repo = ActInvoiceRepository(conn)
        try:
            result = await invoice_repo.verify_invoice(data.invoice_id)
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
        access = ActAccessRepository(conn)
        invoice_repo = ActInvoiceRepository(conn)

        # Проверяем доступ к акту
        has_access = await access.check_user_access(act_id, username)
        if not has_access:
            raise AccessDeniedError("Нет доступа к акту")

        return await invoice_repo.get_invoices_for_act(act_id)
