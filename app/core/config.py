"""
Конфигурация приложения.

Содержит настройки путей, параметров сервера и других констант.
Использует переменные окружения из .env файла.
"""

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Класс настроек приложения на основе Pydantic.

    Автоматически загружает переменные из .env файла
    и предоставляет типизированный доступ к конфигурации.
    """

    # Метаданные приложения
    app_title: str = "Act Constructor"
    app_version: str = "1.0.0"

    # Параметры сервера
    host: str = "0.0.0.0"
    port: int = 8000

    # Префикс для API версии 1
    api_v1_prefix: str = "/api/v1"

    # Базовая директория проекта (Относительный путь от конфига до корня проекта)
    base_dir: Path = Path(__file__).resolve().parent.parent.parent

    # Директория для хранения файлов актов
    storage_dir: Path = base_dir / "DB" / "acts"

    # Директория с HTML-шаблонами
    templates_dir: Path = base_dir / "templates"

    # Директория со статическими файлами (CSS, JS)
    static_dir: Path = base_dir / "static"

    class Config:
        """Конфигурация Pydantic."""
        env_file = ".env"  # Файл с переменными окружения
        case_sensitive = False  # Нечувствительность к регистру переменных


# Глобальный экземпляр настроек
settings = Settings()
