"""
Конфигурация приложения.

Содержит настройки путей, параметров сервера и других констант.
Использует переменные окружения из .env файла.
"""

from pathlib import Path
from typing import ClassVar

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Базовая директория проекта (относительный путь от конфига до корня проекта)
    base_dir: ClassVar[Path] = Path(__file__).resolve().parent.parent.parent

    # Директория для хранения файлов актов
    @property
    def storage_dir(self) -> Path:
        """Директория для хранения актов с автоматическим созданием."""
        path = self.base_dir / "DB" / "acts"
        path.mkdir(parents=True, exist_ok=True)
        return path

    # Директория с HTML-шаблонами
    @property
    def templates_dir(self) -> Path:
        """Директория с шаблонами."""
        return self.base_dir / "templates"

    # Директория со статическими файлами (CSS, JS)
    @property
    def static_dir(self) -> Path:
        """Директория со статическими файлами."""
        return self.base_dir / "static"

    # Конфигурация Pydantic
    model_config = SettingsConfigDict(
        env_file=".env",  # Файл с переменными окружения
        case_sensitive=False,  # Нечувствительность к регистру переменных
        extra="ignore"  # Игнорировать неизвестные поля из .env
    )

    @field_validator("port")
    @classmethod
    def validate_port(cls, v: int) -> int:
        """Валидация номера порта."""
        if not 1 <= v <= 65535:
            raise ValueError("Порт должен быть в диапазоне 1-65535")
        return v

    def ensure_directories(self) -> None:
        """
        Создает все необходимые директории при инициализации.

        Вызывайте этот метод при запуске приложения для гарантии
        существования всех рабочих директорий.
        """
        # storage_dir создается автоматически через property
        _ = self.storage_dir

        # Проверяем существование критичных директорий
        if not self.templates_dir.exists():
            raise RuntimeError(
                f"Директория шаблонов не найдена: {self.templates_dir}"
            )
        if not self.static_dir.exists():
            raise RuntimeError(
                f"Директория статики не найдена: {self.static_dir}"
            )
