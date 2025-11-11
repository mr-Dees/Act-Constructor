"""
Бизнес-логика приложения.

Содержит сервисы для работы с актами и хранилищем файлов.
"""

from app.services.act_service import ActService
from app.services.storage_service import StorageService

__all__ = [
    'ActService',
    'StorageService',
]
