"""
Ядро приложения.

Содержит конфигурацию и базовые компоненты системы.
"""

from app.core.config import Settings, get_settings, setup_logging

__all__ = [
    "Settings",
    "get_settings",
    "setup_logging",
]
