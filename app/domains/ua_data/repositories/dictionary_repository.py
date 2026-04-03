"""
Репозиторий справочных данных UA.

Предоставляет методы чтения справочных таблиц (процессы, тербанки,
метрики нарушений, подразделения, каналы, продукты, команды).
"""

import logging

from app.core.settings_registry import get as get_domain_settings
from app.db.repositories.base import BaseRepository
from app.domains.ua_data.settings import UaDataSettings

logger = logging.getLogger("audit_workstation.domains.ua_data.repository")


class DictionaryRepository(BaseRepository):
    """Операции чтения справочных таблиц UA."""

    def __init__(self, conn):
        super().__init__(conn)
        s = get_domain_settings("ua_data", UaDataSettings)
        q = lambda name: self.adapter.qualify_table_name(name, s.schema_name)
        self.process_dict = q(s.process_dict)
        self.terbank_dict = q(s.terbank_dict)
        self.violation_metric_dict = q(s.violation_metric_dict)
        self.departments = q(s.departments)
        self.gosb_dict = q(s.gosb_dict)
        self.vsp_dict = q(s.vsp_dict)
        self.channel_dict = q(s.channel_dict)
        self.product_dict = q(s.product_dict)
        self.team_dict = q(s.team_dict)

    async def get_processes(self) -> list[dict]:
        """Возвращает список актуальных процессов."""
        rows = await self.conn.fetch(
            f"""
            SELECT id, process_code, process_name, block_owner, department_owner
            FROM {self.process_dict}
            WHERE is_actual = true
            ORDER BY process_code
            """
        )
        return [dict(r) for r in rows]

    async def get_terbanks(self) -> list[dict]:
        """Возвращает список актуальных территориальных банков."""
        rows = await self.conn.fetch(
            f"""
            SELECT tb_id, short_name, full_name
            FROM {self.terbank_dict}
            WHERE is_actual = true
            ORDER BY tb_id
            """
        )
        return [dict(r) for r in rows]

    async def get_metric_codes(self) -> list[dict]:
        """Возвращает список актуальных метрик нарушений."""
        rows = await self.conn.fetch(
            f"""
            SELECT id, code, metric_name, metric_group
            FROM {self.violation_metric_dict}
            WHERE is_actual = true
            ORDER BY code
            """
        )
        return [dict(r) for r in rows]

    async def get_departments(self) -> list[dict]:
        """Возвращает список актуальных подразделений с данными тербанка, ГОСБа и ВСП."""
        rows = await self.conn.fetch(
            f"""
            SELECT
                d.id,
                d.tb_id,
                d.gosb_id,
                d.vsp_id,
                d.subsidiary_id,
                tb.short_name AS tb_short_name,
                tb.full_name AS tb_full_name,
                g.gosb_name,
                v.vsp_urf_code,
                v.vsp_type
            FROM {self.departments} d
            LEFT JOIN {self.terbank_dict} tb ON tb.tb_id = d.tb_id AND tb.is_actual = true
            LEFT JOIN {self.gosb_dict} g ON g.gosb_id = d.gosb_id AND g.is_actual = true
            LEFT JOIN {self.vsp_dict} v ON v.vsp_id = d.vsp_id AND v.is_actual = true
            WHERE d.is_actual = true
            ORDER BY d.id
            LIMIT 5000
            """
        )
        return [dict(r) for r in rows]

    async def get_channels(self) -> list[dict]:
        """Возвращает список актуальных каналов."""
        rows = await self.conn.fetch(
            f"""
            SELECT id, channel
            FROM {self.channel_dict}
            WHERE is_actual = true
            ORDER BY id
            """
        )
        return [dict(r) for r in rows]

    async def get_products(self) -> list[dict]:
        """Возвращает список актуальных продуктов."""
        rows = await self.conn.fetch(
            f"""
            SELECT id, product_name
            FROM {self.product_dict}
            WHERE is_actual = true
            ORDER BY id
            """
        )
        return [dict(r) for r in rows]

    async def get_teams(self) -> list[dict]:
        """Возвращает список актуальных команд аудита."""
        rows = await self.conn.fetch(
            f"""
            SELECT id, tb_id, username
            FROM {self.team_dict}
            WHERE is_actual = true
            ORDER BY id
            """
        )
        return [dict(r) for r in rows]
