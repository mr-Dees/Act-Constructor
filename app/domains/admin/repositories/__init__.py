"""Репозитории домена администрирования."""

from app.domains.admin.repositories.admin_repository import AdminRepository
from app.domains.admin.repositories.http_metrics_repository import (
    HttpMetricsRepository,
)

__all__ = [
    "AdminRepository",
    "HttpMetricsRepository",
]
