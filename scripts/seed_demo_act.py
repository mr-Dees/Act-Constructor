"""Seed демо-акта «Овернайт-выписки корпклиентов» (КМ-99-99999) в БД.

Использует доменные сервисы и репозитории, уважает .env, идемпотентен.

Запуск:
    python -m scripts.seed_demo_act                    # создать, выйти если уже есть
    python -m scripts.seed_demo_act --replace          # удалить старый и создать заново
    python -m scripts.seed_demo_act --username NNNN   # задать username создателя
"""
import argparse
import asyncio
import logging
import sys
from datetime import date

from app.core.config import get_settings
from app.db.connection import init_db, get_pool, close_db
from app.domains.acts.repositories.act_crud import ActCrudRepository
from app.domains.acts.repositories.act_content import ActContentRepository
from app.domains.acts.services.act_crud_service import ActCrudService
from app.domains.acts.settings import ActsSettings
from app.domains.acts.schemas.act_metadata import ActCreate, AuditTeamMember
from app.domains.acts.schemas.act_content import (
    ActDataSchema,
    TableSchema,
    TableCellSchema,
    TextBlockSchema,
    TextBlockFormattingSchema,
    ViolationSchema,
    ViolationOptionalFieldSchema,
)

logger = logging.getLogger("seed_demo_act")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

DEMO_KM = "КМ-99-99999"
DEMO_USERNAME = "99999999"


async def main(replace: bool, username: str) -> int:
    settings = get_settings()
    await init_db(settings)
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            # Ищем существующий демо-акт напрямую через репозиторий
            crud_repo = ActCrudRepository(conn)
            existing_id = await _find_demo_act(conn, crud_repo)

            if existing_id is not None:
                if not replace:
                    logger.info(
                        "Демо-акт уже существует (act_id=%d). "
                        "Используйте --replace для пересоздания.",
                        existing_id,
                    )
                    return 0
                logger.info("Удаляем существующий демо-акт (act_id=%d)...", existing_id)
                await _delete_demo_act(conn, crud_repo, existing_id)

            act_id = await _create_act(conn, settings, username)
            await _fill_content(conn, act_id, username)
            logger.info("Демо-акт создан: act_id=%d, KM=%s", act_id, DEMO_KM)
            return 0
    except Exception:
        logger.exception("Ошибка при создании демо-акта")
        return 1
    finally:
        await close_db()


async def _find_demo_act(conn, crud_repo: ActCrudRepository) -> int | None:
    """Ищет существующий акт КМ-99-99999, часть 1. Возвращает id или None."""
    from app.domains.acts.utils import KMUtils
    km_digit = KMUtils.extract_km_digits(DEMO_KM)
    row = await conn.fetchrow(
        f"SELECT id FROM {crud_repo.acts} WHERE km_number_digit = $1 AND part_number = 1",
        km_digit,
    )
    return row["id"] if row else None


async def _delete_demo_act(conn, crud_repo: ActCrudRepository, act_id: int) -> None:
    """Удаляет демо-акт и все связанные данные напрямую через репозиторий."""
    from app.domains.acts.utils import KMUtils
    km_digit = KMUtils.extract_km_digits(DEMO_KM)
    async with conn.transaction():
        await conn.execute(
            f"DELETE FROM {crud_repo.acts} WHERE id = $1",
            act_id,
        )
        await crud_repo.update_total_parts_for_km(km_digit)
    logger.info("Демо-акт act_id=%d удалён.", act_id)


async def _create_act(conn, settings, username: str) -> int:
    """Создаёт акт через ActCrudService и возвращает его id."""
    crud = ActCrudService(conn, settings)

    payload = ActCreate(
        km_number=DEMO_KM,
        inspection_name=(
            "Проверка регулярности исполнения овернайт-выписок по "
            "расчётным счетам корпоративных клиентов"
        ),
        city="Москва",
        order_number="Text/2026/15-Б",
        order_date=date(2026, 2, 20),
        audit_team=[
            AuditTeamMember(
                role="Куратор",
                full_name="Иванов Иван Иванович",
                position="Старший аудитор",
                username=username,
            ),
            AuditTeamMember(
                role="Руководитель",
                full_name="Петров Пётр Петрович",
                position="Ведущий аудитор",
                username="99888888",
            ),
            AuditTeamMember(
                role="Участник",
                full_name="Сидорова Светлана Сергеевна",
                position="Аудитор",
                username="99777777",
            ),
        ],
        inspection_start_date=date(2026, 3, 1),
        inspection_end_date=date(2026, 4, 30),
        is_process_based=False,
        service_note=None,
        service_note_date=None,
    )

    act = await crud.create_act(payload, username)
    return act.id


async def _fill_content(conn, act_id: int, username: str) -> None:
    """Заполняет содержимое акта напрямую через ActContentRepository.

    Используем репозиторий напрямую, чтобы обойти проверку блокировки —
    seed-скрипт является привилегированной операцией.
    """
    tree = _build_tree()
    tables = _build_tables()
    text_blocks = _build_text_blocks()
    violations = _build_violations()

    data = ActDataSchema(
        tree=tree,
        tables=tables,
        textBlocks=text_blocks,
        violations=violations,
        saveType="manual",
    )

    content_repo = ActContentRepository(conn)
    await content_repo.save_content(act_id, data, username)


# ---------------------------------------------------------------------------
# Публичные фабричные функции — импортируются в test_e2e_demo.py (Task 13)
# ---------------------------------------------------------------------------

def _build_tree() -> dict:
    """Строит дерево структуры демо-акта (6 разделов, непроцессная проверка)."""
    return {
        "id": "root",
        "label": "Акт",
        "children": [
            {
                "id": "1",
                "label": "Характеристика проверяемого направления",
                "protected": True,
                "deletable": False,
                "children": [
                    {
                        "id": "1_textblock_1",
                        "label": "Описание объекта проверки",
                        "customLabel": "Описание объекта проверки",
                        "type": "textblock",
                        "textBlockId": "tb-1-1",
                        "parentId": "1",
                    },
                    {
                        "id": "1_table_1",
                        "label": "Источники данных",
                        "customLabel": "Источники данных",
                        "type": "table",
                        "tableId": "tbl-1-2",
                        "parentId": "1",
                    },
                ],
            },
            {
                "id": "2",
                "label": "Оценка качества проверенного направления",
                "protected": True,
                "deletable": False,
                "children": [
                    {
                        "id": "2_textblock_1",
                        "label": "Подход к проверке",
                        "customLabel": "Подход к проверке",
                        "type": "textblock",
                        "textBlockId": "tb-2-1",
                        "parentId": "2",
                    },
                    {
                        "id": "2_table_main_metrics",
                        "label": "Главная таблица метрик",
                        "customLabel": "Главная таблица метрик",
                        "type": "table",
                        "tableId": "tbl-2-2",
                        "isMainMetricsTable": True,
                        "parentId": "2",
                    },
                ],
            },
            {
                "id": "3",
                "label": "Применённые технологии",
                "protected": True,
                "deletable": False,
                "children": [
                    {
                        "id": "3_table_1",
                        "label": "Репозитории",
                        "customLabel": "Репозитории",
                        "type": "table",
                        "tableId": "tbl-3-1",
                        "parentId": "3",
                    },
                    {
                        "id": "3_table_2",
                        "label": "Технологии",
                        "customLabel": "Технологии",
                        "type": "table",
                        "tableId": "tbl-3-2",
                        "parentId": "3",
                    },
                    {
                        "id": "3_table_3",
                        "label": "Инструменты",
                        "customLabel": "Инструменты",
                        "type": "table",
                        "tableId": "tbl-3-3",
                        "parentId": "3",
                    },
                ],
            },
            {
                "id": "4",
                "label": "Основные выводы",
                "protected": True,
                "deletable": False,
                "children": [
                    {
                        "id": "4_textblock_1",
                        "label": "Выводы",
                        "customLabel": "Выводы",
                        "type": "textblock",
                        "textBlockId": "tb-4-1",
                        "parentId": "4",
                    },
                ],
            },
            {
                "id": "5",
                "label": "Результаты проверки",
                "protected": True,
                "deletable": False,
                "children": [
                    {
                        "id": "5_table_op_risk",
                        "label": "Операционные риски",
                        "customLabel": "Операционные риски",
                        "type": "table",
                        "tableId": "tbl-5-3",
                        "isOperationalRiskTable": True,
                        "parentId": "5",
                    },
                    {
                        "id": "5_item_v1",
                        "label": "Несвоевременное формирование выписок",
                        "customLabel": "Несвоевременное формирование выписок",
                        "parentId": "5",
                        "children": [
                            {
                                "id": "5_item_v1_violation",
                                "label": "Нарушение",
                                "type": "violation",
                                "violationId": "v-5-1",
                                "parentId": "5_item_v1",
                            },
                        ],
                    },
                    {
                        "id": "5_item_v2",
                        "label": "Расхождение остатков",
                        "customLabel": "Расхождение остатков",
                        "parentId": "5",
                        "children": [
                            {
                                "id": "5_item_v2_violation",
                                "label": "Нарушение",
                                "type": "violation",
                                "violationId": "v-5-2",
                                "parentId": "5_item_v2",
                            },
                        ],
                    },
                ],
            },
            {
                "id": "6",
                "label": (
                    "Оценка процесса по результатам исследования "
                    "методом Process Mining"
                ),
                "protected": False,
                "deletable": True,
                "children": [],
            },
        ],
    }


def _build_tables() -> dict[str, TableSchema]:
    """Строит все таблицы демо-акта."""
    return {
        "tbl-1-2": _table(
            "tbl-1-2",
            "1_table_1",
            rows=[
                ["Система", "БД", "Кол-во записей"],
                ["АБС «Гранат»", "Greenplum core_abs", "12 480 217"],
                ["Шина транзакций", "Hive logs_abs", "48 920 113"],
                ["DWH", "Greenplum dwh", "3 281 044"],
            ],
        ),
        "tbl-2-2": _table(
            "tbl-2-2",
            "2_table_main_metrics",
            rows=[
                ["№", "Метрика", "План", "Факт", "Отклонение", "Норма", "Статус"],
                ["1", "Доля сформированных выписок в срок", "100%", "97.8%", "-2.2%", "≥99%", "Несоотв."],
                ["2", "Среднее время формирования, мин", "10", "8.4", "-16%", "≤15", "Соотв."],
                ["3", "Кол-во расхождений остатков", "0", "37", "+37", "0", "Несоотв."],
                ["4", "Своевременность доставки в ЛК", "100%", "99.6%", "-0.4%", "≥99%", "Соотв."],
            ],
            main=True,
        ),
        "tbl-3-1": _table(
            "tbl-3-1",
            "3_table_1",
            rows=[
                ["Репозиторий", "Назначение", "URL"],
                ["audit-workstation", "Конструктор актов", "git.bank/audit-ws"],
                ["dwh-overnight", "DWH-витрина", "git.bank/dwh-overnight"],
                ["data-quality", "Контроли качества данных", "git.bank/dq"],
            ],
        ),
        "tbl-3-2": _table(
            "tbl-3-2",
            "3_table_2",
            rows=[
                ["Технология", "Версия", "Использование"],
                ["Greenplum", "6.25", "Хранение и витрины"],
                ["Apache Hive", "3.1", "Логи транзакций"],
                ["Apache Airflow", "2.9", "Оркестрация ETL"],
            ],
        ),
        "tbl-3-3": _table(
            "tbl-3-3",
            "3_table_3",
            rows=[
                ["Инструмент", "Назначение"],
                ["Tableau", "Дашборды и сверка показателей"],
                ["Jupyter Notebook", "Ad-hoc-исследование данных"],
                ["dbt", "Тестирование моделей DWH"],
            ],
        ),
        "tbl-5-3": _table(
            "tbl-5-3",
            "5_table_op_risk",
            rows=[
                ["Риск", "Вероятность", "Влияние", "Уровень"],
                ["Несоответствие требованиям ЦБ 716-П", "Средняя", "Высокое", "Высокий"],
                ["Финансовые потери клиентов", "Низкая", "Высокое", "Средний"],
            ],
            operational_risk=True,
        ),
    }


def _table(
    tid: str,
    node_id: str,
    *,
    rows: list[list[str]],
    main: bool = False,
    operational_risk: bool = False,
) -> TableSchema:
    """Вспомогательная функция: строит TableSchema из списка строк."""
    grid = [
        [
            TableCellSchema(content=cell, isHeader=(row_idx == 0))
            for cell in row
        ]
        for row_idx, row in enumerate(rows)
    ]
    return TableSchema(
        id=tid,
        nodeId=node_id,
        grid=grid,
        colWidths=[150] * len(rows[0]),
        isMainMetricsTable=main,
        isOperationalRiskTable=operational_risk,
    )


def _build_text_blocks() -> dict[str, TextBlockSchema]:
    """Строит текстовые блоки демо-акта."""
    return {
        "tb-1-1": TextBlockSchema(
            id="tb-1-1",
            nodeId="1_textblock_1",
            content=(
                "Объект проверки — процесс ежедневного формирования и доставки "
                "<b>овернайт-выписок</b> по расчётным счетам корпоративных "
                "клиентов в период с 01.03.2026 по 30.04.2026. "
                "Проверка охватывает операционную цепочку: "
                "закрытие опердня в АБС «Гранат» → формирование выписки "
                "в модуле overnight_summary → доставка клиенту через "
                "личный кабинет. "
                "Объём генеральной совокупности — 123 расчётных счёта "
                "корпоративных клиентов сегмента крупнейшего бизнеса "
                "(остаток ≥ 1 млрд руб. на начало периода). "
                "Нормативная база: Регламент РК-1247 «Порядок формирования "
                "и доставки овернайт-выписок», SLA с подразделением "
                "«Корпоративный бизнес» от 15.01.2025."
            ),
            formatting=TextBlockFormattingSchema(fontSize=16),
        ),
        "tb-2-1": TextBlockSchema(
            id="tb-2-1",
            nodeId="2_textblock_1",
            content=(
                "Проверка проведена методом <b>выборочного контроля</b> по "
                "<i>123 расчётным счетам</i> крупнейших клиентов сегмента "
                "<u>«Корпоративный бизнес»</u>. "
                "Использованы данные из трёх источников: "
                "АБС «Гранат» (Greenplum core_abs), "
                "шина транзакций (Hive logs_abs) и DWH. "
                "Сверка проводилась автоматически средствами Airflow DAG "
                "audit_overnight_reconcile за каждый рабочий день периода "
                "01.03.2026–30.04.2026 (43 рабочих дня). "
                "Критерии соответствия: факт ≥ норма для каждой метрики "
                "согласно таблице раздела 2.2."
            ),
            formatting=TextBlockFormattingSchema(fontSize=16),
        ),
        "tb-4-1": TextBlockSchema(
            id="tb-4-1",
            nodeId="4_textblock_1",
            content=(
                "По результатам проверки выявлено два систематических нарушения "
                "регламента РК-1247. "
                "Первое — несвоевременное формирование выписок (п. 4.2): "
                "в 17 из 123 случаев (13.8%) время формирования превысило 08:00 МСК. "
                "Второе — расхождение остатков (п. 5.3): "
                "зафиксировано 37 случаев расхождения между АБС и выпиской, "
                "среднее отклонение составило 0.04% от остатка. "
                "Оба нарушения связаны с гонкой условий в ETL-процессе overnight_summary "
                "при пиковых объёмах транзакций в конце месяца. "
                "Требуется доработка расписания ETL и пересмотр SLA с владельцем процесса."
            ),
            formatting=TextBlockFormattingSchema(fontSize=16),
        ),
    }


def _build_violations() -> dict[str, ViolationSchema]:
    """Строит нарушения демо-акта (2 нарушения с заполненными опциональными полями)."""
    return {
        "v-5-1": ViolationSchema(
            id="v-5-1",
            nodeId="5_item_v1_violation",
            violated="Регламент формирования выписок (п. 4.2 РК-1247)",
            established=(
                "В период проверки в 17 случаях из 123 (13.8%) выписки "
                "сформированы позже 08:00 МСК. "
                "Максимальная задержка составила 47 минут (счёт № *** 4471 "
                "на дату 31.03.2026)."
            ),
            reasons=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Перегрузка ETL-задачи overnight_summary при пиковых "
                    "объёмах транзакций в конце месяца. "
                    "Задача запускается без приоритизации наравне с другими "
                    "ETL-процессами пула Airflow."
                ),
            ),
            consequences=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Клиенты не имеют возможности использовать выписки "
                    "для отчётности до 09:00 МСК, что нарушает п. 3.1 SLA. "
                    "Потенциальный ущерб репутации — риск перевода счетов "
                    "в другой банк (3 из 17 клиентов направили претензии)."
                ),
            ),
            responsible=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Куратор процесса overnight_summary: "
                    "Кузнецов А.В., начальник Управления операционных систем."
                ),
            ),
            recommendations=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Пересмотреть расписание ETL overnight_summary: "
                    "выделить отдельный пул Airflow workers с приоритетом HIGH, "
                    "ввести предварительный прогрев данных в 07:00 МСК. "
                    "Согласовать с владельцем DWH увеличение ресурсов пула "
                    "до 16 vCPU / 64 GiB RAM в ночное окно конца месяца. "
                    "Срок: до 01.07.2026."
                ),
            ),
        ),
        "v-5-2": ViolationSchema(
            id="v-5-2",
            nodeId="5_item_v2_violation",
            violated="Контроль соответствия остатков (п. 5.3 РК-1247)",
            established=(
                "Зафиксировано 37 случаев расхождения остатков в выписке "
                "и АБС за период проверки. "
                "Среднее расхождение составило 0.04% от остатка, "
                "максимальное — 0.12% (счёт № *** 8813, дата 28.04.2026)."
            ),
            reasons=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Гонка условий (race condition) между фиксацией "
                    "overnight-сверки в АБС и закрытием опердня: "
                    "выписка публикуется до завершения транзакции сверки, "
                    "что приводит к использованию промежуточного состояния остатка."
                ),
            ),
            consequences=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Риск выставления некорректной отчётности контрагентам. "
                    "В 3 случаях клиенты уже использовали выписку с ошибочным остатком "
                    "в качестве обеспечения для получения краткосрочного кредита."
                ),
            ),
            responsible=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Главный архитектор АБС: Морозова Е.А., "
                    "Центр технологий расчётного бизнеса."
                ),
            ),
            recommendations=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Добавить блокировку публикации выписки до завершения "
                    "overnight-сверки (distributed lock на уровне Greenplum). "
                    "Настроить мониторинг расхождений > 0.01% с алертом "
                    "в Telegram-канал команды операций. "
                    "Провести ретроспективный анализ за 2025 год "
                    "и передать в СБ при расхождениях > 0.1%. "
                    "Срок: до 15.06.2026."
                ),
            ),
        ),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Seed демо-акта «Овернайт-выписки корпклиентов» в БД."
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Удалить существующий демо-акт перед созданием нового",
    )
    parser.add_argument(
        "--username",
        default=DEMO_USERNAME,
        help="Username создателя акта (по умолчанию: 99999999)",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.replace, args.username)))
