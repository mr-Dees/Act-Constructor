"""
Конфигурация приложения.

Содержит настройки путей, параметров сервера и других констант.
Использует переменные окружения из .env файла.
"""

import logging
import sys
from functools import lru_cache
from pathlib import Path
from typing import ClassVar

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def setup_logging(log_level: str = "INFO") -> logging.Logger:
    """
    Настраивает систему логирования для приложения.

    Args:
        log_level: Уровень логирования (DEBUG, INFO, WARNING, ERROR, CRITICAL)

    Returns:
        Настроенный logger
    """
    logger = logging.getLogger("act_constructor")

    # Проверяем что логирование еще не настроено (защита от повторной настройки в workers)
    if logger.handlers:
        return logger

    logger.setLevel(getattr(logging, log_level.upper()))

    # Создаем форматер для логов
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # Настраиваем консольный handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(getattr(logging, log_level.upper()))

    # Настраиваем файловый handler
    log_dir = Path(__file__).resolve().parent.parent.parent / "logs"
    log_dir.mkdir(exist_ok=True)
    file_handler = logging.FileHandler(log_dir / "app.log", encoding='utf-8')
    file_handler.setFormatter(formatter)
    file_handler.setLevel(getattr(logging, log_level.upper()))

    # Добавляем handlers
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    # Отключаем propagation чтобы избежать дублирования в root logger
    logger.propagate = False

    return logger


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

    # Уровень логирования
    log_level: str = "INFO"

    # === Лимиты безопасности ===

    # Максимальный размер тела запроса в байтах (10MB по умолчанию)
    max_request_size: int = 10 * 1024 * 1024

    # Rate limiting: максимум запросов в минуту на IP
    rate_limit_per_minute: int = 1024

    # Максимальный размер изображения в MB
    max_image_size_mb: float = 10.0

    # Timeout для парсинга HTML в секундах
    html_parse_timeout: int = 30

    # Максимальная глубина вложенности HTML
    max_html_depth: int = 100

    # === Параметры форматирования ===

    # Ширина изображений в DOCX (в дюймах)
    docx_image_width: float = 4.0

    # Размер шрифта подписи в DOCX (в пунктах)
    docx_caption_font_size: int = 10

    # Максимальный уровень заголовков в DOCX
    docx_max_heading_level: int = 9

    # Ширина заголовка в текстовом формате (символов)
    text_header_width: int = 80

    # Размер отступа в текстовом формате (пробелов)
    text_indent_size: int = 2

    # Максимальный уровень заголовков в Markdown
    markdown_max_heading_level: int = 6

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
        extra="ignore",  # Игнорировать неизвестные поля из .env
        validate_default=False  # Оптимизация валидации
    )

    @field_validator("port")
    @classmethod
    def validate_port(cls, v: int) -> int:
        """Валидация номера порта."""
        if not 1 <= v <= 65535:
            raise ValueError("Порт должен быть в диапазоне 1-65535")
        return v

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Валидация уровня логирования."""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        v_upper = v.upper()
        if v_upper not in valid_levels:
            raise ValueError(f"log_level должен быть одним из: {', '.join(valid_levels)}")
        return v_upper

    @field_validator("max_request_size", "rate_limit_per_minute")
    @classmethod
    def validate_positive(cls, v: int) -> int:
        """Валидация положительных значений."""
        if v <= 0:
            raise ValueError("Значение должно быть положительным")
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


@lru_cache()
def get_settings() -> Settings:
    """
    Возвращает singleton экземпляр Settings с кэшированием.

    Используется как FastAPI dependency.
    """
    return Settings()
