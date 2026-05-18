"""
Настройка системы логирования приложения.

Поддерживает два формата вывода:
- ``text`` (по умолчанию) — человекочитаемый формат для локальной разработки;
- ``json`` — структурированные JSON-логи через ``python-json-logger`` для
  централизованной обработки (агрегация, поиск, фильтрация по полям).

Формат выбирается переменной окружения ``LOG_FORMAT`` (text | json).

В каждую запись инжектируется ``request_id`` из ``request_id_var`` (ContextVar),
который проставляет ``RequestIdMiddleware``. Вне HTTP-контекста значение — "-".
"""

from __future__ import annotations

import contextvars
import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

# ContextVar для хранения request_id текущего запроса.
# Значение "-" используется вне HTTP-контекста (startup, shutdown, фоновые задачи).
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-",
)


class RequestIdFilter(logging.Filter):
    """Инжектирует request_id текущего запроса в каждую запись лога."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


def _make_text_formatter() -> logging.Formatter:
    """Текстовый форматтер — человекочитаемый, для локальной разработки."""
    return logging.Formatter(
        "%(levelname)s:     [%(asctime)s] [%(request_id)s] "
        "%(name)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def _make_json_formatter() -> logging.Formatter:
    """JSON-форматтер через python-json-logger.

    Базовые поля: timestamp, level, name, message, request_id. Любые
    значения, переданные через ``extra={...}``, автоматически попадают
    в JSON как отдельные ключи.
    """
    # python-json-logger 3.x перенёс класс в pythonjsonlogger.json;
    # старый импорт pythonjsonlogger.jsonlogger остаётся как alias с
    # DeprecationWarning. Поддерживаем оба расположения.
    try:
        from pythonjsonlogger.json import JsonFormatter
    except ImportError:  # pragma: no cover — старая версия 2.x
        from pythonjsonlogger.jsonlogger import JsonFormatter

    # rename_fields маппит имена pythonjsonlogger → желаемые ключи JSON.
    return JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s %(request_id)s",
        rename_fields={
            "asctime": "timestamp",
            "levelname": "level",
        },
        datefmt="%Y-%m-%dT%H:%M:%S",
    )


def _resolve_format() -> str:
    """Возвращает формат логов: ``json`` или ``text``."""
    return (os.getenv("LOG_FORMAT", "text") or "text").strip().lower()


def setup_logging(log_level: str = "INFO") -> logging.Logger:
    """
    Настраивает систему логирования для приложения.

    Args:
        log_level: Уровень логирования (DEBUG, INFO, WARNING, ERROR, CRITICAL).

    Returns:
        Настроенный logger ``audit_workstation``.
    """
    logger = logging.getLogger("audit_workstation")

    # Защита от повторной настройки в дочерних воркерах uvicorn.
    if logger.handlers:
        return logger

    level = getattr(logging, log_level.upper())
    logger.setLevel(level)

    log_format = _resolve_format()
    if log_format == "json":
        formatter = _make_json_formatter()
    else:
        formatter = _make_text_formatter()

    # Консольный handler.
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(level)

    # Файловый handler с автоматической ротацией.
    log_dir = Path(__file__).resolve().parent.parent.parent / "logs"
    log_dir.mkdir(exist_ok=True)

    file_handler = RotatingFileHandler(
        log_dir / "app.log",
        maxBytes=10 * 1024 * 1024,  # 10 МБ на файл
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(level)

    # request_id фильтр инжектируется на handler, а не на logger:
    # при propagation от дочерних логгеров Python вызывает callHandlers()
    # на родительском логгере, минуя его собственные filters. Фильтр на
    # handler гарантированно срабатывает непосредственно перед emit().
    request_id_filter = RequestIdFilter()
    console_handler.addFilter(request_id_filter)
    file_handler.addFilter(request_id_filter)

    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    # Не пропускаем сообщения в root logger — избегаем дублей с uvicorn.
    logger.propagate = False

    return logger
