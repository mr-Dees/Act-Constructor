"""
Репозиторий CS-валидации.

Операции с таблицей и представлением записей CS-валидации:
поиск, создание, пакетное обновление, мягкое удаление.
"""

import logging
from datetime import date

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("audit_workstation.domains.ck_client_exp.repository")

# Поля для INSERT (без системных полей id, created_at, updated_at и т.д.)
_INSERT_FIELDS = (
    "reestr_metric_id",
    "neg_finder_tb_id",
    "metric_code",
    "metric_unic_clients",
    "metric_element_counts",
    "metric_amount_rubles",
    "is_sent_to_top_brass",
    "km_id",
    "num_sz",
    "dt_sz",
    "act_item_number",
    "process_number",
    "process_name",
    "ck_comment",
    "created_by",
)


class CSValidationRepository(BaseRepository):
    """Операции с записями CS-валидации в БД."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.table = self.adapter.get_table_name("t_db_oarb_ck_cs_validation")
        self.view = self.adapter.get_table_name("v_db_oarb_ck_cs_validation")

    # ------------------------------------------------------------------
    # ПОИСК
    # ------------------------------------------------------------------

    async def search(
        self,
        start_date: date | None = None,
        end_date: date | None = None,
        metric_code: list[str] | None = None,
        process_code: list[str] | None = None,
    ) -> list[dict]:
        """
        Поиск записей CS-валидации по фильтрам.

        Динамический WHERE-конструктор с параметризованными запросами.
        Запрашивает VIEW (с вычисляемыми полями).
        """
        conditions: list[str] = []
        params: list = []
        idx = 1

        if start_date is not None:
            conditions.append(f"dt_sz >= ${idx}")
            params.append(start_date)
            idx += 1

        if end_date is not None:
            conditions.append(f"dt_sz <= ${idx}")
            params.append(end_date)
            idx += 1

        if metric_code:
            placeholders = ", ".join(f"${idx + i}" for i in range(len(metric_code)))
            conditions.append(f"metric_code IN ({placeholders})")
            params.extend(metric_code)
            idx += len(metric_code)

        if process_code:
            placeholders = ", ".join(f"${idx + i}" for i in range(len(process_code)))
            conditions.append(f"process_number IN ({placeholders})")
            params.extend(process_code)
            idx += len(process_code)

        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        query = f"SELECT * FROM {self.view}{where} ORDER BY id DESC"

        logger.debug("Поиск CS-валидации: %s параметров", len(params))
        rows = await self.conn.fetch(query, *params)
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # ПОЛУЧЕНИЕ ПО ID
    # ------------------------------------------------------------------

    async def get_by_id(self, record_id: int) -> dict | None:
        """Возвращает запись CS-валидации по ID (из VIEW)."""
        row = await self.conn.fetchrow(
            f"SELECT * FROM {self.view} WHERE id = $1",
            record_id,
        )
        return dict(row) if row else None

    # ------------------------------------------------------------------
    # СОЗДАНИЕ
    # ------------------------------------------------------------------

    async def create(self, data: dict, username: str) -> dict:
        """
        Создаёт новую запись CS-валидации.

        Поля берутся из data, created_by = username.
        Возвращает словарь с id и created_at.
        """
        values = []
        for field in _INSERT_FIELDS:
            if field == "created_by":
                values.append(username)
            else:
                values.append(data.get(field))

        placeholders = ", ".join(f"${i}" for i in range(1, len(_INSERT_FIELDS) + 1))
        columns = ", ".join(_INSERT_FIELDS)

        query = (
            f"INSERT INTO {self.table} ({columns}) "
            f"VALUES ({placeholders}) "
            f"RETURNING id, created_at"
        )

        row = await self.conn.fetchrow(query, *values)
        logger.info("Создана запись CS-валидации id=%s пользователем %s", row["id"], username)
        return dict(row)

    # ------------------------------------------------------------------
    # ПАКЕТНОЕ ОБНОВЛЕНИЕ
    # ------------------------------------------------------------------

    async def batch_update(self, items: list[dict], username: str) -> int:
        """
        Пакетное обновление записей CS-валидации.

        В транзакции:
        1. Деактивирует существующие записи (soft delete).
        2. Вставляет новые версии записей.

        Возвращает количество обновлённых (деактивированных) записей.
        """
        if not items:
            return 0

        ids = [item["id"] for item in items if "id" in item]
        if not ids:
            return 0

        async with self.conn.transaction():
            # Деактивация старых записей
            id_placeholders = ", ".join(f"${i + 1}" for i in range(len(ids)))
            deactivate_query = (
                f"UPDATE {self.table} "
                f"SET deleted_at = now(), is_actual = false, updated_by = $1 "
                f"WHERE id IN ({id_placeholders})"
            )
            result = await self.conn.execute(deactivate_query, username, *ids)
            updated_count = int(result.split()[-1]) if result else 0

            # Вставка новых версий
            for item in items:
                values = []
                for field in _INSERT_FIELDS:
                    if field == "created_by":
                        values.append(username)
                    else:
                        values.append(item.get(field))

                placeholders = ", ".join(
                    f"${i}" for i in range(1, len(_INSERT_FIELDS) + 1)
                )
                columns = ", ".join(_INSERT_FIELDS)

                insert_query = (
                    f"INSERT INTO {self.table} ({columns}) "
                    f"VALUES ({placeholders})"
                )
                await self.conn.execute(insert_query, *values)

        logger.info(
            "Пакетное обновление CS-валидации: %s записей деактивировано, "
            "%s новых версий вставлено пользователем %s",
            updated_count, len(items), username,
        )
        return updated_count

    # ------------------------------------------------------------------
    # МЯГКОЕ УДАЛЕНИЕ
    # ------------------------------------------------------------------

    async def soft_delete(self, record_id: int, username: str) -> bool:
        """
        Мягкое удаление записи CS-валидации.

        Устанавливает is_actual=false, deleted_at=now(), updated_by=username.
        Возвращает True если запись была деактивирована.
        """
        result = await self.conn.execute(
            f"""
            UPDATE {self.table}
            SET is_actual = false,
                deleted_at = now(),
                updated_by = $1
            WHERE id = $2 AND is_actual = true
            """,
            username,
            record_id,
        )
        deleted = result == "UPDATE 1"
        if deleted:
            logger.info(
                "Мягкое удаление CS-валидации id=%s пользователем %s",
                record_id, username,
            )
        return deleted
