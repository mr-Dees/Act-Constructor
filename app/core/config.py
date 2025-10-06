"""Конфигурация приложения."""

from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Настройки приложения."""

    # Основные настройки
    app_title: str = "Конструктор актов"
    app_version: str = "1.0.0"

    # API версионирование
    api_v1_prefix: str = "/api/v1"

    # Пути
    base_dir: Path = Path(__file__).parent.parent.parent
    templates_dir: Path = base_dir / "templates"
    static_dir: Path = base_dir / "static"
    storage_dir: Path = base_dir / "DB" / "acts"

    # Настройки сервера
    host: str = "0.0.0.0"
    port: int = 8000

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()

# Создаем директорию для хранения актов при запуске
settings.storage_dir.mkdir(parents=True, exist_ok=True)
