"""
Репозитории доступа к данным.

Доменные репозитории живут в app/domains/*/repositories/.
Здесь остается только shared BaseRepository.
"""

from app.db.repositories.base import BaseRepository

__all__ = [
    "BaseRepository",
]
