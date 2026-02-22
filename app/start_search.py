"""
Примеры использования детерминированных функций извлечения данных актов.

Этот скрипт демонстрирует все возможности API для работы с актами:
- Поиск и фильтрация актов
- Получение структуры и полного содержимого
- Извлечение пунктов, таблиц, текстовых блоков и нарушений
- Batch-обработка для множественных запросов
"""

import asyncio

from app.core.config import Settings
from app.db.connection import init_db, close_db
from app.integrations.ai_assistant.data_export import *

# Инициализируем настройки один раз на уровне модуля
settings = Settings()


# ============================================================================
# УПРАВЛЕНИЕ ПОДКЛЮЧЕНИЕМ К БД
# ============================================================================

async def ensure_db_initialized():
    """
    Гарантирует, что пул БД инициализирован.

    Проверяет состояние пула и инициализирует его если необходимо.
    Безопасно для множественных вызовов.
    """
    from app.db.connection import _pool

    if _pool is None:
        print("🔌 Инициализация пула подключений к БД...")
        await init_db(settings)
        print("✅ Пул подключений успешно создан")
        print(f"   📍 Подключено к: {settings.db_host}:{settings.db_port}/{settings.db_name}\n")
    else:
        print("ℹ️  Пул подключений уже инициализирован\n")


def print_section_header(title: str, emoji: str = "📋"):
    """Печатает красивый заголовок раздела."""
    separator = "=" * 80
    print(f"\n{separator}")
    print(f"{emoji}  {title.upper()}")
    print(separator)


def print_subsection_header(title: str, emoji: str = "📌"):
    """Печатает заголовок подраздела."""
    print(f"\n{emoji} {title}")
    print("─" * 80)


def print_result_preview(content: str, max_length: int = 300):
    """Печатает превью результата с ограничением длины."""
    if len(content) <= max_length:
        print(content)
    else:
        print(f"{content[:max_length]}")
        print(f"\n... (показаны первые {max_length} символов из {len(content)})")


# ============================================================================
# ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ
# ============================================================================

async def example_search():
    """
    Пример 1: Поиск и фильтрация актов.

    Демонстрирует различные способы поиска актов по метаданным:
    - По дате приказа
    - По названию проверки
    - По городу
    - По номеру поручения
    """
    await ensure_db_initialized()

    print_section_header("ПОИСК И ФИЛЬТРАЦИЯ АКТОВ", "🔍")

    # Поиск по дате приказа
    print_subsection_header("Поиск актов с датой приказа от 17.11.2025")
    print("Выполняется запрос: search_acts(order_date_from=date(2025, 11, 17))")

    result = await search_acts(
        order_date_from=date(2025, 11, 17)
    )
    print("\n📊 Результат поиска:")
    print_result_preview(result, 500)

    # Поиск по названию проверки (частичное совпадение)
    print_subsection_header("Поиск актов по частичному названию проверки")
    print("Выполняется запрос: search_acts(inspection_names=['Процесс'])")

    result = await search_acts(
        inspection_names=['Процесс', 'Кредит']
    )
    print("\n📊 Результат поиска:")
    print_result_preview(result, 500)

    # Комбинированный поиск
    print_subsection_header("Комбинированный поиск")
    print("Выполняется запрос: search_acts(cities=['Новосибирск'], with_metadata=True)")

    result = await search_acts(
        cities=['Новосибирск'],
        order_date_from=date(2025, 1, 1),
        with_metadata=True
    )
    print("\n📊 Результат поиска:")
    print_result_preview(result, 500)


async def example_structure():
    """
    Пример 2: Получение структуры актов.

    Демонстрирует:
    - Простое дерево структуры без статистики
    - Дерево со статистикой по элементам контента
    - Batch-получение структур нескольких актов
    """
    await ensure_db_initialized()

    print_section_header("СТРУКТУРА АКТОВ", "🌳")

    # Простая структура
    print_subsection_header("Простая структура акта (без статистики)")
    print("Выполняется запрос: get_act_structure('111', with_statistics=False)")

    structure = await get_act_structure("111", with_statistics=False)
    print("\n📊 Структура акта:")
    print_result_preview(structure, 600)

    # Структура со статистикой
    print_subsection_header("Структура со статистикой по элементам")
    print("Выполняется запрос: get_act_structure('111', with_statistics=True)")

    structure_stats = await get_act_structure("111", with_statistics=True)
    print("\n📊 Структура с подсчетом элементов:")
    print_result_preview(structure_stats, 600)

    # Batch-получение структур
    print_subsection_header("Получение структур нескольких актов батчем")
    print("Выполняется запрос: get_act_structures_batch(['111', '222'])")

    structures = await get_act_structures_batch(
        ["111", "222"],
        with_statistics=True
    )
    print(f"\n📊 Получено структур: {len(structures)}")
    for km, struct in structures.items():
        print(f"\n  🔹 КМ {km}:")
        print_result_preview(struct, 200)


async def example_full_acts():
    """
    Пример 3: Получение полного содержимого актов.

    Демонстрирует:
    - Получение одного акта с метаданными
    - Получение акта без метаданных
    - Batch-получение нескольких актов
    """
    await ensure_db_initialized()

    print_section_header("ПОЛНОЕ СОДЕРЖИМОЕ АКТОВ", "📄")

    # Один акт с метаданными
    print_subsection_header("Получение полного акта с метаданными")
    print("Выполняется запрос: get_act_by_km('111', with_metadata=True)")

    act = await get_act_by_km("111", with_metadata=True)
    print("\n📊 Полный текст акта:")
    print_result_preview(act, 800)

    # Один акт без метаданных
    print_subsection_header("Получение акта без метаданных")
    print("Выполняется запрос: get_act_by_km('111', with_metadata=False)")

    act_no_meta = await get_act_by_km("111", with_metadata=False)
    print("\n📊 Содержимое без метаданных:")
    print_result_preview(act_no_meta, 600)

    # Несколько актов батчем
    print_subsection_header("Получение нескольких актов батчем")
    print("Выполняется запрос: get_acts_by_km_list(['111', '222'])")

    acts = await get_acts_by_km_list(
        ["111", "222"],
        with_metadata=False
    )
    print(f"\n📊 Получено актов: {len(acts)}")
    for km, content in acts.items():
        print(f"\n  🔹 КМ {km}:")
        print_result_preview(content, 300)


async def example_items():
    """
    Пример 4: Работа с пунктами актов.

    Демонстрирует:
    - Рекурсивное извлечение пункта с подпунктами
    - Нерекурсивное извлечение (только прямое содержимое)
    - Ограничение глубины рекурсии
    - Batch-получение нескольких пунктов
    """
    await ensure_db_initialized()

    print_section_header("ИЗВЛЕЧЕНИЕ ПУНКТОВ АКТОВ", "📑")

    # Рекурсивное извлечение
    print_subsection_header("Пункт с подпунктами (рекурсивно)")
    print("Выполняется запрос: get_item_by_number('111', '5.1.1', recursive=True)")

    item = await get_item_by_number(
        "111",
        "5.1.1",
        with_metadata=False,
        recursive=True
    )
    print("\n📊 Пункт 5.1.1 со всеми подпунктами:")
    print_result_preview(item, 600)

    # Нерекурсивное извлечение
    print_subsection_header("Только содержимое пункта (без подпунктов)")
    print("Выполняется запрос: get_item_by_number('111', '5.1.1', recursive=False)")

    item_no_children = await get_item_by_number(
        "111",
        "5.1.1",
        with_metadata=False,
        recursive=False
    )
    print("\n📊 Только прямое содержимое пункта 5.1.1:")
    print_result_preview(item_no_children, 400)

    # С ограничением глубины
    print_subsection_header("Пункт с ограничением глубины рекурсии")
    print("Выполняется запрос: get_item_by_number('111', '5.1', max_depth=2)")

    item_limited = await get_item_by_number(
        "111",
        "5.1",
        with_metadata=False,
        recursive=True,
        max_depth=2
    )
    print("\n📊 Пункт 5.1 (глубина до 2 уровней):")
    print_result_preview(item_limited, 600)

    # Несколько пунктов батчем
    print_subsection_header("Получение нескольких пунктов батчем")
    print("Выполняется запрос: get_item_by_number('111', ['5.1.1', '5.1.2'])")

    items = await get_item_by_number(
        "111",
        ["5.1.1", "5.1.2"],
        recursive=True
    )
    print(f"\n📊 Получено пунктов: {len(items)}")
    for num, content in items.items():
        print(f"\n  🔹 Пункт {num}:")
        print_result_preview(content, 300)


async def example_violations():
    """
    Пример 5: Работа с нарушениями.

    Демонстрирует:
    - Все нарушения акта
    - Нарушения по конкретному пункту
    - Извлечение только определенных полей нарушений
    - Batch-обработка
    """
    await ensure_db_initialized()

    print_section_header("ИЗВЛЕЧЕНИЕ НАРУШЕНИЙ", "⚠️")

    # Все нарушения акта
    print_subsection_header("Все нарушения акта")
    print("Выполняется запрос: get_all_violations('111', with_metadata=True)")

    violations = await get_all_violations("111", with_metadata=True)
    print("\n📊 Все нарушения:")
    print_result_preview(violations, 600)

    # Нарушения по пункту (нерекурсивно)
    print_subsection_header("Нарушения в конкретном пункте (без подпунктов)")
    print("Выполняется запрос: get_violation_by_item('111', '5.1.1.1', recursive=False)")

    violations_item = await get_violation_by_item(
        "111",
        "5.1.1.1",
        recursive=False
    )
    print("\n📊 Нарушения в пункте 5.1.1.1:")
    print_result_preview(violations_item, 500)

    # Нарушения по пункту (рекурсивно)
    print_subsection_header("Нарушения в пункте и подпунктах")
    print("Выполняется запрос: get_violation_by_item('111', '5.1', recursive=True)")

    violations_recursive = await get_violation_by_item(
        "111",
        "5.1",
        recursive=True
    )
    print("\n📊 Нарушения в пункте 5.1 и всех подпунктах:")
    print_result_preview(violations_recursive, 600)

    # Только конкретные поля
    print_subsection_header("Извлечение только определенных полей")
    print("Выполняется запрос: get_violation_fields('111', '5.1', ['case', 'reasons'])")

    specific_fields = await get_violation_fields(
        "111",
        "5.1",
        ["case", "reasons"],
        recursive=True
    )
    print("\n📊 Только поля 'case' и 'reasons':")
    print_result_preview(specific_fields, 500)

    # Дополнительный контент
    print_subsection_header("Извлечение дополнительного контента")
    print("Выполняется запрос: get_violation_fields('111', '5.1.1', ['additional_content'])")

    additional = await get_violation_fields(
        "111",
        "5.1.1",
        ["additional_content"],
        recursive=False
    )
    print("\n📊 Дополнительный контент нарушений:")
    print_result_preview(additional, 500)

    # Batch-обработка
    print_subsection_header("Нарушения по нескольким пунктам батчем")
    print("Выполняется запрос: get_violation_by_item('111', ['5.1.2', '5.1.1.1'])")

    violations_batch = await get_violation_by_item(
        "111",
        ["5.1.2", "5.1.1.1"],
        recursive=False
    )
    print(f"\n📊 Получено результатов: {len(violations_batch)}")
    for num, content in violations_batch.items():
        print(f"\n  🔹 Пункт {num}:")
        print_result_preview(content, 200)


async def example_tables():
    """
    Пример 6: Работа с таблицами.

    Демонстрирует:
    - Все таблицы акта
    - Таблицы по конкретному пункту
    - Поиск таблицы по названию
    - Batch-обработку таблиц
    - Множественный поиск (несколько пунктов × несколько названий)
    """
    await ensure_db_initialized()

    print_section_header("ИЗВЛЕЧЕНИЕ ТАБЛИЦ", "📊")

    # Все таблицы акта
    print_subsection_header("Все таблицы акта")
    print("Выполняется запрос: get_all_tables('111', with_metadata=True)")

    tables = await get_all_tables("111", with_metadata=True)
    print("\n📊 Все таблицы:")
    print_result_preview(tables, 600)

    # Таблицы по пункту
    print_subsection_header("Таблицы в конкретном пункте")
    print("Выполняется запрос: get_all_tables_in_item('111', '5.1.1.1', recursive=False)")

    tables_item = await get_all_tables_in_item(
        "111",
        "5.1.1.1",
        recursive=False
    )
    print("\n📊 Таблицы в пункте 5.1.1.1:")
    print_result_preview(tables_item, 500)

    # Таблицы по нескольким пунктам
    print_subsection_header("Таблицы по нескольким пунктам батчем")
    print("Выполняется запрос: get_all_tables_in_item('111', ['5.1.2', '5.1.1.1'])")

    tables_batch = await get_all_tables_in_item(
        "111",
        ["5.1.2", "5.1.1.1"],
        recursive=False
    )
    print(f"\n📊 Получено результатов: {len(tables_batch)}")
    for num, content in tables_batch.items():
        print(f"\n  🔹 Пункт {num}:")
        print_result_preview(content, 300)

    # Поиск таблицы по названию
    print_subsection_header("Поиск таблицы по частичному названию")
    print("Выполняется запрос: get_table_by_name('111', '5.1.1.1', 'операционного риска')")

    table_by_name = await get_table_by_name(
        "111",
        "5.1.1.1",
        "операционного риска",
        recursive=False
    )
    print("\n📊 Найденная таблица:")
    print_result_preview(table_by_name, 400)

    # Множественный поиск (несколько пунктов × несколько названий)
    print_subsection_header("Матричный поиск таблиц")
    print("Выполняется запрос: get_table_by_name('111', ['5.1.1.1', '5.1.1.2'], ['операционного', 'регуляторного'])")

    tables_matrix = await get_table_by_name(
        "111",
        ["5.1.1.1", "5.1.1.2"],
        ["операционного риска", "регуляторного риска"],
        recursive=False
    )
    print(f"\n📊 Матрица результатов ({len(tables_matrix)} пунктов):")

    for item_num, tables_dict in tables_matrix.items():
        print(f"\n  📍 ПУНКТ: {item_num}")
        print("  " + "─" * 76)

        for table_name, table_content in tables_dict.items():
            print(f"\n    🔍 Поиск: '{table_name}'")

            if "нет таблицы" in table_content.lower():
                print(f"    ❌ Не найдено")
            else:
                print(f"    ✅ Найдено")
                preview = table_content[:200].replace("\n", "\n    ")
                print(f"\n    {preview}")
                if len(table_content) > 200:
                    print(f"    ... (ещё {len(table_content) - 200} символов)")


async def example_textblocks():
    """
    Пример 7: Работа с текстовыми блоками.

    Демонстрирует:
    - Все текстовые блоки акта
    - Текстовые блоки по конкретному пункту
    - Batch-обработку
    """
    await ensure_db_initialized()

    print_section_header("ИЗВЛЕЧЕНИЕ ТЕКСТОВЫХ БЛОКОВ", "📝")

    # Все текстовые блоки
    print_subsection_header("Все текстовые блоки акта")
    print("Выполняется запрос: get_all_textblocks('111', with_metadata=True)")

    textblocks = await get_all_textblocks("111", with_metadata=True)
    print("\n📊 Все текстовые блоки:")
    print_result_preview(textblocks, 600)

    # Текстовые блоки по пункту
    print_subsection_header("Текстовые блоки в конкретном пункте")
    print("Выполняется запрос: get_textblocks_by_item('111', '5.1.1.1', recursive=False)")

    textblocks_item = await get_textblocks_by_item(
        "111",
        "5.1.1.1",
        recursive=False
    )
    print("\n📊 Текстовые блоки в пункте 5.1.1.1:")
    print_result_preview(textblocks_item, 500)

    # Batch-обработка
    print_subsection_header("Текстовые блоки по нескольким пунктам")
    print("Выполняется запрос: get_textblocks_by_item('111', ['5.1.2', '5.1.1.1'])")

    textblocks_batch = await get_textblocks_by_item(
        "111",
        ["5.1.2", "5.1.1.1"],
        recursive=False
    )
    print(f"\n📊 Получено результатов: {len(textblocks_batch)}")
    for num, content in textblocks_batch.items():
        print(f"\n  🔹 Пункт {num}:")
        print_result_preview(content, 300)


async def run_all_examples():
    """
    Запускает все примеры последовательно.

    Демонстрирует полный функционал API для работы с актами.
    Использует единый пул подключений для всех примеров.
    """
    print("=" * 80)
    print("🚀 ДЕМОНСТРАЦИЯ API ДЛЯ ИЗВЛЕЧЕНИЯ ДАННЫХ АКТОВ")
    print("=" * 80)
    print("\nЭтот скрипт демонстрирует все возможности детерминированного API.")
    print("Используется единое подключение к БД для всех примеров.\n")

    examples = [
        ("Поиск и фильтрация", example_search),
        ("Структура актов", example_structure),
        ("Полное содержимое", example_full_acts),
        ("Пункты актов", example_items),
        ("Нарушения", example_violations),
        ("Таблицы", example_tables),
        ("Текстовые блоки", example_textblocks),
    ]

    try:
        for idx, (name, func) in enumerate(examples, 1):
            print(f"\n{'🔵' * 40}")
            print(f"📦 ПРИМЕР {idx}/{len(examples)}: {name.upper()}")
            print(f"{'🔵' * 40}")

            try:
                await func()
                print(f"\n✅ Пример '{name}' успешно выполнен")
            except Exception as e:
                print(f"\n❌ Ошибка в примере '{name}': {e}")
                import traceback
                traceback.print_exc()

            # Задержка между примерами для наглядности
            if idx < len(examples):
                print("\n⏸️  Переход к следующему примеру...")
                await asyncio.sleep(0.5)

        print("\n" + "=" * 80)
        print("🎉 ВСЕ ПРИМЕРЫ УСПЕШНО ВЫПОЛНЕНЫ!")
        print("=" * 80)

    finally:
        # Закрываем пул только в самом конце
        print("\n🔌 Закрытие пула подключений к БД...")
        await close_db()
        print("✅ Пул подключений корректно закрыт")


# ============================================================================
# ТОЧКА ВХОДА
# ============================================================================

if __name__ == "__main__":
    # Режим 1: Все примеры
    asyncio.run(run_all_examples())

    # Режим 2: Один пример (раскомментируй нужный)
    # async def run_single():
    #     try:
    #         await example_search()        # Поиск
    #         # await example_structure()   # Структура
    #         # await example_full_acts()   # Полное содержимое
    #         # await example_items()       # Пункты
    #         # await example_violations()  # Нарушения
    #         # await example_tables()      # Таблицы
    #         # await example_textblocks()  # Текстовые блоки
    #     finally:
    #         await close_db()
    # asyncio.run(run_single())
