"""Жизненный цикл домена актов."""

import logging
import os
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI

logger = logging.getLogger("audit_workstation.domains.acts.lifecycle")


def get_executor() -> ThreadPoolExecutor:
    """Возвращает ThreadPoolExecutor домена актов.

    Каноническое хранилище — app.state.executor; этот геттер обращается
    к нему через публичный атрибут FastAPI-приложения.
    Для обратной совместимости (тесты, прямые вызовы) ищет сначала
    в app.state, затем в module-level _executor.
    """
    executor: ThreadPoolExecutor | None = _executor
    if executor is None:
        raise RuntimeError("ThreadPoolExecutor не инициализирован — приложение не запущено")
    return executor


async def on_startup(app: FastAPI) -> None:
    """Инициализация ресурсов домена актов."""
    global _executor
    max_workers = os.cpu_count() or 4
    app.state.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="act_formatter")
    # Сохраняем ссылку на один и тот же объект — app.state является
    # каноническим владельцем; _executor — удобный геттер без Request.
    _executor = app.state.executor
    logger.info(f"ThreadPoolExecutor домена актов запущен (workers={max_workers})")


async def on_shutdown(app: FastAPI) -> None:
    """Корректное завершение ресурсов домена актов."""
    global _executor
    executor: ThreadPoolExecutor | None = getattr(app.state, "executor", None)
    if executor is not None:
        executor.shutdown(wait=True, cancel_futures=False)
        app.state.executor = None
        _executor = None
        logger.info("ThreadPoolExecutor домена актов корректно закрыт")


# Модульная ссылка — указывает на тот же объект, что и app.state.executor.
# Обновляется lifecycle-хуками; не использовать напрямую вне get_executor().
_executor: ThreadPoolExecutor | None = None
