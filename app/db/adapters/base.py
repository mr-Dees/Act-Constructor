"""
Базовый абстрактный класс для database адаптеров.

Определяет интерфейс для работы с различными СУБД.
"""

from abc import ABC, abstractmethod
from collections.abc import Callable
from pathlib import Path

import asyncpg


class DatabaseAdapter(ABC):
    """
    Абстрактный класс для адаптеров баз данных.

    Каждая СУБД должна реализовать этот интерфейс для обеспечения
    единообразной работы с разными типами баз данных.
    """

    @abstractmethod
    async def create_tables(
        self,
        conn: asyncpg.Connection,
        schema_paths: list[Path],
        substitutions: dict[str, str | Callable[[], str]] | None = None,
    ) -> None:
        """
        Создает таблицы в БД из списка SQL-схем.

        Args:
            conn: Подключение к базе данных
            schema_paths: Пути к файлам schema.sql каждого домена
            substitutions: Подстановки плейсхолдеров в SQL (например, {REF_HADOOP_TABLES} → имя таблицы)
        """
        pass

    @abstractmethod
    def get_table_name(self, base_name: str) -> str:
        """
        Возвращает полное имя таблицы с учетом схемы/префикса.

        PostgreSQL: acts
        Greenplum: s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_acts

        Args:
            base_name: Базовое имя таблицы (acts, audit_team_members, etc.)

        Returns:
            Полное имя таблицы для использования в SQL
        """
        pass

    @abstractmethod
    def get_serial_type(self) -> str:
        """
        Возвращает тип для auto-increment колонок.

        PostgreSQL: SERIAL
        Greenplum: BIGSERIAL

        Returns:
            Название типа для использования в DDL
        """
        pass

    @abstractmethod
    def get_index_strategy(self, index_type: str) -> str:
        """
        Возвращает стратегию индексирования для конкретной СУБД.

        Args:
            index_type: Тип индекса (btree, gin, hash)

        Returns:
            Рекомендуемый тип индекса для данной СУБД
        """
        pass

    @abstractmethod
    def supports_cascade_delete(self) -> bool:
        """
        Проверяет поддержку ON DELETE CASCADE.

        Returns:
            True если СУБД поддерживает каскадное удаление
        """
        pass

    @abstractmethod
    def supports_on_conflict(self) -> bool:
        """
        Проверяет поддержку INSERT ... ON CONFLICT DO UPDATE.

        Returns:
            True если СУБД поддерживает ON CONFLICT
        """
        pass

    @abstractmethod
    async def get_current_schema(self, conn: asyncpg.Connection) -> str:
        """
        Возвращает текущую схему/namespace базы данных.

        Args:
            conn: Подключение к базе данных

        Returns:
            Название текущей схемы
        """
        pass

    def qualify_column(self, table_alias: str, column: str) -> str:
        """
        Квалифицирует имя колонки с учетом алиаса таблицы.

        Args:
            table_alias: Алиас таблицы
            column: Имя колонки

        Returns:
            Квалифицированное имя колонки (например, a.id)
        """
        return f"{table_alias}.{column}"
