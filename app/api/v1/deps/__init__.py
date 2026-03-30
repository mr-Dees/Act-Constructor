"""
Shared зависимости FastAPI (Depends) для API v1.

Доменные DI-зависимости живут в app/domains/*/deps.py.
"""

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import get_user_roles, require_domain_access, require_admin, invalidate_roles_cache

__all__ = [
    "get_username",
    "get_user_roles",
    "require_domain_access",
    "require_admin",
    "invalidate_roles_cache",
]
