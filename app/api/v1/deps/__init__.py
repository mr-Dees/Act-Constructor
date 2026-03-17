"""
Shared зависимости FastAPI (Depends) для API v1.

Доменные DI-зависимости живут в app/domains/*/deps.py.
"""

from app.api.v1.deps.auth_deps import get_username

__all__ = [
    "get_username",
]
