"""
Эндпоинты для работы с актами.

Предоставляет HTTP API для сохранения актов в различных форматах
и скачивания сохраненных файлов.
"""

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, Query, HTTPException, Depends
from fastapi.responses import FileResponse

from app.api.v1.deps.auth_deps import get_username
from app.core.config import get_settings, Settings
from app.core.exceptions import AppError
from app.db.connection import get_db
from app.domains.acts.deps import _get_acts_settings
from app.domains.acts.repositories.act_access import ActAccessRepository
from app.domains.acts.repositories.act_audit_log import ActAuditLogRepository
from app.domains.acts.settings import ActsSettings
from app.domains.acts.utils import ActTreeUtils
from app.domains.acts.schemas.act_content import ActDataSchema, ActSaveResponse
from app.domains.acts.services.export_service import ExportService
from app.domains.acts.services.storage_service import StorageService
from app.schemas.errors import ErrorDetail

logger = logging.getLogger("act_constructor.api.export")
router = APIRouter()

_download_semaphore: asyncio.Semaphore | None = None


def _get_download_semaphore(acts_cfg: ActsSettings) -> asyncio.Semaphore:
    """Возвращает per-worker семафор для ограничения файловых операций."""
    global _download_semaphore
    if _download_semaphore is None:
        _download_semaphore = asyncio.Semaphore(acts_cfg.resource.max_concurrent_file_operations)
        logger.info(f"File semaphore создан для worker: {acts_cfg.resource.max_concurrent_file_operations}")
    return _download_semaphore


def get_storage_service(settings: Settings = Depends(get_settings)) -> StorageService:
    """Создает экземпляр StorageService для dependency injection."""
    return StorageService(storage_dir=settings.storage_dir)


def get_act_service(
        storage: StorageService = Depends(get_storage_service),
        settings: Settings = Depends(get_settings),
        acts_settings: ActsSettings = Depends(_get_acts_settings),
) -> ExportService:
    """Создает экземпляр ExportService для dependency injection."""
    return ExportService(storage=storage, settings=settings, acts_settings=acts_settings)


@router.post(
    "/save-act",
    response_model=ActSaveResponse,
    responses={
        400: {"description": "Превышена глубина дерева или неподдерживаемый формат", "model": ErrorDetail},
        408: {"description": "Таймаут обработки акта", "model": ErrorDetail},
        422: {"description": "Ошибка валидации входных данных"},
        500: {"description": "Внутренняя ошибка при сохранении", "model": ErrorDetail},
    },
)
async def save_act(
        data: ActDataSchema,
        fmt: Literal["txt", "md", "docx"] = Query(
            "txt",
            description="Формат сохранения файла"
        ),
        act_id: int | None = Query(
            None,
            description="ID акта для контроля доступа при скачивании"
        ),
        username: str = Depends(get_username),
        act_service: ExportService = Depends(get_act_service),
        storage: StorageService = Depends(get_storage_service),
        settings: Settings = Depends(get_settings),
        acts_cfg: ActsSettings = Depends(_get_acts_settings),
) -> ActSaveResponse:
    """
    Сохраняет структуру акта в указанном формате.

    Args:
        data: Данные акта (дерево структуры, таблицы, текстовые блоки,
            нарушения)
        fmt: Формат экспорта - 'txt', 'md' или 'docx'
        act_id: ID акта для привязки файла к контролю доступа
        username: Имя пользователя (из авторизации)
        act_service: Сервис для работы с актами (injected)
        storage: Сервис хранения файлов (injected)
        settings: Настройки приложения (injected)

    Returns:
        Результат операции с именем сохраненного файла

    Raises:
        HTTPException: При ошибках валидации (400), timeout (408) или ошибке сохранения (500)
    """
    try:
        logger.info(f"Запрос на сохранение акта в формате {fmt}")

        # Валидация глубины дерева (защита от рекурсии)
        tree_depth = ActTreeUtils.calculate_tree_depth(data.tree)
        if tree_depth > acts_cfg.resource.max_tree_depth:
            logger.warning(f"Превышена максимальная глубина дерева: {tree_depth}")
            raise HTTPException(
                status_code=400,
                detail=f"Глубина дерева ({tree_depth}) превышает максимум ({acts_cfg.resource.max_tree_depth})"
            )

        # Используем mode='python' для оптимизации.
        # Конвертируем только необходимые поля без лишней сериализации.
        data_dict = data.model_dump(mode='python')

        # Проверяем что пришло
        logger.debug(f"Получено таблиц: {len(data_dict.get('tables', {}))}")
        logger.debug(f"Получено текстовых блоков: {len(data_dict.get('textBlocks', {}))}")
        logger.debug(f"Получено нарушений: {len(data_dict.get('violations', {}))}")
        logger.debug(f"Глубина дерева: {tree_depth}")

        # Добавлен timeout для всей операции
        try:
            result = await asyncio.wait_for(
                act_service.save_act(data_dict, fmt=fmt),
                timeout=acts_cfg.resource.save_act_timeout
            )
        except asyncio.TimeoutError:
            logger.error(f"Timeout при сохранении акта (>{acts_cfg.resource.save_act_timeout}s)")
            raise HTTPException(
                status_code=408,
                detail=f"Обработка акта заняла слишком много времени "
                       f"(>{acts_cfg.resource.save_act_timeout}s). Попробуйте упростить структуру."
            )

        logger.info(f"Акт успешно сохранен: {result.filename}")

        # Регистрируем связь файла с актом для контроля доступа при скачивании
        if act_id is not None:
            storage.register_file(result.filename, act_id)

            # Аудит-лог экспорта
            try:
                async with get_db() as audit_conn:
                    audit = ActAuditLogRepository(audit_conn)
                    await audit.log("export", username, act_id, {
                        "format": fmt,
                        "filename": result.filename,
                    })
            except Exception:
                logger.exception("Не удалось записать аудит-лог экспорта")

        return result

    except HTTPException:
        raise
    except AppError:
        raise
    except Exception as e:
        # Неожиданная ошибка при сохранении
        logger.exception(f"Неожиданная ошибка при сохранении акта: {e}")
        # В production не показываем внутренние детали
        raise HTTPException(
            status_code=500,
            detail="Произошла ошибка при сохранении акта. Попробуйте позже."
        )


@router.get(
    "/download/{filename}",
    responses={
        400: {"description": "Некорректное имя файла", "model": ErrorDetail},
        403: {"description": "Нет доступа к файлу", "model": ErrorDetail},
        404: {"description": "Файл не найден", "model": ErrorDetail},
        500: {"description": "Ошибка при скачивании файла", "model": ErrorDetail},
    },
)
async def download_act(
        filename: str,
        username: str = Depends(get_username),
        storage: StorageService = Depends(get_storage_service),
        settings: Settings = Depends(get_settings),
        acts_cfg: ActsSettings = Depends(_get_acts_settings),
) -> FileResponse:
    """
    Скачивает сохраненный файл акта.

    Проверяет авторизацию пользователя и его доступ к акту,
    которому принадлежит файл. Использует per-worker semaphore
    для ограничения одновременных файловых операций.

    Args:
        filename: Имя файла для скачивания
        username: Имя пользователя (из авторизации)
        storage: Сервис хранения (injected)
        settings: Настройки приложения (injected)
        acts_cfg: Доменные настройки актов (injected)

    Returns:
        Файл для скачивания с корректным MIME-типом

    Raises:
        HTTPException: 401 без авторизации, 403 нет доступа,
            400 небезопасное имя, 404 файл не найден
    """
    async with _get_download_semaphore(acts_cfg):
        try:
            logger.info(f"Запрос на скачивание файла: {filename} от пользователя {username}")

            # Валидация и получение безопасного пути
            file_path = storage.get_file_path(filename)
            if file_path is None:
                is_valid = storage.validate_filename(filename)
                status_code = 400 if not is_valid else 404
                detail = "Некорректное имя файла" if not is_valid else "Файл не найден"
                logger.warning(f"Отказ в доступе к файлу: {filename} (код: {status_code})")
                raise HTTPException(status_code=status_code, detail=detail)

            # Проверка доступа пользователя к акту, которому принадлежит файл
            act_id = storage.get_act_id_for_file(filename)
            if act_id is not None:
                async with get_db() as conn:
                    access_repo = ActAccessRepository(conn)
                    has_access = await access_repo.check_user_access(act_id, username)
                    if not has_access:
                        logger.warning(
                            f"Отказ в скачивании файла {filename}: "
                            f"пользователь {username} не имеет доступа к акту {act_id}"
                        )
                        raise HTTPException(
                            status_code=403,
                            detail="Нет доступа к файлу"
                        )

                    # Аудит-лог скачивания
                    audit = ActAuditLogRepository(conn)
                    await audit.log("download", username, act_id, {
                        "filename": filename,
                    })

            # Определяем MIME-тип по расширению файла
            mime_types = {
                '.txt': 'text/plain',
                '.md': 'text/markdown',
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            }
            media_type = mime_types.get(
                file_path.suffix,
                'application/octet-stream'
            )

            logger.info(f"Файл {filename} отправлен на скачивание пользователю {username}")

            # Возвращаем файл для скачивания
            return FileResponse(
                path=file_path,
                media_type=media_type,
                filename=filename
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.exception(f"Ошибка при скачивании файла {filename}: {e}")
            raise HTTPException(
                status_code=500,
                detail="Произошла ошибка при скачивании файла"
            )
