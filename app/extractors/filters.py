"""
Модуль фильтрации актов по различным критериям.
"""

from datetime import date
from typing import Optional

import asyncpg


class ActFilters:
    """Построитель SQL-запросов с динамическими фильтрами для поиска актов."""

    @staticmethod
    async def search_acts(
            conn: asyncpg.Connection,
            inspection_names: Optional[list[str]] = None,
            cities: Optional[list[str]] = None,
            created_date_from: Optional[date] = None,
            created_date_to: Optional[date] = None,
            order_date_from: Optional[date] = None,
            order_date_to: Optional[date] = None,
            inspection_start_from: Optional[date] = None,
            inspection_start_to: Optional[date] = None,
            inspection_end_from: Optional[date] = None,
            inspection_end_to: Optional[date] = None,
            directive_numbers: Optional[list[str]] = None,
            with_metadata: bool = True
    ) -> list[dict]:
        """
        Поиск актов по набору фильтров.

        Args:
            conn: Подключение к БД
            inspection_names: Список названий проверок (частичное совпадение, ILIKE)
            cities: Список городов (частичное совпадение, ILIKE)
            created_date_from: Дата составления от
            created_date_to: Дата составления до
            order_date_from: Дата приказа от
            order_date_to: Дата приказа до
            inspection_start_from: Дата начала проверки от
            inspection_start_to: Дата начала проверки до
            inspection_end_from: Дата окончания проверки от
            inspection_end_to: Дата окончания проверки до
            directive_numbers: Список номеров поручений (частичное совпадение)
            with_metadata: Включать подробные метаданные

        Returns:
            Список словарей с информацией об актах
        """
        conditions = []
        params = []
        param_index = 1

        # Фильтр по названиям проверок (ILIKE для частичного совпадения)
        if inspection_names:
            name_conditions = []
            for name in inspection_names:
                name_conditions.append(f"a.inspection_name ILIKE ${param_index}")
                params.append(f"%{name}%")
                param_index += 1
            conditions.append(f"({' OR '.join(name_conditions)})")

        # Фильтр по городам
        if cities:
            city_conditions = []
            for city in cities:
                city_conditions.append(f"a.city ILIKE ${param_index}")
                params.append(f"%{city}%")
                param_index += 1
            conditions.append(f"({' OR '.join(city_conditions)})")

        # Фильтры по датам
        date_filters = [
            (created_date_from, "a.created_date >="),
            (created_date_to, "a.created_date <="),
            (order_date_from, "a.order_date >="),
            (order_date_to, "a.order_date <="),
            (inspection_start_from, "a.inspection_start_date >="),
            (inspection_start_to, "a.inspection_start_date <="),
            (inspection_end_from, "a.inspection_end_date >="),
            (inspection_end_to, "a.inspection_end_date <="),
        ]

        for date_value, condition in date_filters:
            if date_value:
                conditions.append(f"{condition} ${param_index}")
                params.append(date_value)
                param_index += 1

        # Фильтр по номерам поручений (JOIN с act_directives)
        if directive_numbers:
            directive_conditions = []
            for directive in directive_numbers:
                directive_conditions.append(f"ad.directive_number ILIKE ${param_index}")
                params.append(f"%{directive}%")
                param_index += 1

            conditions.append(
                f"""EXISTS (
                    SELECT 1 FROM act_directives ad
                    WHERE ad.act_id = a.id
                    AND ({' OR '.join(directive_conditions)})
                )"""
            )

        # Базовый запрос
        if with_metadata:
            base_query = """
                SELECT 
                    a.id,
                    a.km_number,
                    a.inspection_name,
                    a.city,
                    a.created_date,
                    a.order_number,
                    a.order_date,
                    a.inspection_start_date,
                    a.inspection_end_date,
                    a.is_process_based,
                    a.created_at,
                    a.updated_at,
                    a.created_by,
                    a.last_edited_by,
                    a.last_edited_at
                FROM acts a
            """
        else:
            base_query = """
                SELECT 
                    a.id,
                    a.km_number,
                    a.inspection_name,
                    a.city,
                    a.inspection_start_date,
                    a.inspection_end_date
                FROM acts a
            """

        # Добавляем WHERE если есть условия
        if conditions:
            base_query += " WHERE " + " AND ".join(conditions)

        # Сортировка по дате редактирования (последние первыми)
        base_query += " ORDER BY COALESCE(a.last_edited_at, a.created_at) DESC"

        # Выполняем запрос
        rows = await conn.fetch(base_query, *params)

        return [dict(row) for row in rows]

    @staticmethod
    def format_search_results(results: list[dict], with_metadata: bool = True) -> str:
        """
        Форматирует результаты поиска в человекочитаемый вид.

        Args:
            results: Результаты поиска
            with_metadata: Включать подробные метаданные

        Returns:
            Отформатированная строка
        """
        if not results:
            return "По заданным фильтрам актов не найдено."

        lines = [f"Найдено актов: {len(results)}\n"]

        for idx, act in enumerate(results, 1):
            lines.append(f"{idx}. КМ: {act['km_number']}")
            lines.append(f"   Проверка: {act['inspection_name']}")
            lines.append(f"   Город: {act['city']}")
            lines.append(
                f"   Период: {act['inspection_start_date']} - {act['inspection_end_date']}"
            )

            if with_metadata:
                lines.append(f"   Приказ: {act['order_number']} от {act['order_date']}")
                lines.append(f"   Дата акта: {act['created_date']}")
                lines.append(
                    f"   Тип: {'Процессная' if act['is_process_based'] else 'Функциональная'}"
                )
                lines.append(f"   Создан: {act['created_by']} ({act['created_at']})")
                if act['last_edited_by']:
                    lines.append(
                        f"   Последнее редактирование: {act['last_edited_by']} ({act['last_edited_at']})"
                    )

            lines.append("")  # Пустая строка между актами

        return "\n".join(lines)
