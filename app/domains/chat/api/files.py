"""Эндпоинты файлов чата."""

import logging
from urllib.parse import quote

from fastapi import APIRouter, Depends, Response

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import require_domain_access
from app.domains.chat.deps import get_file_service
from app.domains.chat.services.file_service import FileService

logger = logging.getLogger("audit_workstation.domains.chat.api.files")

# Защита роли крепится явно на роутер (defense in depth) — см. конфигурацию
# в conversations.py.
router = APIRouter(dependencies=[Depends(require_domain_access("chat"))])


@router.get(
    "/limits",
    summary="Лимиты файлов чата",
)
async def get_chat_limits(
    file_service: FileService = Depends(get_file_service),
    _: str = Depends(get_username),
):
    """Возвращает лимиты файлов из настроек чата.

    Фронт читает один раз при инициализации, чтобы синхронизировать UI-валидацию
    с серверной (та же ChatFileValidationError, что и в FileService.validate_file).
    """
    settings = file_service.settings
    return {
        "max_file_size": settings.max_file_size,
        "max_total_file_size": settings.max_total_file_size,
        "max_files_per_message": settings.max_files_per_message,
    }


@router.get(
    "/files/{file_id}",
    summary="Скачать файл",
)
async def download_file(
    file_id: str,
    inline: bool = False,
    username: str = Depends(get_username),
    file_service: FileService = Depends(get_file_service),
):
    """Возвращает файл для скачивания или предпросмотра."""
    file_data = await file_service.get_file(file_id=file_id, user_id=username)

    filename_encoded = quote(file_data["filename"])
    disposition = "inline" if inline else "attachment"
    return Response(
        content=file_data["file_data"],
        media_type=file_data["mime_type"],
        headers={
            "Content-Disposition": (
                f"{disposition}; filename*=UTF-8''{filename_encoded}"
            ),
        },
    )
