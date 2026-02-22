"""
Сервисы для домена актов.
"""

from app.services.acts.export_service import ExportService
from app.services.acts.storage_service import StorageService

__all__ = [
    "ExportService",
    "StorageService",
]
