"""Сервис управления файлами чата."""

import fnmatch
import logging
import uuid

from fastapi import HTTPException

from app.domains.chat.repositories.conversation_repository import ConversationRepository
from app.domains.chat.repositories.file_repository import FileRepository
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.service.file")


class FileService:
    """Бизнес-логика файлов чата."""

    def __init__(
        self,
        *,
        file_repo: FileRepository,
        conv_repo: ConversationRepository,
        settings: ChatDomainSettings,
    ):
        self.file_repo = file_repo
        self.conv_repo = conv_repo
        self.settings = settings

    def validate_file(
        self,
        *,
        filename: str,
        mime_type: str,
        file_size: int,
    ) -> None:
        """
        Валидирует параметры файла.

        Raises:
            HTTPException(422): если файл не проходит валидацию.
        """
        if file_size > self.settings.max_file_size:
            max_mb = self.settings.max_file_size / (1024 * 1024)
            raise HTTPException(
                status_code=422,
                detail=f"Файл '{filename}' слишком большой (максимум {max_mb:.0f} МБ).",
            )

        allowed = any(
            fnmatch.fnmatch(mime_type, pattern)
            for pattern in self.settings.allowed_mime_types
        )
        if not allowed:
            raise HTTPException(
                status_code=422,
                detail=f"Тип файла '{mime_type}' не поддерживается.",
            )

    async def save_file(
        self,
        *,
        conversation_id: str,
        user_id: str,
        filename: str,
        mime_type: str,
        file_data: bytes,
    ) -> dict:
        """
        Сохраняет файл: проверяет принадлежность беседы, валидирует и создаёт запись.

        Raises:
            HTTPException(404): если беседа не найдена.
            HTTPException(422): если файл не проходит валидацию.
        """
        conversation = await self.conv_repo.get_by_id(conversation_id, user_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="Беседа не найдена")

        file_size = len(file_data)
        self.validate_file(filename=filename, mime_type=mime_type, file_size=file_size)

        file_id = str(uuid.uuid4())
        return await self.file_repo.create(
            id=file_id,
            conversation_id=conversation_id,
            filename=filename,
            mime_type=mime_type,
            file_size=file_size,
            file_data=file_data,
        )

    async def get_file(self, *, file_id: str, user_id: str) -> dict:
        """
        Возвращает файл с данными.

        Raises:
            HTTPException(404): если файл не найден или не принадлежит пользователю.
        """
        file_data = await self.file_repo.get_file_data(file_id=file_id, user_id=user_id)
        if not file_data:
            raise HTTPException(status_code=404, detail="Файл не найден")
        return file_data
