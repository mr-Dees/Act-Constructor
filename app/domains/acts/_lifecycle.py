"""Жизненный цикл домена актов."""

import logging
import os
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI

logger = logging.getLogger("audit_workstation.domains.acts.lifecycle")

_executor: ThreadPoolExecutor | None = None


def get_executor() -> ThreadPoolExecutor:
    """Возвращает ThreadPoolExecutor домена актов."""
    if _executor is None:
        raise RuntimeError("ThreadPoolExecutor не инициализирован — приложение не запущено")
    return _executor


async def on_startup(app: FastAPI) -> None:
    """Инициализация ресурсов домена актов."""
    global _executor
    max_workers = os.cpu_count() or 4
    _executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="act_formatter")
    logger.info(f"ThreadPoolExecutor домена актов запущен (workers={max_workers})")


async def on_shutdown(app: FastAPI) -> None:
    """Корректное завершение ресурсов домена актов."""
    global _executor
    if _executor:
        _executor.shutdown(wait=True, cancel_futures=False)
        logger.info("ThreadPoolExecutor домена актов корректно закрыт")
        _executor = None
