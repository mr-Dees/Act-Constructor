"""
Сервис бизнес-логики для работы с актами в PostgreSQL/Greenplum.
"""

import json
import logging
from datetime import datetime, timedelta

import asyncpg
from typing import List
from app.db.connection import get_adapter
from app.db.utils import KMUtils, JSONDBUtils, ActDirectivesValidator
from app.schemas.ua_metadata import (
    FinResReportView,
)

logger = logging.getLogger("act_constructor.db.repository")


class CkReportsDBService:
    """Сервис для работы с отчетами ЦК и их связанными сущностями в базе данных."""

    def __init__(self, conn: asyncpg.Connection):
        """Инициализирует сервис с подключением к БД."""
        self.conn = conn
        self.adapter = get_adapter()

        # Кэшируем имена таблиц для удобства
        self.ck_users = self.adapter.get_table_name("ck_users")
        self.ck_roles = self.adapter.get_table_name("ck_roles")
        self.ck_fin_res_report = self.adapter.get_table_name("ck_fin_res_report")


    async def check_user_access_to_ck_report(self, ck_id, username):
        """Проверяет имеет ли пользователь доступ к отчету ЦК"""
        result = await self.conn.fetchval(
            f"""
            SELECT EXISTS(
                SELECT 1
                FROM {self.ck_roles}
                WHERE ck_id = $1 AND username = $2
            )
            """,
            ck_id,
            username,
        )
        return bool(result)

    async def get_ck_fr_report(self, dt_start: datetime | None, dt_end: datetime | None) -> List[FinResReportView]:
        """Получает отчет ЦК за указанный период"""
        query = f"""
                SELECT *
                FROM {self.ck_fin_res_report}
                WHERE 1 = 1
            """
        if dt_start:
            query += f" AND dt >= '{dt_start}'::date"
        if dt_end:
            query += f" AND dt <= '{dt_end}'::date"
        result = await self.conn.fetch(query)
        return [
            FinResReportView.model_validate(dict(row))
            for row in result
        ]