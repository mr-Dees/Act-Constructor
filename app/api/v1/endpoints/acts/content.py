"""
API эндпоинты для работы с содержимым актов.

Предоставляет операции загрузки и сохранения структурированного содержимого:
- Метаданные акта
- Дерево структуры акта (tree)
- Таблицы (tables)
- Текстовые блоки (textBlocks)
- Нарушения (violations)

Авторизация и проверка доступа к акту осуществляется через зависимость get_username.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.deps.auth_deps import get_username
from app.core.exceptions import ActConstructorError, AccessDeniedError, InsufficientRightsError
from app.db.connection import get_db
from app.db.repositories.acts import ActAccessRepository, ActContentRepository, ActCrudRepository, ActInvoiceRepository
from app.schemas.acts.act_content import ActDataSchema

logger = logging.getLogger("act_constructor.api.content")
router = APIRouter()


@router.get("/{act_id}/content")
async def get_act_content(
        act_id: int,
        username: str = Depends(get_username)
) -> dict:
    """
    Получает полное содержимое акта для редактора.

    Загружает из БД:
    - Полные метаданные акта (ActResponse)
    - Дерево структуры (act_tree)
    - Таблицы (act_tables)
    - Текстовые блоки (act_textblocks)
    - Нарушения (act_violations)

    Args:
        act_id: ID акта
        username: Имя пользователя (из зависимости)

    Returns:
        Содержимое акта в формате {metadata, tree, tables, textBlocks, violations}

    Raises:
        HTTPException: 403 если нет доступа к акту
        HTTPException: 404 если акт не найден
        HTTPException: 500 при ошибках загрузки
    """
    try:
        async with get_db() as conn:
            access = ActAccessRepository(conn)
            crud = ActCrudRepository(conn)
            content_repo = ActContentRepository(conn)
            invoice_repo = ActInvoiceRepository(conn)

            # Проверяем доступ и получаем права пользователя
            permission = await access.get_user_edit_permission(act_id, username)
            if not permission["has_access"]:
                raise AccessDeniedError("Нет доступа к акту")

            # Получаем полные метаданные акта через ActResponse
            act_metadata = await crud.get_act_by_id(act_id)

            # Загружаем содержимое через репозиторий
            content = await content_repo.get_content(act_id)

            # Получаем фактуры
            invoices_list = await invoice_repo.get_invoices_for_act(act_id)
            invoices = {inv["node_id"]: inv for inv in invoices_list}

            logger.info(
                f"Загружено содержимое акта ID={act_id}, "
                f"КМ={act_metadata.km_number}, is_process_based={act_metadata.is_process_based}"
            )

            # Возвращаем метаданные + содержимое + права пользователя
            return {
                'metadata': act_metadata.model_dump(mode='json'),
                **content,
                'invoices': invoices,
                'userPermission': {
                    'canEdit': permission["can_edit"],
                    'role': permission["role"]
                }
            }

    except ActConstructorError:
        raise

    except Exception as e:
        logger.exception(f"Ошибка загрузки содержимого акта ID={act_id}: {e}")
        raise HTTPException(status_code=500, detail="Ошибка загрузки содержимого акта")


@router.put("/{act_id}/content")
async def save_act_content(
        act_id: int,
        data: ActDataSchema,
        username: str = Depends(get_username)
) -> dict:
    """
    Сохраняет содержимое акта.

    Обновляет в БД:
    - Дерево структуры (act_tree)
    - Таблицы (act_tables) - с пересозданием всех записей
    - Текстовые блоки (act_textblocks) - с пересозданием
    - Нарушения (act_violations) - с пересозданием
    - Метку last_edited_at и last_edited_by в таблице acts

    Args:
        act_id: ID акта
        data: Полное содержимое акта (валидировано через ActDataSchema)
        username: Имя пользователя (из зависимости)

    Returns:
        Сообщение об успешном сохранении

    Raises:
        HTTPException: 403 если нет доступа к акту
        HTTPException: 500 при ошибках сохранения
    """
    try:
        async with get_db() as conn:
            access = ActAccessRepository(conn)
            content_repo = ActContentRepository(conn)

            # Проверяем доступ и права на редактирование
            permission = await access.get_user_edit_permission(act_id, username)
            if not permission["has_access"]:
                raise AccessDeniedError("Нет доступа к акту")
            if not permission["can_edit"]:
                raise InsufficientRightsError(
                    "Недостаточно прав для сохранения. Роль 'Участник' имеет доступ только для просмотра."
                )

            return await content_repo.save_content(act_id, data, username)

    except ActConstructorError:
        raise

    except Exception as e:
        logger.exception(f"Ошибка сохранения содержимого акта ID={act_id}: {e}")
        raise HTTPException(status_code=500, detail="Ошибка сохранения содержимого акта")
