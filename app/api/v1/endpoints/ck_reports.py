"""
API эндпоинты для управления актами.

Предоставляет CRUD операции для метаданных актов:
- Список актов пользователя
- Создание нового акта
- Получение информации об акте
- Обновление метаданных
- Дублирование акта
- Удаление акта

Авторизация осуществляется через зависимость get_username (app.api.v1.deps.auth_deps).
"""

import logging
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, Query

from app.api.v1.deps.auth_deps import get_username
from app.db.connection import get_db, KerberosTokenExpiredError
from app.db.repositories.ck_reports_repository import CkReportsDBService
from app.schemas.ua_metadata import FinResReportView


logger = logging.getLogger("act_constructor.api.ck_reports")
router = APIRouter()

@router.get("/get_fr_data", response_model=List[FinResReportView])
async def get_fr_data(
        username: str = Depends(get_username),
        dt_start: Optional[datetime] = None,
        dt_end: Optional[datetime] = None
    ):
    """Вход:
    dt_start: date (опционально)
    dt_end: date (опционально)

    Где dt_*, соответствует дате реализации СЗ
    Если оба поля не заполнены, значит с самой ранней по текущую дату
    Если не заполнена дата начала, значит с самой ранней по указанную дату
    Если не заполнена дата окончания, значит с указанной по текущую дату
    Выход:
    data: Данные по таблице установленного формата
    Ошибки:
    Access denied (401) - протухший kinit
    Bad request (404) - неверный период (dt_* < 01-01-2000 или dt_* > текущей; dt_end < dt_start)
    Not acceptable (406) - запрос не дал результатов
    Internal Server Error (500) - внутреняя ошибка"""
    try:
        ck_fr_id = 1 #TO DO: заглушка для ID роли ЦК ФР из БД

        current_date = datetime.now()
        if dt_start and (dt_start < datetime(2000, 1, 1) or dt_start > current_date):
            raise HTTPException(status_code=404, detail="dt_start вне допустимого диапазона (01.01.2000 - сегодня)")
        if dt_end and (dt_end < datetime(2000, 1, 1) or dt_end > current_date):
            raise HTTPException(status_code=404, detail="dt_end вне допустимого диапазона (01.01.2000 - сегодня)")
        if dt_start and dt_end and dt_end < dt_start:
            raise HTTPException(status_code=404, detail="dt_end не может быть раньше dt_start")

        async with get_db() as conn:
            db_service = CkReportsDBService(conn)
            has_access = await db_service.check_user_access_to_ck_report(ck_fr_id, username)
            if not has_access:
                raise HTTPException(status_code=403, detail="Нет доступа к отчету")
            res = db_service.get_ck_fr_report(dt_start, dt_end)
            if len(res) == 0:
                raise HTTPException(status_code=406, detail="Запрос не дал результатов")
        return
    except HTTPException:
        raise
    except KerberosTokenExpiredError as e:
        logger.exception(f"У пользователя {username} протух kinit: {e}")
        raise HTTPException(status_code=401, detail="Не верный тикет kerberos")
    except Exception as e:
        logger.exception(f"Ошибка запроса API get_fr_data({str(dt_start)}, {str(dt_end)}): {e}")
        raise HTTPException(status_code=500, detail="Внутреняя ошибка сервера")


@router.get("/get_fr_data_by_code_metric")
async def get_fr_data_by_code_metric(
        username: str = Depends(get_username),
        code_metric: int = Query(..., description="Код метрики (например, 123 или 4567)"),
        dt_start: Optional[datetime] = Query(None, description="Дата начала"),
        dt_end: Optional[datetime] = Query(None, description="Дата окончания")
):
    """Вход:
    code_metric: int
    dt_start: date (опционально)
    dt_end: date (опционально)

    Где dt_*, соответсвует дате реализации СЗ
    Если оба поля не заполнены выдать все по коду метрики
    Если не заполнена дата начала, значит с самой ранней по указанную дату
    Если не заполнена дата окончания, значит с указанной по текущую дату
    Выход:
    data: данные по таблице установленного формата по определенному коду метрики
    Ошибки:
    Bad request (400) - code_metric не соответсвует шаблону: \d{3,4} или неверный период (dt_* < 01-01-2000 или dt_* > текущей; dt_end < dt_start)
    Access denied (401) - протухший kinit
    Not Found (404) - по code_metric ничего не найдено (если не переданы dt_*)
    Not acceptable (406) - запрос не дал результатов (если в запросе переданы dt_*)
    Internal Server Error (500) - внутреняя ошибка"""
    if not (100 <= code_metric <= 9999):
        raise HTTPException(status_code=400, detail="code_metric должен быть от 100 до 9999")

    # Валидация дат
    current_date = datetime.now()
    if dt_start and (dt_start < datetime(2000, 1, 1) or dt_start > current_date):
        raise HTTPException(status_code=400, detail="dt_start вне допустимого диапазона (01.01.2000 - сегодня)")
    if dt_end and (dt_end < datetime(2000, 1, 1) or dt_end > current_date):
        raise HTTPException(status_code=400, detail="dt_end вне допустимого диапазона (01.01.2000 - сегодня)")
    if dt_start and dt_end and dt_end < dt_start:
        raise HTTPException(status_code=400, detail="dt_end не может быть раньше dt_start")

    try:
        ck_fr_id = 1
        username = "test_user"  # Заглушка — в реальности: username = Depends(get_username)
        async with get_db() as conn:
            db_service = CkReportsDBService(conn)
            has_access = await db_service.check_user_access_to_ck_report(ck_fr_id, username)
            if not has_access:
                raise HTTPException(status_code=403, detail="Нет доступа к акту")

            # Здесь вызов метода репозитория, например:
            # data = await db_service.get_fr_data_by_code_metric(code_metric, dt_start, dt_end)
            #
            # if not data:
            #     if dt_start or dt_end:
            #         raise HTTPException(status_code=406, detail="Запрос не дал результатов")
            #     else:
            #         raise HTTPException(status_code=404, detail="Ничего не найдено по code_metric")

            return {"data": []}  # Пока заглушка

    except KerberosTokenExpiredError:
        raise HTTPException(status_code=401, detail="Не верный тикет kerberos")
    except Exception as e:
        logger.exception(f"Ошибка в get_fr_data_by_code_metric: {e}")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")

@router.get("/get_fr_data_by_process_number")
async def get_fr_data_by_process_number(
        process_number: int,
        dt_start: Optional[datetime] = None,
        dt_end: Optional[datetime] = None
    ):
    """Вход:
    process_number: int
    dt_start: date (опционально)
    dt_end: date (опционально)

    Где dt_*, соответсвует дате реализации СЗ
    Если оба поля не заполнены выдать все по коду метрики
    Если не заполнена дата начала, значит с самой ранней по указанную дату
    Если не заполнена дата окончания, значит с указанной по текущую дату
    Выход:
    data: данные по таблице установленного формата по определенному коду метрики
    Ошибки:
    Bad request (400) - code_metric не соответсвует шаблону: \d{4} или неверный период (dt_* < 01-01-2000 или dt_* > текущей; dt_end < dt_start)
    Access denied (401) - протухший kinit
    Not Found (404) - по code_metric ничего не найдено (если не переданы dt_*)
    Not acceptable (406) - запрос не дал результатов (если в запросе переданы dt_*)
    Internal Server Error (500) - внутреняя ошибка
    """
    pass
