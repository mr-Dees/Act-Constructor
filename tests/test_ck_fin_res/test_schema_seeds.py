"""Тесты схемы и сидов ЦКФР: колонка tb_leader, multi-ТБ группы, guard с ТБ."""

import re
from pathlib import Path

SCHEMA = Path("app/domains/ck_fin_res/migrations/postgresql/schema.sql").read_text(encoding="utf-8")


def test_schema_has_tb_leader_column():
    assert re.search(r"tb_leader\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+''", SCHEMA), (
        "В CREATE TABLE t_db_oarb_ck_fr_validation нет колонки tb_leader"
    )


def test_seeds_contain_multi_tb_group():
    """Сиды: групп (км, пункт, метрика) с >= 2 ТБ — не меньше 3 (спека §4.3),
    из них хотя бы одна с >= 3 ТБ."""
    # Каждая строка сида несёт guard WHERE NOT EXISTS (... km_id ... act_item_number ... metric_code ... neg_finder_tb_id ...)
    guards = re.findall(
        r"WHERE km_id = '([^']+)' AND act_item_number = '([^']+)' "
        r"AND metric_code = '([^']+)' AND neg_finder_tb_id = '([^']+)'",
        SCHEMA,
    )
    assert guards, "Guard'ы сидов не содержат neg_finder_tb_id"
    by_group: dict[tuple, set] = {}
    for km, item, metric, tb in guards:
        by_group.setdefault((km, item, metric), set()).add(tb)
    multi = {k: v for k, v in by_group.items() if len(v) >= 2}
    assert len(multi) >= 3, f"Групп с >= 2 ТБ: {len(multi)} (нужно не меньше 3): {sorted(multi)}"
    assert any(len(v) >= 3 for v in multi.values()), "Нет ни одной группы (км, пункт, метрика) с >= 3 ТБ"


def test_all_seed_guards_include_tb():
    """Ни один guard не остался без neg_finder_tb_id (иначе вторая ТБ-строка не вставится)."""
    old_style = re.findall(
        r"AND metric_code = '[^']+'\);", SCHEMA,
    )
    assert not old_style, f"Guard'ы без neg_finder_tb_id: {len(old_style)} шт."


def test_seeds_backfill_tb_leader():
    assert "SET tb_leader" in SCHEMA, "Нет idempotent-бэкфилла tb_leader для сид-строк"


def test_seeds_contain_mpl_demo_group():
    assert SCHEMA.count("metric_code = '602'") >= 2 or SCHEMA.count("metric_code='602'") >= 2, (
        "Ожидается демо-группа метрики 602 минимум из 2 строк ТБ"
    )
    assert "mpl_amount_rubles" in SCHEMA


def test_ua_metric_dict_contains_602():
    path = Path("app/domains/ua_data/migrations/postgresql/schema.sql")
    sql = path.read_text(encoding="utf-8")
    assert "'602'" in sql, "В словаре метрик должна быть запись с кодом 602"
