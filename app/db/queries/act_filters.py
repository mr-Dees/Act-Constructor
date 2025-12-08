"""
Модуль фильтрации актов по заданным критериям.

Содержит класс ActFilters для построения SQL-запросов поиска по различным метаданным
чек-листовых актов. Включает методы для поиска и форматирования результатов.
"""

from datetime import date
from typing import Optional

import asyncpg


class ActFilters:
    """
    Построитель SQL-запросов с динамическими фильтрами для поиска актов.

    Позволяет искать акты с помощью гибкой системы фильтров по метаданным:
    названию проверки, городу, датам и номерам поручений.
    """

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
        Выполняет поиск актов по переданным фильтрам.

        Фильтры могут комбинироваться. Текстовые фильтры используют ILIKE
        для поиска по подстроке (частичное совпадение).

        Args:
            conn: Открытое асинхронное подключение к БД.
            inspection_names: Список частей названий проверок.
            cities: Список городов.
            created_date_from: Дата акта не раньше указанной.
            created_date_to: Дата акта не позднее указанной.
            order_date_from: Дата приказа не раньше указанной.
            order_date_to: Дата приказа не позднее указанной.
            inspection_start_from: Начало периода проверки >=.
            inspection_start_to: Начало периода проверки <=.
            inspection_end_from: Окончание периода проверки >=.
            inspection_end_to: Окончание периода проверки <=.
            directive_numbers: Поиск по номерам поручений (или их частям).
            with_metadata: Добавлять ли к результату все метаданные.

        Returns:
            Список словарей — найденные акты с запрошенными полями.
        """
        conditions = []
        params = []
        param_index = 1  # Индексация параметров для asyncpg

        # --- Текстовые фильтры по названию проверки ---
        if inspection_names:
            name_conditions = []
            for name in inspection_names:
                name_conditions.append(f"a.inspection_name ILIKE ${param_index}")
                params.append(f"%{name}%")
                param_index += 1
            conditions.append(f"({' OR '.join(name_conditions)})")

        # --- Фильтр по городам ---
        if cities:
            city_conditions = []
            for city in cities:
                city_conditions.append(f"a.city ILIKE ${param_index}")
                params.append(f"%{city}%")
                param_index += 1
            conditions.append(f"({' OR '.join(city_conditions)})")

        # --- Фильтры по датам ---
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

        # --- Фильтр по номерам поручений (JOIN c act_directives) ---
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

        # --- Основной SELECT ---
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

        # --- WHERE условия ---
        if conditions:
            base_query += " WHERE " + " AND ".join(conditions)

        # --- Сортировка: последние редактированные первыми ---
        base_query += " ORDER BY COALESCE(a.last_edited_at, a.created_at) DESC"

        # --- Выполнение SQL ---
        rows = await conn.fetch(base_query, *params)

        # Возврат результатов в виде словарей
        return [dict(row) for row in rows]

    @staticmethod
    def format_search_results(results: list[dict], with_metadata: bool = True) -> str:
        """
        Форматирует результаты поиска в человекочитаемый текстовый вид.

        Для каждого акта отображает краткую метаинформацию.

        Args:
            results: Список найденных актов.
            with_metadata: Полная информация или кратко.

        Returns:
            Строка для удобного просмотра результата.
        """
        if not results:
            return "По заданным фильтрам актов не найдено."

        lines = [f"Найдено актов: {len(results)}\n"]
        for idx, act in enumerate(results, 1):
            lines.append(f"{idx}. КМ: {act['km_number']}")
            lines.append(f"   Проверка: {act['inspection_name']}")
            lines.append(f"   Город: {act['city']}")
            lines.append(
                f"   Период: {act.get('inspection_start_date')} - {act.get('inspection_end_date')}"
            )

            if with_metadata:
                lines.append(f"   Приказ: {act.get('order_number')} от {act.get('order_date')}")
                lines.append(f"   Дата акта: {act.get('created_date')}")
                lines.append(
                    f"   Тип: {'Процессная' if act.get('is_process_based') else 'Функциональная'}"
                )
                lines.append(f"   Создан: {act.get('created_by')} ({act.get('created_at')})")
                if act.get('last_edited_by'):
                    lines.append(
                        f"   Последнее редактирование: {act.get('last_edited_by')} ({act.get('last_edited_at')})"
                    )

            lines.append("")  # Пустая строка между актами

        return "\n".join(lines)
