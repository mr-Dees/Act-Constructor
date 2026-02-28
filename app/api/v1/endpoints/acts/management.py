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
from app.core.exceptions import ActConstructorError, AccessDeniedError, InsufficientRightsError
from app.db.connection import get_db
from app.db.repositories.acts import ActCrudRepository, ActLockRepository, ActAccessRepository
from app.schemas.acts.act_metadata import ActCreate, ActUpdate, ActListItem, ActResponse, AuditPointIdsRequest
from app.services.audit_id_service import AuditIdService

logger = logging.getLogger("act_constructor.api.acts")
router = APIRouter()


def _format_validation_error(e: ValidationError) -> str:
    """Форматирует ошибки Pydantic ValidationError в читаемую строку."""
    return "; ".join(
        f"{' → '.join(str(l) for l in err['loc'])}: {err['msg']}"
        for err in e.errors()
    )


def _handle_unique_violation(
        e: UniqueViolationError,
        km_number: str | None = None,
        part_number: int | None = None,
        total_parts: int | None = None,
) -> None:
    """Обрабатывает UniqueViolationError из БД, выбрасывает HTTPException 409."""
    error_detail = str(e)
    if "acts_km_part_unique" in error_detail and km_number:
        logger.warning(f"Конфликт уникальности КМ: {error_detail}")
        if total_parts:
            detail_msg = f"Акт с КМ '{km_number}' (часть {part_number} из {total_parts}) уже существует"
        else:
            detail_msg = f"Акт с КМ '{km_number}' (часть {part_number}) уже существует"
        raise HTTPException(status_code=409, detail=detail_msg)
    logger.error(f"Ошибка уникальности: {error_detail}")
    raise HTTPException(status_code=409, detail="Акт с такими данными уже существует")


@router.get("/list", response_model=list[ActListItem])
async def list_user_acts(username: str = Depends(get_username)):
    """Получает список актов пользователя (только те, где участвует)."""
    try:
        async with get_db() as conn:
            crud = ActCrudRepository(conn)
            acts = await crud.get_user_acts(username)
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
        access = ActAccessRepository(conn)
        lock = ActLockRepository(conn)

        # Проверяем доступ и права на редактирование
        permission = await access.get_user_edit_permission(act_id, username)
        if not permission["has_access"]:
            raise AccessDeniedError("Нет доступа к акту")
        if not permission["can_edit"]:
            raise InsufficientRightsError(
                "Недостаточно прав для редактирования. Роль 'Участник' имеет доступ только для просмотра."
            )

        lock_info = await lock.lock_act(act_id, username)
        return lock_info


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
        access = ActAccessRepository(conn)
        lock = ActLockRepository(conn)

        has_access = await access.check_user_access(act_id, username)
        if not has_access:
            raise AccessDeniedError("Нет доступа к акту")

        await lock.unlock_act(act_id, username)

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
        access = ActAccessRepository(conn)
        lock_repo = ActLockRepository(conn)

        # Проверяем доступ и права на редактирование
        permission = await access.get_user_edit_permission(act_id, username)
        if not permission["has_access"]:
            raise AccessDeniedError("Нет доступа к акту")
        if not permission["can_edit"]:
            raise InsufficientRightsError("Недостаточно прав для редактирования")

        lock_info = await lock_repo.extend_lock(act_id, username)
        return lock_info


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
            crud = ActCrudRepository(conn)
            new_act = await crud.create_act(act_data, username, force_new_part)
            logger.info(
                f"Создан акт ID={new_act.id}, КМ={new_act.km_number}, "
                f"часть {new_act.part_number}/{new_act.total_parts}, "
                f"пользователем {username}"
            )
            return new_act

    except ValidationError as e:
        error_message = _format_validation_error(e)
        logger.warning(f"Ошибка валидации при создании акта: {error_message}")
        raise HTTPException(status_code=422, detail=error_message)

    except UniqueViolationError as e:
        _handle_unique_violation(e, act_data.km_number, act_data.part_number, act_data.total_parts)

    except ActConstructorError:
        raise

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
    async with get_db() as conn:
        access = ActAccessRepository(conn)
        crud = ActCrudRepository(conn)

        has_access = await access.check_user_access(act_id, username)
        if not has_access:
            raise AccessDeniedError("Нет доступа к акту")

        return await crud.get_act_by_id(act_id)


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
            access = ActAccessRepository(conn)
            crud = ActCrudRepository(conn)

            # Проверяем доступ и права на редактирование
            permission = await access.get_user_edit_permission(act_id, username)
            if not permission["has_access"]:
                raise AccessDeniedError("У вас нет доступа к этому акту")
            if not permission["can_edit"]:
                raise InsufficientRightsError("Недостаточно прав для редактирования")

            updated_act = await crud.update_act_metadata(
                act_id, act_update, username
            )
            logger.info(f"Акт ID={act_id} обновлен пользователем {username}")
            return updated_act

    except ValidationError as e:
        error_message = _format_validation_error(e)
        logger.warning(f"Ошибка валидации при обновлении акта: {error_message}")
        raise HTTPException(status_code=422, detail=error_message)

    except UniqueViolationError as e:
        _handle_unique_violation(e, act_update.km_number, act_update.part_number, act_update.total_parts)

    except ActConstructorError:
        raise

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
    async with get_db() as conn:
        access = ActAccessRepository(conn)
        crud = ActCrudRepository(conn)

        # Проверяем доступ к акту (can_edit НЕ требуется для дублирования)
        # Участник может дублировать акт - он станет Редактором в новом акте
        permission = await access.get_user_edit_permission(act_id, username)
        if not permission["has_access"]:
            raise AccessDeniedError("Нет доступа к акту")

        return await crud.duplicate_act(act_id, username)


@router.post("/{act_id}/audit-point-ids")
async def generate_audit_point_ids(
        act_id: int,
        request: AuditPointIdsRequest,
        username: str = Depends(get_username)
):
    """
    Генерирует audit_point_id для списка узлов дерева акта.

    Args:
        act_id: ID акта
        request: Список node_id для генерации
        username: Имя пользователя (из зависимости)

    Returns:
        Словарь {node_id: audit_point_id}
    """
    async with get_db() as conn:
        access = ActAccessRepository(conn)

        has_access = await access.check_user_access(act_id, username)
        if not has_access:
            raise AccessDeniedError("Нет доступа к акту")

        return await AuditIdService.generate_audit_point_ids(request.node_ids)


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
    async with get_db() as conn:
        access = ActAccessRepository(conn)
        crud = ActCrudRepository(conn)

        # Проверяем доступ и права на редактирование
        permission = await access.get_user_edit_permission(act_id, username)
        if not permission["has_access"]:
            raise AccessDeniedError("Нет доступа к акту")
        if not permission["can_edit"]:
            raise InsufficientRightsError("Недостаточно прав для удаления акта")

        await crud.delete_act(act_id)
        logger.info(f"Удален акт ID={act_id} пользователем {username}")
        return {"success": True, "message": "Акт успешно удален"}
