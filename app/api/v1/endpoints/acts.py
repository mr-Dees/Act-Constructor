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

from asyncpg import UniqueViolationError
from fastapi import APIRouter, HTTPException, Depends
from pydantic import ValidationError

from app.api.v1.deps.auth_deps import get_username
from app.db.connection import get_db
from app.db.repositories.act_repository import ActDBService
from app.schemas.act_metadata import ActCreate, ActUpdate, ActListItem, ActResponse

logger = logging.getLogger("act_constructor.api.acts")
router = APIRouter()


@router.get("/list", response_model=list[ActListItem])
async def list_user_acts(username: str = Depends(get_username)):
    """Получает список актов пользователя (только те, где участвует)."""
    try:
        async with get_db() as conn:
            db_service = ActDBService(conn)
            acts = await db_service.get_user_acts(username)
            logger.info(f"Получен список актов для {username}: {len(acts)} шт.")
            return acts
    except Exception as e:
        logger.exception(f"Ошибка получения списка актов: {e}")
        raise HTTPException(status_code=500, detail="Ошибка получения списка актов")


@router.post("/{act_id}/lock", status_code=200)
async def lock_act(
        act_id: int,
        username: str = Depends(get_username)
):
    """
    Блокирует акт для редактирования текущим пользователем.

    Логика:
    - Проверяет доступ пользователя к акту
    - Проверяет не заблокирован ли акт другим пользователем
    - Если заблокирован текущим пользователем - продлевает блокировку
    - Если блокировка истекла - снимает и создает новую
    - Устанавливает блокировку на 30 минут

    Returns:
        {
            "success": true,
            "locked_until": "2025-12-08T13:35:00",
            "message": "Акт заблокирован для редактирования"
        }

    Raises:
        403: Нет доступа к акту
        409: Акт уже редактируется другим пользователем
    """
    async with get_db() as conn:
        db_service = ActDBService(conn)

        # Проверяем доступ
        has_access = await db_service.check_user_access(act_id, username)
        if not has_access:
            raise HTTPException(status_code=403, detail="Нет доступа к акту")

        try:
            lock_info = await db_service.lock_act(act_id, username)
            return lock_info

        except ValueError as e:
            # Акт заблокирован другим пользователем
            raise HTTPException(status_code=409, detail=str(e))


@router.post("/{act_id}/unlock", status_code=200)
async def unlock_act(
        act_id: int,
        username: str = Depends(get_username)
):
    """
    Снимает блокировку с акта.

    Может снять блокировку только тот пользователь, который ее установил.
    """
    async with get_db() as conn:
        db_service = ActDBService(conn)

        has_access = await db_service.check_user_access(act_id, username)
        if not has_access:
            raise HTTPException(status_code=403, detail="Нет доступа к акту")

        await db_service.unlock_act(act_id, username)

        return {
            "success": True,
            "message": "Блокировка снята"
        }


@router.post("/{act_id}/extend-lock", status_code=200)
async def extend_lock(
        act_id: int,
        username: str = Depends(get_username)
):
    """
    Продлевает блокировку акта на 30 минут.

    Вызывается:
    - При взаимодействии пользователя с актом (автоматически)
    - При нажатии "Продлить" в диалоге предупреждения
    """
    async with get_db() as conn:
        db_service = ActDBService(conn)

        has_access = await db_service.check_user_access(act_id, username)
        if not has_access:
            raise HTTPException(status_code=403, detail="Нет доступа к акту")

        try:
            lock_info = await db_service.extend_lock(act_id, username)
            return lock_info

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.post("/create", response_model=ActResponse, status_code=201)
async def create_act(
        act_data: ActCreate,
        username: str = Depends(get_username),
        force_new_part: bool = False
):
    """
    Создает новый акт с метаданными и связанными сущностями.

    Args:
        act_data: Данные для создания акта
        username: Имя пользователя (из зависимости)
        force_new_part: Если True, создает новую часть существующего КМ

    Returns:
        Созданный акт с полными метаданными

    Raises:
        HTTPException: 409 если КМ уже существует и force_new_part=False
        HTTPException: 422 при ошибках валидации
        HTTPException: 500 при внутренних ошибках
    """
    try:
        async with get_db() as conn:
            db_service = ActDBService(conn)

            # Проверяем существование КМ
            km_info = await db_service.check_km_exists(act_data.km_number)

            if km_info['exists'] and not force_new_part:
                # КМ существует, но force_new_part=False
                # Возвращаем специальный статус для диалога на фронте
                raise HTTPException(
                    status_code=409,
                    detail={
                        "type": "km_exists",
                        "message": f"Акт с КМ '{act_data.km_number}' уже существует",
                        "km_number": act_data.km_number,
                        "current_parts": km_info['current_parts'],
                        "next_part": km_info['next_part']
                    }
                )

            new_act = await db_service.create_act(act_data, username, force_new_part)
            logger.info(
                f"Создан акт ID={new_act.id}, КМ={new_act.km_number}, "
                f"часть {new_act.part_number}/{new_act.total_parts}, "
                f"пользователем {username}"
            )
            return new_act

    except HTTPException:
        raise

    except ValidationError as e:
        error_details = []
        for err in e.errors():
            loc = " → ".join(str(l) for l in err["loc"])
            error_details.append(f"{loc}: {err['msg']}")

        error_message = "; ".join(error_details)
        logger.warning(f"Ошибка валидации при создании акта: {error_message}")
        raise HTTPException(status_code=422, detail=error_message)

    except UniqueViolationError as e:
        error_detail = str(e)
        logger.error(f"Ошибка уникальности при создании акта: {error_detail}")
        raise HTTPException(
            status_code=409,
            detail="Акт с такими данными уже существует"
        )

    except ValueError as e:
        error_msg = str(e)
        logger.warning(f"Ошибка валидации при создании акта: {error_msg}")
        raise HTTPException(status_code=400, detail=error_msg)

    except Exception as e:
        logger.error(f"Ошибка создания акта: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Не удалось создать акт. Проверьте корректность данных."
        )


@router.get("/{act_id}", response_model=ActResponse)
async def get_act(
        act_id: int,
        username: str = Depends(get_username)
):
    """
    Получает полную информацию об акте.

    Args:
        act_id: ID акта
        username: Имя пользователя (из зависимости)

    Returns:
        Полная информация об акте с метаданными

    Raises:
        HTTPException: 403 если нет доступа к акту
        HTTPException: 404 если акт не найден
    """
    try:
        async with get_db() as conn:
            db_service = ActDBService(conn)
            has_access = await db_service.check_user_access(act_id, username)
            if not has_access:
                raise HTTPException(status_code=403, detail="Нет доступа к акту")

            return await db_service.get_act_by_id(act_id)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception(f"Ошибка получения акта ID={act_id}: {e}")
        raise HTTPException(status_code=500, detail="Ошибка получения акта")


@router.patch("/{act_id}", response_model=ActResponse)
async def update_act_metadata(
        act_id: int,
        act_update: ActUpdate,
        username: str = Depends(get_username)
):
    """
    Обновляет метаданные акта (частичное обновление).

    Args:
        act_id: ID акта
        act_update: Данные для обновления (только заполненные поля)
        username: Имя пользователя (из зависимости)

    Returns:
        Обновленный акт с полными метаданными

    Raises:
        HTTPException: 403 если нет доступа к акту
        HTTPException: 409 при конфликте уникальности
        HTTPException: 422 при ошибках валидации
    """
    try:
        async with get_db() as conn:
            db_service = ActDBService(conn)

            has_access = await db_service.check_user_access(act_id, username)
            if not has_access:
                raise HTTPException(
                    status_code=403,
                    detail="У вас нет доступа к этому акту"
                )

            updated_act = await db_service.update_act_metadata(
                act_id, act_update, username
            )
            logger.info(f"Акт ID={act_id} обновлен пользователем {username}")
            return updated_act

    except HTTPException:
        raise

    except ValidationError as e:
        # Детальная обработка ошибок валидации Pydantic
        error_details = []
        for err in e.errors():
            loc = " → ".join(str(l) for l in err["loc"])
            error_details.append(f"{loc}: {err['msg']}")

        error_message = "; ".join(error_details)
        logger.warning(f"Ошибка валидации при обновлении акта: {error_message}")
        raise HTTPException(status_code=422, detail=error_message)

    except UniqueViolationError as e:
        error_detail = str(e)

        if "acts_km_part_unique" in error_detail:
            logger.warning(f"Попытка изменить акт на дубликат: {error_detail}")

            km_value = act_update.km_number or "указанный КМ"
            part_value = act_update.part_number or "указанная часть"
            total_value = act_update.total_parts or ""

            if total_value:
                detail_msg = f"Акт с КМ '{km_value}' (часть {part_value} из {total_value}) уже существует"
            else:
                detail_msg = f"Акт с КМ '{km_value}' (часть {part_value}) уже существует"

            raise HTTPException(status_code=409, detail=detail_msg)

        logger.error(f"Ошибка уникальности при обновлении акта: {error_detail}")
        raise HTTPException(
            status_code=409,
            detail="Акт с такими данными уже существует"
        )

    except ValueError as e:
        error_msg = str(e)
        logger.warning(f"Ошибка валидации при обновлении акта: {error_msg}")
        raise HTTPException(status_code=400, detail=error_msg)

    except Exception as e:
        logger.error(f"Ошибка обновления акта ID={act_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Не удалось обновить акт. Проверьте корректность данных."
        )


@router.post("/{act_id}/duplicate", response_model=ActResponse)
async def duplicate_act(
        act_id: int,
        username: str = Depends(get_username)
):
    """
    Создает дубликат акта с автоматически сгенерированным названием.

    Новое название формируется как:
    - "Название проверки (Копия)" - для первой копии
    - "Название проверки (Копия 2)" - для второй копии
    - и так далее

    Args:
        act_id: ID акта для дублирования
        username: Имя пользователя (из зависимости)

    Returns:
        Новый акт (дубликат) с обновленным названием

    Raises:
        HTTPException: 403 если нет доступа к акту
        HTTPException: 404 если акт не найден
    """
    try:
        async with get_db() as conn:
            db_service = ActDBService(conn)
            has_access = await db_service.check_user_access(act_id, username)
            if not has_access:
                raise HTTPException(status_code=403, detail="Нет доступа к акту")

            return await db_service.duplicate_act(act_id, username)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Ошибка дублирования акта ID={act_id}: {e}")
        raise HTTPException(status_code=500, detail="Ошибка дублирования акта")


@router.delete("/{act_id}")
async def delete_act(
        act_id: int,
        username: str = Depends(get_username)
):
    """
    Удаляет акт и все связанные данные.

    Требует подтверждения на фронтенде.
    Каскадное удаление обрабатывается на уровне БД через ON DELETE CASCADE.

    Args:
        act_id: ID акта для удаления
        username: Имя пользователя (из зависимости)

    Returns:
        Сообщение об успешном удалении

    Raises:
        HTTPException: 403 если нет доступа к акту
        HTTPException: 404 если акт не найден
    """
    try:
        async with get_db() as conn:
            db_service = ActDBService(conn)
            has_access = await db_service.check_user_access(act_id, username)
            if not has_access:
                raise HTTPException(status_code=403, detail="Нет доступа к акту")

            await db_service.delete_act(act_id)
            logger.info(f"Удален акт ID={act_id} пользователем {username}")
            return {"success": True, "message": "Акт успешно удален"}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception(f"Ошибка удаления акта ID={act_id}: {e}")
        raise HTTPException(status_code=500, detail="Ошибка удаления акта")
