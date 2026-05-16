"""Singleton-блокировка инстанса приложения через БД.

В закрытой сети нет Redis/etcd, а multi-worker деплой может повредить
process-level состояние (например, ``_running``-registry раннера агента).
Чтобы гарантировать ровно один активный воркер, используем строку в
таблице ``{PREFIX}app_singleton_lock`` с PK по ``service_name``:

1. На старте lifespan делает ``INSERT``. Если уже занято — смотрим возраст
   строки. Если ``started_at`` старше TTL — считаем строку «stale» (старый
   воркер упал не удалив lock) и перезаписываем DELETE+INSERT в транзакции.
2. На корректном shutdown lifespan делает ``DELETE`` своей строки.

Этот модуль НЕ зависит от доменов чата: он используется в самом ядре
жизненного цикла приложения.
"""
from __future__ import annotations

import logging
import os
import socket

import asyncpg

logger = logging.getLogger("audit_workstation.core.singleton_lock")

# TTL «stale-lock»: если строка старше — старый процесс точно мёртв.
DEFAULT_STALE_TTL_SEC = 60

# Имя сервиса в таблице. Если когда-нибудь понадобится изолировать инстансы
# (например, dev/prod на одном кластере), значение можно вынести в settings.
SERVICE_NAME = "act_constructor"


class SingletonLockBusyError(RuntimeError):
    """Lock держит другой свежий воркер — стартовать нельзя."""


async def acquire_singleton_lock(
    conn: asyncpg.Connection,
    table: str,
    *,
    service_name: str = SERVICE_NAME,
    stale_ttl_sec: int = DEFAULT_STALE_TTL_SEC,
) -> None:
    """Захватывает singleton-блокировку в БД.

    При конфликте (lock уже есть) — если запись старше ``stale_ttl_sec``,
    перезаписываем (старый воркер считается мёртвым). Иначе — бросаем
    :class:`SingletonLockBusyError` с понятным сообщением.

    Args:
        conn: Открытое соединение asyncpg.
        table: Полное имя таблицы (с учётом схемы/префикса).
        service_name: Идентификатор сервиса в PK.
        stale_ttl_sec: TTL stale-блокировки в секундах.
    """
    pid = os.getpid()
    host = socket.gethostname()
    try:
        await conn.execute(
            f"INSERT INTO {table} (service_name, pid, started_at, host) "
            f"VALUES ($1, $2, CURRENT_TIMESTAMP, $3)",
            service_name, pid, host,
        )
        logger.info(
            "Singleton-lock захвачен: service=%s pid=%s host=%s",
            service_name, pid, host,
        )
        return
    except asyncpg.UniqueViolationError:
        # Запись уже есть — проверяем, не stale ли она.
        pass

    row = await conn.fetchrow(
        f"SELECT pid, host, started_at, "
        f"EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))::int AS age_sec "
        f"FROM {table} WHERE service_name = $1",
        service_name,
    )
    if row is None:
        # Гонка: кто-то удалил запись между INSERT и SELECT — повторим попытку.
        await conn.execute(
            f"INSERT INTO {table} (service_name, pid, started_at, host) "
            f"VALUES ($1, $2, CURRENT_TIMESTAMP, $3)",
            service_name, pid, host,
        )
        logger.info(
            "Singleton-lock захвачен после гонки: service=%s pid=%s",
            service_name, pid,
        )
        return

    age_sec = int(row["age_sec"] or 0)
    if age_sec >= stale_ttl_sec:
        logger.warning(
            "Singleton-lock считается stale (возраст %dс ≥ TTL %dс): "
            "перезаписываем. Прежний владелец: pid=%s host=%s",
            age_sec, stale_ttl_sec, row["pid"], row["host"],
        )
        async with conn.transaction():
            await conn.execute(
                f"DELETE FROM {table} WHERE service_name = $1",
                service_name,
            )
            await conn.execute(
                f"INSERT INTO {table} (service_name, pid, started_at, host) "
                f"VALUES ($1, $2, CURRENT_TIMESTAMP, $3)",
                service_name, pid, host,
            )
        logger.info(
            "Singleton-lock перезахвачен после stale: pid=%s host=%s",
            pid, host,
        )
        return

    raise SingletonLockBusyError(
        f"Уже запущена другая инстанция приложения "
        f"(service={service_name}, pid={row['pid']}, host={row['host']}, "
        f"возраст блокировки {age_sec}с). "
        f"Остановите её или дождитесь TTL={stale_ttl_sec}с."
    )


async def release_singleton_lock(
    conn: asyncpg.Connection,
    table: str,
    *,
    service_name: str = SERVICE_NAME,
) -> None:
    """Снимает свою singleton-блокировку (best-effort).

    Удаляет только запись, принадлежащую этому процессу (по PID), чтобы
    случайно не снять lock, перехваченный stale-логикой другого воркера.
    """
    pid = os.getpid()
    try:
        result = await conn.execute(
            f"DELETE FROM {table} WHERE service_name = $1 AND pid = $2",
            service_name, pid,
        )
        logger.info("Singleton-lock освобождён: %s", result)
    except Exception:
        logger.exception(
            "Singleton-lock: ошибка при освобождении (не блокирует shutdown)",
        )
