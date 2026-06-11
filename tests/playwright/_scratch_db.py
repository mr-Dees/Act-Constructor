"""Вспомогательный скрипт e2e: создание/удаление scratch-БД для прогона спеков.

Использование: python tests/playwright/_scratch_db.py create|drop [имя_бд]

Параметры подключения берутся из .env в корне проекта (DATABASE__HOST/PORT/
USER/PASSWORD); подключение идёт к служебной БД postgres. Имя scratch-БД по
умолчанию — act_constructor_undo_e2e; чтобы прогон ходил в неё, пропишите его
в DATABASE__NAME локального .env перед запуском playwright.
"""
import asyncio
import sys
from pathlib import Path

import asyncpg

DEFAULT_DB_NAME = "act_constructor_undo_e2e"
ROOT = Path(__file__).resolve().parents[2]


def load_dotenv() -> dict:
    """Минимальный парсер .env (как loadDotEnv в global-setup.ts)."""
    out = {}
    env_path = ROOT / ".env"
    if not env_path.exists():
        raise SystemExit(f".env не найден: {env_path}")
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip()
    return out


async def main(action: str, db_name: str) -> None:
    env = load_dotenv()
    conn = await asyncpg.connect(
        host=env.get("DATABASE__HOST", "localhost"),
        port=int(env.get("DATABASE__PORT", "5432")),
        user=env.get("DATABASE__USER", "postgres"),
        password=env.get("DATABASE__PASSWORD", ""),
        database="postgres",
    )
    try:
        if action == "create":
            exists = await conn.fetchval(
                "SELECT 1 FROM pg_database WHERE datname = $1", db_name)
            if not exists:
                await conn.execute(f'CREATE DATABASE "{db_name}"')
                print("created")
            else:
                print("already exists")
        elif action == "drop":
            await conn.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = $1 AND pid <> pg_backend_pid()", db_name)
            await conn.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
            print("dropped")
        else:
            raise SystemExit(f"неизвестное действие: {action}")
    finally:
        await conn.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else DEFAULT_DB_NAME))
