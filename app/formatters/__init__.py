"""
Форматеры.

Доменные форматеры живут в app/domains/*/formatters/.
Здесь остается только shared BaseFormatter и utils.
"""

from app.formatters.base_formatter import BaseFormatter

__all__ = [
    "BaseFormatter",
]
