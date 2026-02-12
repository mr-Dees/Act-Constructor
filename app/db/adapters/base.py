"""
Базовый абстрактный класс для database адаптеров.

Определяет интерфейс для работы с различными СУБД.
"""

from abc import ABC, abstractmethod

import asyncpg


class DatabaseAdapter(ABC):
    """
    Абстрактный класс для адаптеров баз данных.

    Каждая СУБД должна реализовать этот интерфейс для обеспечения
    единообразной работы с разными типами баз данных.
    """

    @abstractmethod
    async def create_tables(self, conn: asyncpg.Connection) -> None:
        """
        Создает таблицы в БД согласно схеме для конкретной СУБД.

        Args:
            conn: Подключение к базе данных
        """
        pass

    @abstractmethod
    async def delete_act_cascade(
            self,
            conn: asyncpg.Connection,
            act_id: int
    ) -> None:
        """
        Удаляет акт со всеми связанными данными.

        PostgreSQL использует ON DELETE CASCADE.
        Greenplum требует явного удаления в правильном порядке.

        Args:
            conn: Подключение к базе данных
            act_id: ID акта для удаления
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
    async def get_current_schema(self, conn: asyncpg.Connection) -> str:
        """
        Возвращает текущую схему/namespace базы данных.

        Args:
            conn: Подключение к базе данных

        Returns:
            Название текущей схемы
        """
        pass

    @abstractmethod
    async def upsert_invoice(
            self,
            conn: asyncpg.Connection,
            table_name: str,
            data: dict,
            username: str,
    ) -> asyncpg.Record:
        """
        Вставляет или обновляет фактуру (UPSERT по act_id + node_id).

        PostgreSQL использует INSERT ... ON CONFLICT DO UPDATE.
        Greenplum требует явного UPDATE + INSERT.

        Args:
            conn: Подключение к базе данных
            table_name: Полное имя таблицы act_invoices
            data: Словарь с данными фактуры
            username: Имя пользователя

        Returns:
            Запись с данными сохраненной фактуры
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

    @abstractmethod
    def get_distributed_by_clause(self, table_name: str) -> str:
        """
        Возвращает DISTRIBUTED BY clause для таблицы (только Greenplum).

        PostgreSQL: пустая строка
        Greenplum: DISTRIBUTED BY (column)

        Args:
            table_name: Базовое имя таблицы

        Returns:
            DISTRIBUTED BY clause или пустая строка
        """
        pass
