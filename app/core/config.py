"""
Конфигурация приложения.

Содержит настройки путей, параметров сервера и других констант.
Использует переменные окружения из .env файла.
"""

import logging
import sys
from functools import lru_cache
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import ClassVar, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def setup_logging(log_level: str = "INFO") -> logging.Logger:
    """
    Настраивает систему логирования для приложения.

    Args:
        log_level: Уровень логирования (DEBUG, INFO, WARNING, ERROR,
            CRITICAL)

    Returns:
        Настроенный logger
    """
    logger = logging.getLogger("act_constructor")

    # Проверяем что логирование еще не настроено.
    # Защита от повторной настройки в workers.
    if logger.handlers:
        return logger

    logger.setLevel(getattr(logging, log_level.upper()))

    # Создаем форматер для логов
    formatter = logging.Formatter(
        '%(levelname)s:     [%(asctime)s] %(name)s - %(message)s',
        datefmt='%H:%M:%S'
    )

    # Настраиваем консольный handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(getattr(logging, log_level.upper()))

    # Настраиваем файловый handler с автоматической ротацией
    log_dir = Path(__file__).resolve().parent.parent.parent / "logs"
    log_dir.mkdir(exist_ok=True)

    # RotatingFileHandler: автоматическая ротация при достижении
    # maxBytes.
    # Хранит до backupCount старых файлов (app.log.1, app.log.2, ...).
    file_handler = RotatingFileHandler(
        log_dir / "app.log",
        maxBytes=10 * 1024 * 1024,  # 10MB на файл
        backupCount=5,  # Храним 5 старых файлов
        encoding='utf-8'
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(getattr(logging, log_level.upper()))

    # Добавляем handlers
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    # Поставить False если нужно отключить вывод событий в root logger
    logger.propagate = True

    return logger


class Settings(BaseSettings):
    """
    Класс настроек приложения на основе Pydantic.

    Автоматически загружает переменные из .env файла и предоставляет
    типизированный доступ к конфигурации.
    """

    # Метаданные приложения
    app_title: str = "Act Constructor"
    app_version: str = "1.0.0"

    # Параметры сервера
    host: str = "0.0.0.0"
    port: int = Field(default=8000, ge=1, le=65535)

    # Префикс для API версии 1
    api_v1_prefix: str = "/api/v1"

    # Уровень логирования (ограничен допустимыми значениями)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    # === Тип базы данных ===
    db_type: Literal["postgresql", "greenplum"] = Field(default="postgresql")

    # === База данных PostgreSQL ===
    db_host: str = Field(default="localhost")
    db_port: int = Field(default=5432, ge=1, le=65535)
    db_name: str = Field(default="act_constructor")
    db_user: str = Field(default="postgres")
    db_password: str = Field(default="postgres")

    # === Greenplum настройки ===
    gp_host: str = Field(
        default="gp_dns_pkap1123_audit.gp.df.sbrf.ru"
    )
    gp_port: int = Field(default=5432, ge=1, le=65535)
    gp_database: str = Field(default="capgp3")
    gp_schema: str = Field(
        default="s_grnplm_ld_audit_da_project_4"
    )
    gp_table_prefix: str = Field(
        default="t_db_oarb_audit_act_"
    )

    # === Схемы для фактур ===
    invoice_hive_schema: str = Field(default="team_sva_oarb_3")
    invoice_gp_schema: str = Field(default="s_grnplm_ld_audit_da_sandbox_oarb")

    # === Пулы подключений ===
    db_pool_min_size: int = Field(default=2, ge=1)
    db_pool_max_size: int = Field(default=10, ge=2)

    # === Аутентификация ===
    jupyterhub_user: str = Field(default="unknown_user")

    # === Параметры блокировок актов ===

    # Продолжительность блокировки акта на сервере (минуты)
    act_lock_duration_minutes: int = Field(default=15, gt=0)

    # Через сколько минут бездействия показывать предупреждение (фронтенд)
    act_inactivity_timeout_minutes: float = Field(default=5.0, gt=0)

    # Как часто проверять бездействие на фронтенде (секунды)
    act_inactivity_check_interval_seconds: int = Field(default=60, gt=0)

    # Через сколько минут после последнего продления можно продлить снова (фронтенд)
    act_min_extension_interval_minutes: float = Field(default=5.0, gt=0)

    # Через сколько секунд автоматически завершать работу если пользователь не нажал кнопку продолжить
    act_inactivity_dialog_timeout_seconds: int = Field(default=30, gt=0)

    # === Лимиты безопасности ===

    # Максимальный размер тела запроса в байтах (10MB по умолчанию)
    max_request_size: int = Field(default=10 * 1024 * 1024, gt=0)

    # Rate limiting: максимум запросов в минуту на IP
    rate_limit_per_minute: int = Field(default=1024, gt=0)

    # Максимальный размер изображения в MB
    max_image_size_mb: float = 10.0

    # Timeout для парсинга HTML в секундах
    html_parse_timeout: int = 30

    # Максимальная глубина вложенности HTML
    max_html_depth: int = 100

    # Размер чанков для парсинга HTML (в символах)
    html_parse_chunk_size: int = Field(default=1000, gt=0)

    # === Параметры retry логики ===

    # Максимальное количество повторных попыток при временных ошибках
    max_retries: int = Field(default=3, gt=0)

    # Задержка между попытками в секундах
    retry_delay: float = Field(default=0.5, ge=0)

    # === Параметры Rate Limiting ===

    # Максимальное количество отслеживаемых IP-адресов в TTL cache
    max_tracked_ips: int = 100

    # TTL (time-to-live) для записей в rate limiter (в секундах).
    # Запросы старше этого времени автоматически удаляются из кэша.
    rate_limit_ttl: int = 120

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

    # === Параметры управления ресурсами ===

    # Максимальное количество одновременных операций с файлами
    max_concurrent_file_operations: int = Field(default=100, gt=0)

    # Timeout для операции сохранения акта (в секундах)
    save_operation_timeout: int = Field(default=300, gt=0)

    # Timeout для всей операции сохранения акта (секунды)
    save_act_timeout: int = 300

    # Максимальная глубина дерева акта (защита от рекурсии)
    max_tree_depth: int = 50

    # Базовая директория проекта.
    # Относительный путь от конфига до корня проекта.
    base_dir: ClassVar[Path] = Path(__file__).resolve().parent.parent.parent

    # Директория для хранения файлов актов
    @property
    def storage_dir(self) -> Path:
        """Возвращает директорию для хранения актов."""
        path = self.base_dir / "acts_storage"
        path.mkdir(parents=True, exist_ok=True)
        return path

    # Директория с HTML-шаблонами
    @property
    def templates_dir(self) -> Path:
        """Возвращает директорию с шаблонами."""
        return self.base_dir / "templates"

    # Директория со статическими файлами (CSS, JS)
    @property
    def static_dir(self) -> Path:
        """Возвращает директорию со статическими файлами."""
        return self.base_dir / "static"

    # Конфигурация Pydantic
    model_config = SettingsConfigDict(
        env_file=str(base_dir / ".env"),  # Файл с переменными окружения
        case_sensitive=False,  # Нечувствительность к регистру переменных
        extra="ignore",  # Игнорировать неизвестные поля из .env
        validate_default=False  # Оптимизация валидации
    )

    @field_validator("log_level")
    @classmethod
    def normalize_log_level(cls, v: str) -> str:
        """Нормализует уровень логирования к верхнему регистру."""
        return v.upper()

    def ensure_directories(self) -> None:
        """
        Создает все необходимые директории при инициализации.

        Вызывайте этот метод при запуске приложения для гарантии
        существования всех рабочих директорий.

        Raises:
            RuntimeError: Если критичные директории не найдены
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
    """Возвращает singleton экземпляр Settings с кэшированием."""
    return Settings()
