"""
Примеры использования детерминированных функций извлечения данных.
"""

import asyncio

from app.extractors.api import *


async def example_search():
    """Пример поиска актов с фильтрами."""

    # Поиск с параметрами
    result = await search_acts(
        order_date_from=date(2025, 11, 17)
    )
    print(result)


async def example_full_acts():
    """Пример получения полных актов."""

    # Один акт
    act = await get_act_by_km("111", with_metadata=True)
    print(act)

    # Несколько актов батчем
    acts = await get_acts_by_km_list(
        ["111", "222"],
        with_metadata=False
    )
    for km, content in acts.items():
        print(f"\n=== {km} ===\n{content}")


async def example_structure():
    """Пример получения структуры."""

    # Простая структура
    structure = await get_act_structure("111", with_statistics=False)
    print(structure, '\n\n')

    # Со статистикой
    structure_stats = await get_act_structure("111", with_statistics=True)
    print(structure_stats)


async def example_items():
    """Пример работы с пунктами."""

    # Конкретный пункт с подпунктами
    item = await get_item_by_number(
        "111",
        "5.1.1",
        with_metadata=False,
        recursive=True
    )
    print(item, '\n\n', '-' * 80)

    # Только указанный пункт без детей
    item_no_children = await get_item_by_number(
        "111",
        "5.1.1",
        with_metadata=False,
        recursive=False
    )
    print(item_no_children, '\n\n')

    # Несколько пунктов батчем
    items = await get_items_by_number_list(
        "111",
        ["5.1.1", "5.1.2"],
        recursive=True
    )
    for num, content in items.items():
        print(f"\n=== Пункт {num} ===\n{content}")


async def example_violations():
    """Пример работы с нарушениями."""

    # Все нарушения акта
    violations = await get_all_violations("111", with_metadata=True)
    print(violations, '\n\n')

    # Нарушения по пункту
    violations_item = await get_violation_by_item(
        "111",
        "5.1.1.1",
        recursive=False
    )
    print(violations_item, '\n\n', '-' * 80)

    # Только конкретное поле нарушений
    consequences = await get_violation_fields(
        "111",
        "5.1",
        ["case", "reasons"],
        recursive=True
    )
    print(consequences, '\n\n', '-' * 80)

    # Только конкретное поле нарушений
    consequences = await get_violation_fields(
        "111",
        "5.1.1",
        ["additional_content"],
        recursive=False
    )
    print(consequences, '\n\n', '-' * 80)

    violations_item = await get_violation_by_item(
        "111",
        ["5.1.2", "5.1.1.1"],
        recursive=False
    )
    for num, content in violations_item.items():
        print(f"\n=== Пункт {num} ===\n{content}")


async def example_tables():
    """Пример работы с таблицами."""

    # Все таблицы акта
    tables = await get_all_tables("111", with_metadata=True)
    print(tables, '\n\n', '-' * 80)

    # Таблицы по пункту
    tables_item = await get_all_tables_in_item(
        "111",
        "5.1.1.1",
        recursive=False
    )
    print(tables_item, '\n\n', '-' * 80)

    tables_item = await get_all_tables_in_item(
        "111",
        ["5.1.2", "5.1.1.1"],
        recursive=False
    )
    for num, content in tables_item.items():
        print(f"\n=== Пункт {num} ===\n{content}")
    print('\n\n', '-' * 80)

    # Конкретная таблица по названию
    table = await get_table_by_name(
        "111",
        ["5.1.1.1", "5.1.1.2"],
        ["операционного риска", "регулярного риска"],  # частичное совпадение
        recursive=False
    )
    for item_num, tables_dict in table.items():
        print(f"\n{'─' * 80}")
        print(f"📍 ПУНКТ: {item_num}")
        print(f"{'─' * 80}")

        for table_name, table_content in tables_dict.items():
            print(f"\n  🔍 Поиск по названию: '{table_name}'")

            # Проверяем, найдена ли таблица
            if "нет таблицы" in table_content.lower():
                print(f"  ❌ {table_content}")
            else:
                print(f"  ✅ Таблица найдена:")
                print(f"  {'-' * 76}")
                # Выводим первые 300 символов таблицы
                preview = table_content[:300].replace("\n", "\n  ")
                print(f"  {preview}")
                if len(table_content) > 300:
                    print(f"  ... (всего {len(table_content)} символов)")
                print(f"  {'-' * 76}")



async def example_textblocks():
    """Пример работы с текстовыми блоками."""

    # Все текстовые блоки
    textblocks = await get_all_textblocks("111", with_metadata=True)
    print(textblocks, '\n\n', '-' * 80)

    # Текстовые блоки по пункту
    textblocks_item = await get_textblocks_by_item(
        "111",
        ["5.1.2", "5.1.1.1"],
        recursive=False
    )
    for num, content in textblocks_item.items():
        print(f"\n=== Пункт {num} ===\n{content}")


if __name__ == "__main__":
    pass
    # Запуск примеров
    # asyncio.run(example_search())       # Работает
    # asyncio.run(example_structure())    # Работает
    # asyncio.run(example_full_acts())    # Работает
    asyncio.run(example_items())        # Работает
    # asyncio.run(example_violations())  # Работает
    # asyncio.run(example_tables())  # Работает
    # asyncio.run(example_textblocks())   # Работает
