"""Эндпоинты файлов чата."""

import logging
from urllib.parse import quote

from fastapi import APIRouter, Depends, Response

from app.api.v1.deps.auth_deps import get_username
from app.domains.chat.deps import get_file_service
from app.domains.chat.services.file_service import FileService

logger = logging.getLogger("audit_workstation.domains.chat.api.files")

router = APIRouter()


@router.get(
    "/files/{file_id}",
    summary="Скачать файл",
)
async def download_file(
    file_id: str,
    username: str = Depends(get_username),
    file_service: FileService = Depends(get_file_service),
):
    """Возвращает файл для скачивания."""
    file_data = await file_service.get_file(file_id=file_id, user_id=username)

    filename_encoded = quote(file_data["filename"])
    return Response(
        content=file_data["file_data"],
        media_type=file_data["mime_type"],
        headers={
            "Content-Disposition": (
                f"attachment; filename*=UTF-8''{filename_encoded}"
            ),
        },
    )
