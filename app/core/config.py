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

from pydantic import BaseModel, Field, field_validator
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


# === Вложенные модели настроек ===


class ServerSettings(BaseModel):
    """Параметры сервера."""
    host: str = "0.0.0.0"
    port: int = Field(default=8000, ge=1, le=65535)
    api_v1_prefix: str = "/api/v1"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    @field_validator("log_level")
    @classmethod
    def normalize_log_level(cls, v: str) -> str:
        """Нормализует уровень логирования к верхнему регистру."""
        return v.upper()


class GreenplumSettings(BaseModel):
    """Настройки подключения к Greenplum."""
    host: str = Field(default="gp_dns_pkap1123_audit.gp.df.sbrf.ru")
    port: int = Field(default=5432, ge=1, le=65535)
    database: str = Field(default="capgp3")
    schema_name: str = Field(
        default="s_grnplm_ld_audit_da_project_4",
        alias="schema"
    )
    table_prefix: str = Field(default="t_db_oarb_audit_act_")

    model_config = {"populate_by_name": True}


class DatabaseSettings(BaseModel):
    """Настройки базы данных."""
    type: Literal["postgresql", "greenplum"] = Field(default="postgresql")
    host: str = Field(default="localhost")
    port: int = Field(default=5432, ge=1, le=65535)
    name: str = Field(default="act_constructor")
    user: str = Field(default="postgres")
    password: str = Field(default="postgres")
    pool_min_size: int = Field(default=2, ge=1)
    pool_max_size: int = Field(default=10, ge=2)
    gp: GreenplumSettings = GreenplumSettings()


class LockSettings(BaseModel):
    """
    Параметры блокировок и контроля активности пользователя.

    Механизм работы:
    1. При открытии акта сервер ставит эксклюзивную блокировку на duration_minutes.
    2. Фронтенд каждые inactivity_check_interval_seconds проверяет,
       двигал ли пользователь мышь / нажимал клавиши / скроллил.
    3. Если пользователь активен и с последнего продления прошло ≥ min_extension_interval_minutes,
       фронтенд автоматически продлевает блокировку на сервере.
    4. Если пользователь бездействует ≥ inactivity_timeout_minutes,
       появляется диалог «Продолжить работу?» с обратным отсчётом.
    5. Если пользователь не отвечает за inactivity_dialog_timeout_seconds —
       контент автосохраняется, блокировка снимается, происходит редирект на список актов.
    """
    duration_minutes: int = Field(default=15, gt=0)
    inactivity_timeout_minutes: float = Field(default=5.0, gt=0)
    inactivity_check_interval_seconds: int = Field(default=60, gt=0)
    min_extension_interval_minutes: float = Field(default=5.0, gt=0)
    inactivity_dialog_timeout_seconds: int = Field(default=30, gt=0)


class SecuritySettings(BaseModel):
    """Лимиты безопасности."""
    max_request_size: int = Field(default=10 * 1024 * 1024, gt=0)
    rate_limit_per_minute: int = Field(default=1024, gt=0)
    max_tracked_ips: int = 100
    rate_limit_ttl: int = 120


class FormattingSettings(BaseModel):
    """Параметры форматирования документов."""
    # DOCX
    max_image_size_mb: float = 10.0
    docx_image_width: float = 4.0
    docx_caption_font_size: int = 10
    docx_max_heading_level: int = 9
    # Text
    text_header_width: int = 80
    text_indent_size: int = 2
    # Markdown
    markdown_max_heading_level: int = 6
    # HTML parsing
    html_parse_timeout: int = Field(default=30, gt=0)
    max_html_depth: int = 100
    html_parse_chunk_size: int = Field(default=1000, gt=0)
    # Retry
    max_retries: int = Field(default=3, gt=0)
    retry_delay: float = Field(default=0.5, ge=0)


class ResourceSettings(BaseModel):
    """Параметры управления ресурсами."""
    max_concurrent_file_operations: int = Field(default=100, gt=0)
    save_operation_timeout: int = Field(default=300, gt=0)
    save_act_timeout: int = 300
    max_tree_depth: int = 50


class InvoiceSettings(BaseModel):
    """Настройки фактур."""
    hive_schema: str = Field(default="team_sva_oarb_3")
    gp_schema: str = Field(default="s_grnplm_ld_audit_da_sandbox_oarb")
    hive_registry_schema: str = Field(default="s_grnplm_ld_audit_project_4")
    hive_registry_table: str = Field(default="t_db_oarb_ua_hadoop_tables")
    hive_registry_col_table: str = Field(default="table_name")
    metric_dict_table: str = Field(default="t_db_oarb_ua_violation_metric_dict")


class Settings(BaseSettings):
    """
    Класс настроек приложения на основе Pydantic.

    Автоматически загружает переменные из .env файла и предоставляет
    типизированный доступ к конфигурации. Вложенные настройки используют
    разделитель __ (например, SERVER__HOST, DATABASE__TYPE).
    """

    # Метаданные приложения
    app_title: str = "Act Constructor"
    app_version: str = "1.0.0"

    # Аутентификация
    jupyterhub_user: str = Field(default="unknown_user")

    # Сервис идентификации аудита
    # TODO: URL внешнего сервиса идентификации аудита
    audit_id_service_url: str = ""
    audit_id_service_timeout: int = 10

    # Вложенные настройки
    server: ServerSettings = ServerSettings()
    database: DatabaseSettings = DatabaseSettings()
    lock: LockSettings = LockSettings()
    security: SecuritySettings = SecuritySettings()
    formatting: FormattingSettings = FormattingSettings()
    resource: ResourceSettings = ResourceSettings()
    invoice: InvoiceSettings = InvoiceSettings()

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
        env_nested_delimiter="__",  # Разделитель для вложенных настроек
        case_sensitive=False,  # Нечувствительность к регистру переменных
        extra="ignore",  # Игнорировать неизвестные поля из .env
    )

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
