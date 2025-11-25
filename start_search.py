import asyncio
from app.extractors import (
    get_act_by_km,
    get_acts_by_km_list,
    get_act_structure,
    get_item_by_number,
    get_items_by_number_list,
    get_all_tables_in_item,
    get_tables_by_item_list,
    get_table_by_name,
    get_all_violations,
    get_violation_by_item,
    get_violations_by_item_list,
    get_violation_field
)

async def main():
    km_number = "111"
    selected_items = ["5", "5.1", "5.2.1"]

    # print("=== 1. Весь акт целиком ===")
    # print(await get_act_by_km(km_number, with_metadata=True))
    # print("\n" + "="*60)


    # print("=== 2. Структура акта ===")
    # print(await get_act_structure(km_number, with_statistics=False))
    # print("\n" + "-"*60)
    # print(await get_act_structure(km_number, with_statistics=True))
    # print("\n" + "="*60)


    # print("=== 3. Пункты акта ===")
    # # a) Один пункт глубоко с вложенным содержимым
    # print("-- Вложенный пункт с детьми --")
    # print(await get_item_by_number(km_number, "5.1.1", recursive=True))
    # print("\n" + "-" * 60)
    #
    # # b) Только данный уровень (без вложенности)
    # print("-- Только сам пункт (без вложенных) --")
    # print(await get_item_by_number(km_number, "5.1", recursive=False))
    # print("\n" + "-" * 60)
    #
    # # c) Батч по двум пунктам
    # print("-- Батч пункты --")
    # batch_items = await get_items_by_number_list(km_number, ["5.1.1", "5.1.2"], recursive=True)
    # for num, txt in batch_items.items():
    #     print(f"\nПункт {num}:\n{txt}")
    # print("\n" + "="*60)


    # print("=== 4. Таблицы ===")
    # # a) Все таблицы в разделе 5 (глубоко)
    # print("-- Все таблицы в разделе 5 и подпунктах --")
    # print(await get_all_tables_in_item(km_number, "5", recursive=True))
    # # b) Только верхний уровень
    # print("-- Только таблицы в 5 без подпунктов --")
    # print(await get_all_tables_in_item(km_number, "5", recursive=False))
    # # c) Таблица по названию
    # print("-- Поиск таблицы по частичному названию 'метрик' в разделе 5 --")
    # print(await get_table_by_name(km_number, "5", "метрик", recursive=True))
    # # d) Батч по двум пунктам
    # print("-- Батч таблиц --")
    # batch_tables = await get_tables_by_item_list(km_number, ["5.1", "5.2"], recursive=True)
    # for num, txt in batch_tables.items():
    #     print(f"\nТаблицы для пункта {num}:\n{txt}")
    # print("\n" + "="*60)


    # print("=== 5. Нарушения ===")
    # # a) Все нарушения акта
    # print("-- Все нарушения акта --")
    # print(await get_all_violations(km_number))
    # # b) Нарушения только в 5.2 с вложенными
    # print("-- Нарушения в 5.2 и подпунктах --")
    # print(await get_violation_by_item(km_number, "5.2", recursive=True))
    # # c) Нарушения только прямо в 5.2
    # print("-- Нарушения только в 5.2 без вложенных --")
    # print(await get_violation_by_item(km_number, "5.2", recursive=False))
    # # d) Батч по нескольким пунктам
    # print("-- Батч нарушений по пунктам --")
    # batch_violations = await get_violations_by_item_list(km_number, ["5.1", "5.2"], recursive=True)
    # for num, txt in batch_violations.items():
    #     print(f"\nНарушения для пункта {num}:\n{txt}")
    # print("\n" + "="*60)


    print("=== 6. Отдельные поля нарушений ===")
    # Кейсы по всему разделу 5 (глубоко)
    print("-- Кейсы по всем нарушениям раздела 5 --")
    print(await get_violation_field(km_number, "5", "case", recursive=True))
    # Ответственные только в этом пункте (без вложенных)
    print("-- Ответственные из нарушений только в 5.2 (без подпунктов) --")
    print(await get_violation_field(km_number, "5.2", "responsible", recursive=False))

    print("\n" + "="*60)

    # print("=== 7. Батчовый запрос актов ===")
    # batch_kms = ["111", "222"]
    # acts = await get_acts_by_km_list(batch_kms)
    # for km, text in acts.items():
    #     print(f"\n=== {km} ===\n{text}")

if __name__ == "__main__":
    asyncio.run(main())