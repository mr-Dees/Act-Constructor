"""Жизненный цикл домена актов."""

import logging

from fastapi import FastAPI

logger = logging.getLogger("act_constructor.domains.acts.lifecycle")


async def on_shutdown(app: FastAPI) -> None:
    """Корректное завершение ресурсов домена актов."""
    from app.domains.acts.services.export_service import executor

    executor.shutdown(wait=True, cancel_futures=False)
    logger.info("ThreadPoolExecutor домена актов корректно закрыт")
