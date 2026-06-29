"""
Репозиторий CS-валидации.

Операции с таблицей и представлением записей CS-валидации:
поиск, создание, пакетное обновление, мягкое удаление.
"""

import logging
from datetime import date

import asyncpg

from app.core.settings_registry import get as get_domain_settings
from app.db.repositories.base import BaseRepository
from app.domains.ck_client_exp.schemas.cs_validation import CSValidationView
from app.domains.ck_client_exp.settings import CkClientExpSettings

logger = logging.getLogger("audit_workstation.domains.ck_client_exp.repository")

# Колонки представления v_db_oarb_ck_cs_validation, разрешённые для серверной
# фильтрации (ILIKE) и сортировки (ORDER BY). Источник истины — поля схемы
# CSValidationView; whitelist защищает от инъекций в имена колонок/ORDER BY.
ALLOWED_COLUMNS: set[str] = set(CSValidationView.model_fields.keys())

_DATE_FIELDS = {"dt_sz"}
_NULLABLE_FIELDS = _DATE_FIELDS | {"act_sub_number_id", "reestr_metric_id"}
_NUMERIC_DEFAULTS = {
    "metric_unic_clients": 0,
    "metric_element_counts": 0,
    "metric_amount_rubles": 0,
    "is_sent_to_top_brass": False,
}


def _coerce(field: str, value):
    """Приводит значение к типу, ожидаемому asyncpg, с учётом NOT NULL DEFAULT."""
    if value is None:
        if field in _NULLABLE_FIELDS:
            return None
        if field in _NUMERIC_DEFAULTS:
            return _NUMERIC_DEFAULTS[field]
        return ""
    if field in _DATE_FIELDS and isinstance(value, str):
        return date.fromisoformat(value[:10])
    return value


# Поля для INSERT (без системных полей id, created_at, updated_at и т.д.)
_INSERT_FIELDS = (
    "act_sub_number_id",
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
    "block_owner",
    "department_owner",
    "ck_comment",
    "created_by",
)


class CSValidationRepository(BaseRepository):
    """Операции с записями CS-валидации в БД."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        s = get_domain_settings("ck_client_exp", CkClientExpSettings)
        self.table = self.adapter.qualify_table_name(s.cs_validation_table, s.schema_name)
        self.view = self.adapter.qualify_table_name(s.cs_validation_view, s.schema_name)

    # ------------------------------------------------------------------
    # ПОИСК
    # ------------------------------------------------------------------

    def _build_search_where(
        self,
        start_date: date | None,
        end_date: date | None,
        metric_code: list[str] | None,
        process_code: list[str] | None,
    ) -> tuple[str, list, int]:
        """Собирает WHERE-часть SQL для поиска. Возвращает (clause, params, next_idx)."""
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
        return where, params, idx

    async def search(
        self,
        start_date: date | None = None,
        end_date: date | None = None,
        metric_code: list[str] | None = None,
        process_code: list[str] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """
        Поиск записей CS-валидации по фильтрам.

        Динамический WHERE-конструктор с параметризованными запросами.
        Запрашивает VIEW (с вычисляемыми полями).
        """
        where, params, idx = self._build_search_where(
            start_date, end_date, metric_code, process_code,
        )
        query = (
            f"SELECT * FROM {self.view}{where} "
            f"ORDER BY id DESC LIMIT ${idx} OFFSET ${idx + 1}"
        )
        params.extend([limit, offset])

        logger.debug("Поиск CS-валидации: %s параметров", len(params))
        rows = await self.conn.fetch(query, *params)
        return [dict(r) for r in rows]

    async def count_search(
        self,
        start_date: date | None = None,
        end_date: date | None = None,
        metric_code: list[str] | None = None,
        process_code: list[str] | None = None,
    ) -> int:
        """Считает количество записей, удовлетворяющих фильтрам поиска."""
        where, params, _ = self._build_search_where(
            start_date, end_date, metric_code, process_code,
        )
        return await self.conn.fetchval(
            f"SELECT COUNT(*) FROM {self.view}{where}",
            *params,
        )

    # ------------------------------------------------------------------
    # ПОИСК ПО КОЛОНОЧНЫМ ФИЛЬТРАМ (настраиваемая таблица)
    # ------------------------------------------------------------------

    def _build_filter_where(
        self, filters: dict[str, str] | None,
    ) -> tuple[str, list, int]:
        """Собирает WHERE из колоночных фильтров (ILIKE по whitelist).

        Учитываются только колонки из ALLOWED_COLUMNS; значения подставляются
        bind-параметрами вида ``%значение%`` (не конкатенируются в SQL).
        Колонка кастуется в TEXT (``CAST(col AS TEXT)``), т.к. ILIKE не
        определён для numeric/date/bool — без каста фильтр по таким колонкам
        падал бы с ``operator does not exist``. Совместимо с PG 9.4 / GP 6.x.
        Возвращает (clause, params, next_idx).
        """
        conditions: list[str] = []
        params: list = []
        idx = 1
        for column, value in (filters or {}).items():
            if column not in ALLOWED_COLUMNS:
                continue
            if value is None or str(value).strip() == "":
                continue
            conditions.append(f"CAST({column} AS TEXT) ILIKE ${idx}")
            params.append(f"%{value}%")
            idx += 1
        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        return where, params, idx

    async def search_filtered(
        self,
        *,
        filters: dict[str, str] | None = None,
        sort_by: str | None = None,
        sort_dir: str = "asc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Поиск записей по колоночным фильтрам с сортировкой и подсчётом total.

        - Фильтры — ILIKE по whitelisted-колонкам (значения — bind-параметры).
        - ``sort_by`` валидируется против ALLOWED_COLUMNS (иначе ValueError —
          защита от инъекции в ORDER BY); направление — только ASC/DESC.
          Без ``sort_by`` — стабильный ``ORDER BY id``.
        - ``COUNT(*)`` считается отдельным запросом с теми же WHERE-параметрами.

        Возвращает (страница записей, общее количество). SQL — PG 9.4 / GP 6.x.
        """
        if sort_by is not None and sort_by not in ALLOWED_COLUMNS:
            raise ValueError(f"Недопустимая колонка сортировки: {sort_by}")

        where, params, idx = self._build_filter_where(filters)
        direction = "DESC" if str(sort_dir).lower() == "desc" else "ASC"
        order_by = f"ORDER BY {sort_by} {direction}" if sort_by else "ORDER BY id"

        total = await self.conn.fetchval(
            f"SELECT COUNT(*) FROM {self.view}{where}",
            *params,
        )

        query = (
            f"SELECT * FROM {self.view}{where} "
            f"{order_by} LIMIT ${idx} OFFSET ${idx + 1}"
        )
        rows = await self.conn.fetch(query, *params, limit, offset)
        logger.debug(
            "Поиск CS-валидации (фильтры): %s условий, sort_by=%s",
            len(params), sort_by,
        )
        return [dict(r) for r in rows], int(total or 0)

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
                values.append(_coerce(field, data.get(field)))

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
            id_placeholders = ", ".join(f"${i + 2}" for i in range(len(ids)))
            deactivate_query = (
                f"UPDATE {self.table} "
                f"SET updated_at = now(), is_actual = false, updated_by = $1 "
                f"WHERE id IN ({id_placeholders}) AND is_actual = true"
            )
            result = await self.conn.execute(deactivate_query, username, *ids)
            updated_count = int(result.split()[-1]) if result else 0

            # Вставка новых версий (пакетом)
            columns = ", ".join(_INSERT_FIELDS)
            placeholders = ", ".join(
                f"${i}" for i in range(1, len(_INSERT_FIELDS) + 1)
            )
            insert_query = (
                f"INSERT INTO {self.table} ({columns}) "
                f"VALUES ({placeholders})"
            )
            rows_to_insert = []
            for item in items:
                values = []
                for field in _INSERT_FIELDS:
                    if field == "created_by":
                        values.append(username)
                    else:
                        values.append(_coerce(field, item.get(field)))
                rows_to_insert.append(values)
            await self.conn.executemany(insert_query, rows_to_insert)

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

        Устанавливает is_actual=false, deleted_at=now(), updated_at=now(),
        updated_by=username. Возвращает True если запись была деактивирована.
        """
        result = await self.conn.execute(
            f"""
            UPDATE {self.table}
            SET is_actual = false,
                deleted_at = now(),
                updated_at = now(),
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
