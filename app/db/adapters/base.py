"""
Базовый абстрактный класс для database адаптеров.

Определяет интерфейс для работы с различными СУБД.
"""

import re
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

    @staticmethod
    def _extract_table_names_from_sql(sql: str) -> list[str]:
        """
        Извлекает имена таблиц из CREATE TABLE операторов в SQL.

        Args:
            sql: SQL-текст после подстановки плейсхолдеров

        Returns:
            Список имён таблиц в порядке их появления в SQL
        """
        pattern = r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s*\('
        return re.findall(pattern, sql, re.IGNORECASE)

    @abstractmethod
    async def _get_existing_tables(
        self,
        conn: asyncpg.Connection,
        expected_names: list[str],
    ) -> set[str]:
        """
        Проверяет, какие из ожидаемых таблиц уже существуют в БД.

        Args:
            conn: Подключение к базе данных
            expected_names: Список ожидаемых имён таблиц (как в SQL)

        Returns:
            Множество имён существующих таблиц
        """
        pass

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

    @staticmethod
    def _split_sql_statements(sql: str) -> list[str]:
        """
        Разделяет SQL-текст на отдельные операторы.

        Корректно обрабатывает:
        - Разделение по `;`
        - Dollar-quoting (`$$...$$` и `$tag$...$tag$`) — не разбивает внутри
        - Блочные комментарии (`/* ... */`)
        - Однострочные комментарии (`--`)
        - Строковые литералы (`'...'` с экранированием `''`)
        """
        statements = []
        current_pos = 0
        i = 0
        n = len(sql)

        while i < n:
            c = sql[i]

            # Однострочный комментарий: пропускаем до конца строки
            if c == '-' and i + 1 < n and sql[i + 1] == '-':
                i = sql.find('\n', i)
                if i == -1:
                    break
                i += 1
                continue

            # Блочный комментарий /* ... */
            if c == '/' and i + 1 < n and sql[i + 1] == '*':
                end = sql.find('*/', i + 2)
                if end != -1:
                    i = end + 2
                else:
                    i = n
                continue

            # Строковый литерал в одинарных кавычках
            if c == "'":
                i += 1
                while i < n:
                    if sql[i] == "'":
                        if i + 1 < n and sql[i + 1] == "'":
                            i += 2  # экранированная кавычка
                        else:
                            i += 1
                            break
                    i += 1
                continue

            # Dollar-quoting ($$ или $tag$)
            if c == '$':
                m = re.match(r'\$(\w*)\$', sql[i:])
                if m:
                    tag = m.group(0)
                    end = sql.find(tag, i + len(tag))
                    if end != -1:
                        i = end + len(tag)
                    else:
                        i = n
                    continue

            # Разделитель операторов
            if c == ';':
                stmt = sql[current_pos:i + 1].strip()
                if stmt and stmt != ';':
                    # Пропускаем операторы, содержащие только комментарии
                    content = re.sub(r'/\*.*?\*/', '', stmt, flags=re.DOTALL)
                    content = re.sub(r'--[^\n]*', '', content).strip()
                    if content and content != ';':
                        statements.append(stmt)
                current_pos = i + 1

            i += 1

        # Оставшийся текст
        remaining = sql[current_pos:].strip()
        if remaining:
            content = re.sub(r'/\*.*?\*/', '', remaining, flags=re.DOTALL)
            content = re.sub(r'--[^\n]*', '', content).strip()
            if content:
                statements.append(remaining)

        return statements

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
