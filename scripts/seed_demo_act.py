"""Seed демо-акта КМ-99-99999 «Овернайт-выписки корпклиентов».

Используется двумя способами:
* CLI: `python -m scripts.seed_demo_act [--replace]` — для ручного re-seed.
* Lifespan-хук: `ensure_demo_act()` вызывается из app/domains/acts/_lifecycle.py
  при старте сервера. Idempotent: жёсткий skip если КМ-99-99999 уже есть.

Структура определена спекой docs/superpowers/specs/2026-05-28-demo-act-v2-and-docx-fixes.md §3.
"""
import argparse
import asyncio
import logging
import sys
from datetime import date

from app.core.config import get_settings
from app.db.connection import close_db, get_pool, init_db
from app.domains.acts.repositories.act_content import ActContentRepository
from app.domains.acts.repositories.act_crud import ActCrudRepository
from app.domains.acts.schemas.act_content import (
    ActDataSchema,
    TableCellSchema,
    TableSchema,
    TextBlockFormattingSchema,
    TextBlockSchema,
    ViolationAdditionalContentSchema,
    ViolationContentItemSchema,
    ViolationDescriptionListSchema,
    ViolationOptionalFieldSchema,
    ViolationSchema,
)
from app.domains.acts.schemas.act_metadata import ActCreate, AuditTeamMember
from app.domains.acts.services.act_crud_service import ActCrudService

logger = logging.getLogger("seed_demo_act")

DEMO_KM = "КМ-99-99999"
_DEMO_KM_DIGIT = 9999999
_MY_USERNAME = "22494524"


async def main(replace: bool) -> int:
    settings = get_settings()
    await init_db(settings)
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            existing_id = await _find_demo_act_by_digit(conn)
            if existing_id is not None:
                if not replace:
                    logger.info(
                        "Демо-акт уже существует (act_id=%d). "
                        "Используйте --replace для пересоздания.",
                        existing_id,
                    )
                    return 0
                logger.info("Удаляем существующий демо-акт (act_id=%d)...", existing_id)
                await _delete_demo_act(conn, existing_id)

            act_id = await _create_act(conn, settings, _MY_USERNAME)
            await _fill_content(conn, act_id, _MY_USERNAME)
            logger.info("Демо-акт создан: act_id=%d, KM=%s", act_id, DEMO_KM)
            return 0
    except Exception:
        logger.exception("Ошибка при создании демо-акта")
        return 1
    finally:
        await close_db()


async def ensure_demo_act() -> None:
    """Idempotent seed для lifespan-хука.

    Жёсткий skip: если КМ-99-99999 уже есть — выходим тихо.
    Ошибки логируем но НЕ пробрасываем (стартап не должен валиться).
    """
    settings = get_settings()
    try:
        pool = get_pool()
    except RuntimeError:
        logger.warning("ensure_demo_act: пул БД не инициализирован, пропускаем")
        return
    try:
        async with pool.acquire() as conn:
            existing_id = await _find_demo_act_by_digit(conn)
            if existing_id is not None:
                logger.info(
                    "Демо-акт %s уже существует (id=%d), skip", DEMO_KM, existing_id
                )
                return
            act_id = await _create_act(conn, settings, _MY_USERNAME)
            await _fill_content(conn, act_id, _MY_USERNAME)
            logger.info("Демо-акт %s создан: id=%d", DEMO_KM, act_id)
    except Exception:
        logger.exception("ensure_demo_act: ошибка создания (глотаем)")


async def _find_demo_act_by_digit(conn) -> int | None:
    settings = get_settings()
    prefix = settings.database.table_prefix
    row = await conn.fetchrow(
        f"SELECT id FROM {prefix}acts WHERE km_number_digit = $1 AND part_number = 1",
        _DEMO_KM_DIGIT,
    )
    return row["id"] if row else None


async def _delete_demo_act(conn, act_id: int) -> None:
    crud_repo = ActCrudRepository(conn)
    async with conn.transaction():
        await conn.execute(
            f"DELETE FROM {crud_repo.acts} WHERE id = $1",
            act_id,
        )
        await crud_repo.update_total_parts_for_km(_DEMO_KM_DIGIT)
    logger.info("Демо-акт act_id=%d удалён", act_id)


async def _create_act(conn, settings, username: str) -> int:
    crud = ActCrudService(conn, settings)
    payload = ActCreate(
        km_number=DEMO_KM,
        inspection_name="Овернайт-выписки корпоративных клиентов",
        city="Москва",
        order_number="АА-99/999-АА",
        order_date=date(2026, 4, 10),
        audit_team=[
            AuditTeamMember(role="Куратор", full_name="А.А. Куратова",
                            position="Начальник УВА", username="99000001"),
            AuditTeamMember(role="Руководитель", full_name="Б.Б. Иванов",
                            position="Главный аудитор УВА", username="99000002"),
            AuditTeamMember(role="Участник", full_name="В.В. Петров",
                            position="Аудитор УВА", username="99000003"),
            AuditTeamMember(role="Редактор", full_name="Д.Д. Сидоров",
                            position="Аудитор УВА", username=_MY_USERNAME),
        ],
        inspection_start_date=date(2026, 4, 10),
        inspection_end_date=date(2026, 5, 15),
        is_process_based=False,
    )
    act = await crud.create_act(payload, username)
    return act.id


async def _fill_content(conn, act_id: int, username: str) -> None:
    data = ActDataSchema(
        tree=_build_tree(),
        tables=_build_tables(),
        textBlocks=_build_text_blocks(),
        violations=_build_violations(),
        saveType="manual",
    )
    content_repo = ActContentRepository(conn)
    await content_repo.save_content(act_id, data, username)


# ---------------------------------------------------------------------------
# Структура демо-акта (pure-функции)
# ---------------------------------------------------------------------------


def _build_tree() -> dict:
    return {
        "id": "root",
        "label": "Акт",
        "children": [
            _section_1(),
            _section_2(),
            _section_3(),
            _section_4(),
            _section_5(),
            _section_6(),
        ],
    }


def _section_1() -> dict:
    return {
        "id": "1",
        "label": "Краткое описание объекта проверки",
        "protected": True, "deletable": False, "type": "item",
        "children": [
            {"id": "1.1", "label": "Перечень проверяемых процессов",
             "customLabel": "Перечень проверяемых процессов",
             "type": "textblock", "textBlockId": "tb-1-1",
             "parentId": "1", "protected": True, "deletable": False},
            {"id": "1.2", "label": "Период исследования и источники данных",
             "customLabel": "Период исследования и источники данных",
             "type": "textblock", "textBlockId": "tb-1-2",
             "parentId": "1", "protected": True, "deletable": False},
        ],
    }


def _section_2() -> dict:
    return {
        "id": "2",
        "label": "Методология проведения проверки",
        "protected": True, "deletable": False, "type": "item",
        "children": [
            {"id": "2_text", "label": "Методология",
             "customLabel": "Методология",
             "type": "textblock", "textBlockId": "tb-2-1",
             "parentId": "2", "protected": True, "deletable": False},
        ],
    }


def _section_3() -> dict:
    return {
        "id": "3",
        "label": "Основные количественные показатели",
        "protected": True, "deletable": False, "type": "item",
        "children": [
            {"id": "3_main_metrics", "label": "Главная таблица метрик",
             "customLabel": "Главная таблица метрик",
             "type": "table", "tableId": "tbl-3-main",
             "isMetricsTable": True, "isMainMetricsTable": True,
             "parentId": "3", "protected": True, "deletable": False},
            {"id": "3_text", "label": "Комментарий к показателям",
             "customLabel": "Комментарий к показателям",
             "type": "textblock", "textBlockId": "tb-3-1",
             "parentId": "3", "protected": True, "deletable": False},
        ],
    }


def _section_4() -> dict:
    return {
        "id": "4",
        "label": "Выводы по результатам исследования",
        "protected": True, "deletable": False, "type": "item",
        "children": [
            {"id": "4_text_intro", "label": "Введение",
             "customLabel": "Введение",
             "type": "textblock", "textBlockId": "tb-4-1",
             "parentId": "4", "protected": True, "deletable": False},
            {"id": "4_table", "label": "Сводка по статусам",
             "customLabel": "Сводка по статусам",
             "type": "table", "tableId": "tbl-4-1",
             "parentId": "4", "protected": True, "deletable": False},
            {"id": "4_text_after", "label": "Комментарий",
             "customLabel": "Комментарий",
             "type": "textblock", "textBlockId": "tb-4-2",
             "parentId": "4", "protected": True, "deletable": False},
        ],
    }


def _section_5() -> dict:
    return {
        "id": "5",
        "label": "Результаты проверки",
        "protected": True, "deletable": False, "type": "item",
        "children": [
            _risk_node("5_risk_reg", "Регуляторный риск (свод по §5)",
                       "tbl-5-risk-reg", "isRegularRiskTable", parent="5"),
            _risk_node("5_risk_op", "Операционный риск (свод по §5)",
                       "tbl-5-risk-op", "isOperationalRiskTable", parent="5"),
            _risk_node("5_risk_tax", "Налоговый риск (свод по §5)",
                       "tbl-5-risk-tax", "isTaxRiskTable", parent="5"),
            _risk_node("5_risk_other", "Прочий риск (свод по §5)",
                       "tbl-5-risk-other", "isOtherRiskTable", parent="5"),
            _node_5_1(),
            _node_5_2(),
        ],
    }


def _node_5_1() -> dict:
    return {
        "id": "5.1",
        "label": "Управление лимитами овернайт",
        "customLabel": "Управление лимитами овернайт",
        "type": "item", "parentId": "5",
        "children": [
            _risk_node("5.1_risk_reg", "Регуляторный риск (свод по §5.1)",
                       "tbl-5-1-risk-reg", "isRegularRiskTable", parent="5.1"),
            _risk_node("5.1_risk_op", "Операционный риск (свод по §5.1)",
                       "tbl-5-1-risk-op", "isOperationalRiskTable", parent="5.1"),
            _node_5_1_1(),
            _node_5_1_2(),
        ],
    }


def _node_5_1_1() -> dict:
    return {
        "id": "5.1.1",
        "label": "Превышения лимитов овернайт в Сибирском ТБ",
        "customLabel": "Превышения лимитов овернайт в Сибирском ТБ",
        "type": "item", "tb": ["СибБ"], "parentId": "5.1",
        "children": [
            _risk_node("5.1.1_risk_reg", "Регуляторный риск",
                       "tbl-5-1-1-reg", "isRegularRiskTable", parent="5.1.1"),
            _risk_node("5.1.1_risk_tax", "Налоговый риск",
                       "tbl-5-1-1-tax", "isTaxRiskTable", parent="5.1.1"),
            _risk_node("5.1.1_risk_other", "Прочий риск",
                       "tbl-5-1-1-other", "isOtherRiskTable", parent="5.1.1"),
            {"id": "5.1.1_violation", "label": "Нарушение",
             "type": "violation", "violationId": "v-5-1-1", "parentId": "5.1.1"},
        ],
    }


def _node_5_1_2() -> dict:
    return {
        "id": "5.1.2",
        "label": "Несвоевременная пролонгация в Московском Б",
        "customLabel": "Несвоевременная пролонгация в Московском Б",
        "type": "item", "tb": ["МБ"], "parentId": "5.1",
        "children": [
            _risk_node("5.1.2_risk_op", "Операционный риск",
                       "tbl-5-1-2-op", "isOperationalRiskTable", parent="5.1.2"),
            _risk_node("5.1.2_risk_reg", "Регуляторный риск",
                       "tbl-5-1-2-reg", "isRegularRiskTable", parent="5.1.2"),
            {"id": "5.1.2_violation", "label": "Нарушение",
             "type": "violation", "violationId": "v-5-1-2", "parentId": "5.1.2"},
        ],
    }


def _node_5_2() -> dict:
    return {
        "id": "5.2",
        "label": "Расчётные операции по овернайту",
        "customLabel": "Расчётные операции по овернайту",
        "type": "item", "parentId": "5",
        "children": [
            _risk_node("5.2_risk_tax", "Налоговый риск (свод по §5.2)",
                       "tbl-5-2-risk-tax", "isTaxRiskTable", parent="5.2"),
            _node_5_2_1(),
        ],
    }


def _node_5_2_1() -> dict:
    return {
        "id": "5.2.1",
        "label": "Налоговые расхождения в Среднерусском ТБ",
        "customLabel": "Налоговые расхождения в Среднерусском ТБ",
        "type": "item", "tb": ["СРБ"], "parentId": "5.2",
        "children": [
            _risk_node("5.2.1_risk_tax", "Налоговый риск",
                       "tbl-5-2-1-tax", "isTaxRiskTable", parent="5.2.1"),
            {"id": "5.2.1_violation", "label": "Нарушение",
             "type": "violation", "violationId": "v-5-2-1", "parentId": "5.2.1"},
        ],
    }


def _section_6() -> dict:
    return {
        "id": "6",
        "label": "Оценка процесса по результатам исследования методом Process Mining",
        "protected": False, "deletable": True, "type": "item",
        "children": [
            {"id": "6_text_intro", "label": "Введение", "customLabel": "Введение",
             "type": "textblock", "textBlockId": "tb-6-1", "parentId": "6"},
            {"id": "6_table", "label": "Метрики процесса",
             "customLabel": "Метрики процесса",
             "type": "table", "tableId": "tbl-6-1", "parentId": "6"},
            {"id": "6_text_after", "label": "Комментарий",
             "customLabel": "Комментарий",
             "type": "textblock", "textBlockId": "tb-6-2", "parentId": "6"},
        ],
    }


def _risk_node(node_id: str, label: str, table_id: str, risk_flag: str, *, parent: str) -> dict:
    return {
        "id": node_id, "label": label, "customLabel": label,
        "type": "table", "tableId": table_id,
        risk_flag: True, "parentId": parent,
    }


def _build_tables() -> dict[str, TableSchema]:
    tables = {}

    tables["tbl-3-main"] = _table(
        "tbl-3-main", "3_main_metrics",
        rows=[
            ["№", "Метрика", "План", "Факт", "Отклонение", "Статус"],
            ["1", "Доля сформированных выписок в срок", "100%", "97.8%", "-2.2%", "Не соотв."],
            ["2", "Среднее время формирования, мин", "10", "8.4", "-16%", "Соотв."],
            ["3", "Кол-во расхождений остатков", "0", "37", "+37", "Не соотв."],
            ["4", "Своевременность доставки в ЛК", "100%", "99.6%", "-0.4%", "Соотв."],
        ],
        flags={"isMetricsTable": True, "isMainMetricsTable": True},
    )

    tables["tbl-4-1"] = _table(
        "tbl-4-1", "4_table",
        rows=[
            ["№", "Категория замечания", "Кол-во"],
            ["1", "Регуляторные нарушения", "2"],
            ["2", "Операционные риски", "1"],
            ["3", "Налоговые расхождения", "1"],
        ],
    )

    tables["tbl-6-1"] = _table(
        "tbl-6-1", "6_table",
        rows=[
            ["Метрика процесса", "Значение"],
            ["Среднее время цикла", "12.4 мин"],
            ["Кол-во ручных вмешательств", "18"],
            ["Доля автоматизации", "84.6%"],
        ],
    )

    _add_risk(tables, "tbl-5-risk-reg", "5_risk_reg", "isRegularRiskTable",
              [["Регуляторное требование", "Степень несоответствия"],
               ["ЦБ 716-П, п. 4.2", "Высокая"],
               ["ЦБ 590-П, п. 5.1", "Средняя"]])
    _add_risk(tables, "tbl-5-risk-op", "5_risk_op", "isOperationalRiskTable",
              [["Риск", "Уровень"],
               ["Финансовые потери клиентов", "Средний"],
               ["Сбои ETL в пиковые периоды", "Высокий"]])
    _add_risk(tables, "tbl-5-risk-tax", "5_risk_tax", "isTaxRiskTable",
              [["Источник", "Сумма расхождения, тыс. руб."],
               ["НК РФ, ст. 269", "1 240"]])
    _add_risk(tables, "tbl-5-risk-other", "5_risk_other", "isOtherRiskTable",
              [["Источник риска", "Описание"],
               ["Доступ к данным", "Расширенные права у 12 пользователей"]])

    _add_risk(tables, "tbl-5-1-risk-reg", "5.1_risk_reg", "isRegularRiskTable",
              [["Регуляторное требование", "Степень несоответствия"],
               ["ЦБ 716-П, п. 4.2", "Высокая"]])
    _add_risk(tables, "tbl-5-1-risk-op", "5.1_risk_op", "isOperationalRiskTable",
              [["Риск", "Уровень"],
               ["Сбои ETL", "Высокий"]])
    _add_risk(tables, "tbl-5-2-risk-tax", "5.2_risk_tax", "isTaxRiskTable",
              [["Источник", "Сумма расхождения, тыс. руб."],
               ["НК РФ, ст. 269", "1 240"]])

    _add_risk(tables, "tbl-5-1-1-reg", "5.1.1_risk_reg", "isRegularRiskTable",
              [["Требование", "Нарушение"],
               ["ВНД РК-1247, п. 5.2.3", "Превышение лимита"]])
    _add_risk(tables, "tbl-5-1-1-tax", "5.1.1_risk_tax", "isTaxRiskTable",
              [["Источник", "Доначисление, тыс. руб."],
               ["НК РФ, ст. 269", "320"]])
    _add_risk(tables, "tbl-5-1-1-other", "5.1.1_risk_other", "isOtherRiskTable",
              [["Описание", "Влияние"],
               ["Потеря лояльности клиента", "Среднее"]])
    _add_risk(tables, "tbl-5-1-2-op", "5.1.2_risk_op", "isOperationalRiskTable",
              [["Риск", "Уровень"],
               ["Просрочка пролонгации", "Высокий"]])
    _add_risk(tables, "tbl-5-1-2-reg", "5.1.2_risk_reg", "isRegularRiskTable",
              [["Требование", "Нарушение"],
               ["ВНД РК-1247, п. 6.1", "Несвоевременная пролонгация"]])
    _add_risk(tables, "tbl-5-2-1-tax", "5.2.1_risk_tax", "isTaxRiskTable",
              [["Источник", "Сумма, тыс. руб."],
               ["НК РФ, ст. 269 п. 1.1", "920"]])

    return tables


def _table(tid: str, node_id: str, *, rows: list[list[str]],
           flags: dict | None = None) -> TableSchema:
    grid = [
        [TableCellSchema(content=cell, isHeader=(r_idx == 0)) for cell in row]
        for r_idx, row in enumerate(rows)
    ]
    return TableSchema(
        id=tid, nodeId=node_id, grid=grid,
        colWidths=[150] * len(rows[0]),
        **(flags or {}),
    )


def _add_risk(tables: dict, tid: str, node_id: str,
              risk_flag: str, rows: list[list[str]]) -> None:
    tables[tid] = _table(tid, node_id, rows=rows, flags={risk_flag: True})


def _build_text_blocks() -> dict[str, TextBlockSchema]:
    return {
        "tb-1-1": TextBlockSchema(
            id="tb-1-1", nodeId="1.1",
            content=(
                "Объект проверки — процесс ежедневного формирования и доставки "
                "<b>овернайт-выписок</b> по расчётным счетам корпоративных клиентов. "
                "Нормативная база: "
                '<a href="https://confluence.sberbank.local/x/abc123">'
                "Регламент РК-1247</a> от 12.03.2024, "
                'SLA с подразделением <a href="https://confluence.sberbank.local/x/def456">'
                "«Корпоративный бизнес»</a> от 15.01.2025."
            ),
            formatting=TextBlockFormattingSchema(fontSize=16),
        ),
        "tb-1-2": TextBlockSchema(
            id="tb-1-2", nodeId="1.2",
            content=(
                "Период исследования: с 01.03.2026 по 30.04.2026 включительно. "
                "Источники данных: АБС «Гранат», шина транзакций (Hive logs_abs) и DWH "
                "(подробнее — "
                '<a href="https://confluence.sberbank.local/x/dwh001">'
                "карточка DWH</a>)."
            ),
            formatting=TextBlockFormattingSchema(fontSize=16),
        ),
        "tb-2-1": TextBlockSchema(
            id="tb-2-1", nodeId="2_text",
            content=(
                "Проверка проведена методом <b>выборочного контроля</b> по "
                "<i>123 расчётным счетам</i> крупнейших клиентов. "
                "Критерии соответствия установлены в "
                '<a href="https://confluence.sberbank.local/x/crit789">'
                "матрице контролей</a>. "
                "Использованы данные за 43 рабочих дня периода 01.03.2026–30.04.2026."
            ),
            formatting=TextBlockFormattingSchema(fontSize=16),
        ),
        "tb-3-1": TextBlockSchema(
            id="tb-3-1", nodeId="3_text",
            content=(
                "Доля сформированных в срок выписок составила <b>97.8%</b> при норме "
                "≥99%. Отклонение связано преимущественно с конце-месячными пиками. "
                "Зафиксировано 37 случаев расхождений остатков, что отражено в "
                '<a href="https://cbr.ru/finmarket/supervision/sv_lic/">'
                "регуляторных требованиях ЦБ РФ</a>."
            ),
            formatting=TextBlockFormattingSchema(fontSize=16),
        ),
        "tb-4-1": TextBlockSchema(
            id="tb-4-1", nodeId="4_text_intro",
            content=(
                "По результатам проверки выявлены систематические нарушения "
                "регламента РК-1247, требующие планового устранения в срок до 01.07.2026."
            ),
            formatting=TextBlockFormattingSchema(fontSize=16),
        ),
        "tb-4-2": TextBlockSchema(
            id="tb-4-2", nodeId="4_text_after",
            content=(
                "Все выявленные категории замечаний переданы владельцам процесса "
                "и зафиксированы в "
                '<a href="https://jira.sberbank.local/projects/AUDIT">'
                "Jira AUDIT</a>."
            ),
            formatting=TextBlockFormattingSchema(fontSize=16),
        ),
        "tb-6-1": TextBlockSchema(
            id="tb-6-1", nodeId="6_text_intro",
            content=(
                "Process Mining-анализ проведён на логах "
                '<a href="https://confluence.sberbank.local/x/pm001">'
                "процесса overnight_summary</a> "
                "за период 01.03.2026–30.04.2026."
            ),
            formatting=TextBlockFormattingSchema(fontSize=16),
        ),
        "tb-6-2": TextBlockSchema(
            id="tb-6-2", nodeId="6_text_after",
            content=(
                "Дашборд процесса доступен в "
                '<a href="https://tableau.sberbank.local/views/overnight">'
                "Tableau</a>. Рекомендуется ежемесячный обзор владельцем процесса."
            ),
            formatting=TextBlockFormattingSchema(fontSize=16),
        ),
    }


def _build_violations() -> dict[str, ViolationSchema]:
    return {
        "v-5-1-1": ViolationSchema(
            id="v-5-1-1", nodeId="5.1.1_violation",
            violated=(
                "<u>Требования ВНД:</u> Регламент управления лимитами овернайт "
                "№ВНД-1247 от 12.03.2024, п. 5.2.3 "
                '(<a href="https://confluence.sberbank.local/x/abc123">'
                "текст регламента</a>)."
            ),
            established=(
                "В период 01.03.2026–30.04.2026 в Сибирском ТБ зафиксировано "
                "8 случаев превышения лимита овернайт по корпоративным клиентам. "
                "Максимальное превышение — 12.4% от установленного лимита."
            ),
            descriptionList=ViolationDescriptionListSchema(
                enabled=True,
                items=[
                    "Превышение лимита по счёту № *** 4471 (15.03.2026)",
                    "Превышение лимита по счёту № *** 8813 (28.03.2026)",
                    "Аналогичные нарушения по 6 другим счетам",
                ],
            ),
            reasons=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Отсутствие предупредительной валидации лимитов на стороне "
                    "ETL-процесса overnight_summary; контроль выполняется "
                    "только post-factum при формировании выписки."
                ),
            ),
            consequences=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Потенциальные финансовые потери клиентов, "
                    "риск регуляторных санкций со стороны ЦБ РФ."
                ),
            ),
            responsible=ViolationOptionalFieldSchema(
                enabled=True,
                content="Кузнецов А.В., начальник УОС.",
            ),
            recommendations=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Внедрить предупредительную валидацию лимитов в ETL "
                    "overnight_summary до момента формирования выписки. "
                    "Срок: до 01.07.2026."
                ),
            ),
        ),
        "v-5-1-2": ViolationSchema(
            id="v-5-1-2", nodeId="5.1.2_violation",
            violated=(
                "<u>Требования ВНД:</u> Регламент управления лимитами овернайт "
                "№ВНД-1247 от 12.03.2024, п. 6.1 "
                '(<a href="https://confluence.sberbank.local/x/abc123">'
                "текст регламента</a>)."
            ),
            established=(
                "В Московском Б зафиксировано 4 случая несвоевременной пролонгации "
                "лимита овернайт. Средняя задержка — 2.3 рабочих дня."
            ),
            additionalContent=ViolationAdditionalContentSchema(
                enabled=True,
                items=[
                    ViolationContentItemSchema(
                        id="case-5-1-2-1", type="case",
                        content=(
                            "Счёт № *** 5512: лимит истёк 12.03.2026, "
                            "пролонгирован 17.03.2026 (задержка 3 рабочих дня)."
                        ),
                        order=0,
                    ),
                ],
            ),
            reasons=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Отсутствие автоматических уведомлений о приближающемся "
                    "истечении срока лимита; контроль ведётся вручную."
                ),
            ),
            consequences=ViolationOptionalFieldSchema(
                enabled=True,
                content="Простой расчётных операций клиентов, репутационный риск.",
            ),
            responsible=ViolationOptionalFieldSchema(
                enabled=True,
                content="Морозова Е.А., Центр технологий расчётного бизнеса.",
            ),
            recommendations=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Настроить автоматические уведомления за 5 рабочих дней "
                    "до истечения срока лимита. Срок: до 15.06.2026."
                ),
            ),
        ),
        "v-5-2-1": ViolationSchema(
            id="v-5-2-1", nodeId="5.2.1_violation",
            violated=(
                "<u>Требования законодательства:</u> Налоговый кодекс РФ, "
                "ст. 269 п. 1.1 "
                '(<a href="https://www.consultant.ru/document/cons_doc_LAW_28165/">'
                "КонсультантПлюс</a>)."
            ),
            established=(
                "В Среднерусском ТБ зафиксировано 5 случаев расхождения сумм "
                "налогообложения при расчётных операциях по овернайту. "
                "Общая сумма расхождений составила 920 тыс. руб."
            ),
            reasons=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Неверная классификация процентного дохода по овернайт-операциям "
                    "при формировании налоговой отчётности."
                ),
            ),
            consequences=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Риск налоговых доначислений и штрафов со стороны ФНС. "
                    "Потенциальный размер доначисления — до 1.2 млн руб."
                ),
            ),
            responsible=ViolationOptionalFieldSchema(
                enabled=True,
                content="Соколова Т.Н., Управление налогообложения.",
            ),
            recommendations=ViolationOptionalFieldSchema(
                enabled=True,
                content=(
                    "Уточнить классификатор процентного дохода для овернайт-операций "
                    "в соответствии со ст. 269 НК РФ. "
                    "Провести ретроспективный перерасчёт за 2025 год. "
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
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    sys.exit(asyncio.run(main(args.replace)))
