"""
Репозиторий FR-валидации.

Операции с таблицей и представлением записей FR-валидации:
групповой поиск, дифференциальное групповое сохранение/удаление,
получение по ID.
"""

import logging
from datetime import date, datetime
from decimal import Decimal

import asyncpg

from app.core.settings_registry import get as get_domain_settings
from app.db.repositories.base import BaseRepository
from app.domains.ck_fin_res.exceptions import FRGroupConflictError
from app.domains.ck_fin_res.schemas.fr_validation import FRValidationView
from app.domains.ck_fin_res.schemas.requests import FilterSpec
from app.domains.ck_fin_res.settings import CkFinResSettings

logger = logging.getLogger("audit_workstation.domains.ck_fin_res.repository")

# Колонки представления v_db_oarb_ck_fr_validation, разрешённые для серверной
# фильтрации и сортировки (ORDER BY). Источник истины — поля схемы
# FRValidationView; whitelist защищает от инъекций в имена колонок/ORDER BY.
ALLOWED_COLUMNS: set[str] = set(FRValidationView.model_fields.keys())

# Разрешённые приведения типов для range-фильтра. Значение cast приходит от
# клиента, поэтому подставляется в SQL ТОЛЬКО через этот allowlist (никакой
# интерполяции сырого cast). PG 9.4 / GP 6.x понимают DATE/NUMERIC.
_CAST_SQL: dict[str, str] = {"date": "DATE", "numeric": "NUMERIC"}

# Поля для INSERT (без системных полей id, created_at, updated_at и т.д.)
_DATE_FIELDS = {"dt_sz"}
_TIMESTAMP_FIELDS = {"rev_start_dt", "rev_end_dt", "execution_deadline"}
_NULLABLE_FIELDS = (
    _DATE_FIELDS
    | _TIMESTAMP_FIELDS
    | {"act_sub_number_id", "reestr_metric_id", "assigment_id", "etl_loading_id"}
)
_NUMERIC_DEFAULTS = {
    "metric_element_counts": 0,
    "metric_amount_rubles": 0,
    "is_sent_to_top_brass": False,
    "real_loss": False,
    "applied_into_ua": False,
}


def _coerce(field: str, value):
    """Приводит значение к типу, ожидаемому asyncpg, с учётом NOT NULL DEFAULT."""
    if value is None:
        if field in _NULLABLE_FIELDS:
            return None
        if field in _NUMERIC_DEFAULTS:
            return _NUMERIC_DEFAULTS[field]
        return ""
    if field in _DATE_FIELDS and isinstance(value, str):
        return date.fromisoformat(value[:10])
    if field in _TIMESTAMP_FIELDS and isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


_INSERT_FIELDS = (
    "act_sub_number_id",
    "reestr_metric_id",
    "application_status",
    "neg_finder_tb_id",
    "metric_code",
    "metric_name",
    "metric_element_counts",
    "metric_amount_rubles",
    "is_sent_to_top_brass",
    "km_id",
    "num_sz",
    "dt_sz",
    "act_item_number",
    "process_number",
    "process_name",
    "deviation_description",
    "deviation_reason",
    "deviation_consequence",
    "real_loss",
    "ck_comment",
    "pocket",
    "risk",
    "rev_start_dt",
    "rev_end_dt",
    "block_owner",
    "department_owner",
    "sberdocs_ctrl_assgn_number",
    "assigment_id",
    "assigment_format",
    "inspection_name",
    "assigment_recommendation",
    "execution_deadline",
    "used_pm_lib",
    "tb_leader",
    "etl_loading_id",
    "row_hash",
    "applied_into_ua",
    "created_by",
)


# ------------------------------------------------------------------
# ГРУППИРОВКА ПО ТБ: одна логическая строка = (суб-акт, КМ, пункт, метрика)
# ------------------------------------------------------------------

GROUP_KEY_COLS = ("act_sub_number_id", "km_id", "act_item_number", "metric_code")

# NULL-нормализация ключа: NULL-значения участвуют в GROUP BY/IN одинаково
# в обеих фазах (row-value IN с NULL иначе не матчится).
_GROUP_KEY_EXPR = {
    "act_sub_number_id": "COALESCE(act_sub_number_id, -1)",
    "km_id": "COALESCE(km_id, '')",
    "act_item_number": "COALESCE(act_item_number, '')",
    "metric_code": "COALESCE(metric_code, '')",
}

# Per-ТБ поля (варьируются внутри группы) — их источник breakdown, не common.
PER_TB_FIELDS = ("neg_finder_tb_id", "metric_amount_rubles", "metric_element_counts")

# Групповые бизнес-поля: синхронизируются на все строки группы при сохранении,
# участвуют в детекте рассинхрона (divergent_fields).
GROUP_FIELDS = tuple(
    f for f in _INSERT_FIELDS
    if f not in PER_TB_FIELDS + (
        "application_status", "etl_loading_id", "row_hash", "applied_into_ua", "created_by",
    )
)

# Фильтры по суммам/количествам применяются к ИТОГУ группы (HAVING по SUM).
AGG_FILTER_EXPR = {
    "metric_amount_rubles": "SUM(metric_amount_rubles)",
    "total_amount": "SUM(metric_amount_rubles)",
    "metric_element_counts": "SUM(metric_element_counts)",
    "total_counts": "SUM(metric_element_counts)",
}

# Membership-фильтры: «группа попадает в выдачу, если содержит такую строку»
# (ключ — алиас с фронта, значение — реальная колонка). В отличие от
# row-фильтра, membership НЕ режет физические строки группы ДО GROUP BY —
# иначе SUM/COUNT итога считались бы по усечённому набору строк, искажая
# tb_count/total_amount. tb_breakdown — алиас с фронта (колонки с таким именем
# в VIEW нет, это computed-поле сборки группы), neg_finder_tb_id — прямой ключ.
MEMBERSHIP_FILTER_COLS = {"neg_finder_tb_id": "neg_finder_tb_id", "tb_breakdown": "neg_finder_tb_id"}

# Сортировка по виртуальным агрегатным колонкам.
AGG_SORT_EXPR = {
    "total_amount": "SUM(metric_amount_rubles)",
    "total_counts": "SUM(metric_element_counts)",
    "tb_count": "COUNT(*)",
    "updated_at": "MAX(updated_at)",
}


def _norm_key_value(col: str, value):
    """Значение ключа группы в НОРМАЛИЗОВАННОМ виде (зеркало _GROUP_KEY_EXPR)."""
    if col == "act_sub_number_id":
        return -1 if value is None else value
    return "" if value is None else value


def _norm_cmp(field: str, value):
    """Значение поля в каноничном виде для сравнения «изменилась ли строка»."""
    v = _coerce(field, value)
    if isinstance(v, Decimal):
        return v.quantize(Decimal("0.01"))
    if field == "metric_amount_rubles" and v is not None:
        return Decimal(str(v)).quantize(Decimal("0.01"))
    return v


class FRValidationRepository(BaseRepository):
    """Операции с записями FR-валидации в БД."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        s = get_domain_settings("ck_fin_res", CkFinResSettings)
        self.table = self.adapter.qualify_table_name(s.fr_validation_table, s.schema_name)
        self.view = self.adapter.qualify_table_name(s.fr_validation_view, s.schema_name)

    # ------------------------------------------------------------------
    # ПОИСК ПО КОЛОНОЧНЫМ ФИЛЬТРАМ (настраиваемая таблица)
    # ------------------------------------------------------------------

    def _build_filter_where(
        self, filters: dict[str, FilterSpec] | None,
    ) -> tuple[str, list, int]:
        """Собирает WHERE из типизированных колоночных фильтров (FilterSpec).

        Для каждой пары ``(колонка, spec)``:
        - колонка не из ALLOWED_COLUMNS — пропускается (защита от инъекции);
        - ``contains`` — ``CAST(col AS TEXT) ILIKE ${i}`` с param ``%value%``
          (пустой/``""`` value → пропуск);
        - ``eq`` — ``CAST(col AS TEXT) = ${i}`` с param value (пустой value →
          пропуск);
        - ``in`` — ``col IN (...)`` по сырым values; пустой список values →
          условие ``1=0`` («совпадений нет»);
        - ``range`` — ``CAST(col AS <T>) >= ${i}`` и/или ``<= ${j}``, где T —
          из cast-allowlist ({date→DATE, numeric→NUMERIC}); без корректного cast
          или без границ — пропуск.

        Все значения — bind-параметры (не конкатенируются в SQL). Каст в TEXT
        нужен, т.к. ILIKE/``=`` по тексту не определены для numeric/date/bool.
        Совместимо с PG 9.4 / GP 6.x. Возвращает (clause, params, next_idx).
        """
        conditions: list[str] = []
        params: list = []
        idx = 1
        for column, spec in (filters or {}).items():
            if column not in ALLOWED_COLUMNS:
                continue
            op = spec.op
            if op == "contains":
                value = spec.value
                if value is None or str(value).strip() == "":
                    continue
                conditions.append(f"CAST({column} AS TEXT) ILIKE ${idx}")
                params.append(f"%{value}%")
                idx += 1
            elif op == "eq":
                value = spec.value
                if value is None or str(value).strip() == "":
                    continue
                conditions.append(f"CAST({column} AS TEXT) = ${idx}")
                params.append(value)
                idx += 1
            elif op == "in":
                values = spec.values or []
                if not values:
                    conditions.append("1=0")
                    continue
                placeholders = ", ".join(
                    f"${idx + i}" for i in range(len(values))
                )
                conditions.append(f"{column} IN ({placeholders})")
                params.extend(values)
                idx += len(values)
            elif op == "range":
                cast_sql = _CAST_SQL.get(spec.cast or "")
                if cast_sql is None:
                    continue
                frm = spec.from_
                to = spec.to
                if frm is not None and str(frm).strip() != "":
                    conditions.append(f"CAST({column} AS {cast_sql}) >= ${idx}")
                    params.append(frm)
                    idx += 1
                if to is not None and str(to).strip() != "":
                    conditions.append(f"CAST({column} AS {cast_sql}) <= ${idx}")
                    params.append(to)
                    idx += 1
        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        return where, params, idx

    # ------------------------------------------------------------------
    # ГРУППОВОЙ ПОИСК (консолидация по ТБ)
    # ------------------------------------------------------------------

    @staticmethod
    def _split_filters(
        filters: dict[str, FilterSpec] | None,
    ) -> tuple[dict[str, FilterSpec], dict[str, FilterSpec], dict[str, FilterSpec]]:
        """Делит фильтры на строчные (WHERE), агрегатные (HAVING по SUM) и
        membership (HAVING «группа содержит значение»).

        Порядок проверки важен: membership — ДО row/agg. Иначе neg_finder_tb_id
        (и его алиас tb_breakdown с фронта) попал бы в row-WHERE и резал бы
        физические строки группы ДО GROUP BY — итоги группы (SUM/COUNT)
        считались бы по усечённому набору строк вместо всей группы.
        """
        row_filters: dict[str, FilterSpec] = {}
        agg_filters: dict[str, FilterSpec] = {}
        membership_filters: dict[str, FilterSpec] = {}
        for column, spec in (filters or {}).items():
            if column in MEMBERSHIP_FILTER_COLS:
                membership_filters[column] = spec
            elif column in AGG_FILTER_EXPR:
                agg_filters[column] = spec
            else:
                row_filters[column] = spec
        return row_filters, agg_filters, membership_filters

    @staticmethod
    def _build_membership_having(
        membership_filters: dict[str, FilterSpec], start_idx: int,
    ) -> tuple[list[str], list, int]:
        """Условия HAVING «группа содержит такой ТБ»: SUM(CASE WHEN ... THEN 1
        ELSE 0 END) > 0 — группа проходит, если ХОТЯ БЫ ОДНА её строка
        удовлетворяет условию; итоги группы при этом считаются по ВСЕМ
        строкам (в отличие от row-level WHERE, которое отфильтровало бы
        строки до GROUP BY и исказило SUM/COUNT)."""
        conditions: list[str] = []
        params: list = []
        idx = start_idx
        for column, spec in membership_filters.items():
            col = MEMBERSHIP_FILTER_COLS[column]
            op = spec.op
            if op == "in":
                values = spec.values or []
                if not values:
                    conditions.append("1=0")
                    continue
                placeholders = ", ".join(f"${idx + i}" for i in range(len(values)))
                conditions.append(f"SUM(CASE WHEN {col} IN ({placeholders}) THEN 1 ELSE 0 END) > 0")
                params.extend(values)
                idx += len(values)
            elif op == "eq":
                value = spec.value
                if value is None or str(value).strip() == "":
                    continue
                conditions.append(f"SUM(CASE WHEN CAST({col} AS TEXT) = ${idx} THEN 1 ELSE 0 END) > 0")
                params.append(value)
                idx += 1
            elif op == "contains":
                value = spec.value
                if value is None or str(value).strip() == "":
                    continue
                conditions.append(f"SUM(CASE WHEN CAST({col} AS TEXT) ILIKE ${idx} THEN 1 ELSE 0 END) > 0")
                params.append(f"%{value}%")
                idx += 1
        return conditions, params, idx

    @classmethod
    def _build_having(
        cls,
        agg_filters: dict[str, FilterSpec],
        membership_filters: dict[str, FilterSpec],
        start_idx: int,
    ) -> tuple[str, list, int]:
        """HAVING по агрегатам группы (SUM-фильтры) и по членству (группа
        содержит значение, например ТБ) — обе категории делят одну сквозную
        нумерацию параметров. Семантика op агрегатной части — как в
        _build_filter_where, но выражение — SUM(...) вместо колонки."""
        conditions: list[str] = []
        params: list = []
        idx = start_idx
        for column, spec in agg_filters.items():
            expr = AGG_FILTER_EXPR[column]
            op = spec.op
            if op == "contains":
                value = spec.value
                if value is None or str(value).strip() == "":
                    continue
                conditions.append(f"CAST({expr} AS TEXT) ILIKE ${idx}")
                params.append(f"%{value}%")
                idx += 1
            elif op == "eq":
                value = spec.value
                if value is None or str(value).strip() == "":
                    continue
                conditions.append(f"CAST({expr} AS TEXT) = ${idx}")
                params.append(value)
                idx += 1
            elif op == "range":
                frm, to = spec.from_, spec.to
                if frm is not None and str(frm).strip() != "":
                    conditions.append(f"{expr} >= CAST(${idx} AS NUMERIC)")
                    params.append(frm)
                    idx += 1
                if to is not None and str(to).strip() != "":
                    conditions.append(f"{expr} <= CAST(${idx} AS NUMERIC)")
                    params.append(to)
                    idx += 1
        member_conditions, member_params, idx = cls._build_membership_having(membership_filters, idx)
        conditions.extend(member_conditions)
        params.extend(member_params)
        having = f" HAVING {' AND '.join(conditions)}" if conditions else ""
        return having, params, idx

    async def search_groups(
        self,
        *,
        filters: dict[str, FilterSpec] | None = None,
        sort: list[tuple[str, str]] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Страница ЛОГИЧЕСКИХ строк: группы (суб-акт, КМ, пункт, метрика).

        Двухфазно (PG 9.4 / GP 6.x, без json_agg):
        A) страница групп: GROUP BY ключ + SUM/COUNT, HAVING для фильтров по
           итогам и по членству (например, «содержит такой ТБ» — не режет
           строки группы, см. _split_filters), ORDER BY по агрегатам/MIN(col);
           total — COUNT по подзапросу;
        B) добор физических строк групп страницы одним row-value IN; сборка
           групп в Python: common — из строки с max(updated_at, id),
           tb_breakdown — по возрастанию ТБ, divergent_fields — групповые поля,
           разъехавшиеся между строками (ETL-рассинхрон).
        """
        row_filters, agg_filters, membership_filters = self._split_filters(filters)
        where, params, idx = self._build_filter_where(row_filters)
        having, having_params, idx = self._build_having(agg_filters, membership_filters, idx)
        params = params + having_params

        key_select = ", ".join(
            f"{_GROUP_KEY_EXPR[c]} AS {c}" for c in GROUP_KEY_COLS
        )
        group_by = ", ".join(_GROUP_KEY_EXPR[c] for c in GROUP_KEY_COLS)

        order_parts: list[str] = []
        for column, direction in (sort or []):
            dir_sql = "DESC" if str(direction).lower() == "desc" else "ASC"
            if column in AGG_SORT_EXPR:
                order_parts.append(f"{AGG_SORT_EXPR[column]} {dir_sql}")
            elif column in _GROUP_KEY_EXPR:
                order_parts.append(f"{_GROUP_KEY_EXPR[column]} {dir_sql}")
            elif column in ALLOWED_COLUMNS:
                # Групповые поля равны внутри группы; MIN даёт детерминизм
                # и при ETL-рассинхроне.
                order_parts.append(f"MIN({column}) {dir_sql}")
            else:
                raise ValueError(f"Недопустимая колонка сортировки: {column}")
        # Стабильный хвост — ключ группировки (детерминированная пагинация).
        order_parts.extend(f"{_GROUP_KEY_EXPR[c]} ASC" for c in GROUP_KEY_COLS)
        order_by = "ORDER BY " + ", ".join(order_parts)

        total = await self.conn.fetchval(
            f"SELECT COUNT(*) FROM ("
            f"SELECT 1 FROM {self.view}{where} GROUP BY {group_by}{having}"
            f") AS grouped_total",
            *params,
        )

        page_rows = await self.conn.fetch(
            f"SELECT {key_select}, "
            f"SUM(metric_amount_rubles) AS total_amount, "
            f"SUM(metric_element_counts) AS total_counts, "
            f"COUNT(*) AS tb_count, MAX(updated_at) AS max_updated_at "
            f"FROM {self.view}{where} GROUP BY {group_by}{having} "
            f"{order_by} LIMIT ${idx} OFFSET ${idx + 1}",
            *params, limit, offset,
        )
        if not page_rows:
            return [], int(total or 0)

        # Фаза B: добор строк групп страницы (ключи уже нормализованы фазой A).
        key_tuple_sql = "(" + ", ".join(_GROUP_KEY_EXPR[c] for c in GROUP_KEY_COLS) + ")"
        in_params: list = []
        tuples_sql: list[str] = []
        p = 1
        for g in page_rows:
            tuples_sql.append(f"(${p}, ${p + 1}, ${p + 2}, ${p + 3})")
            in_params.extend(g[c] for c in GROUP_KEY_COLS)
            p += 4
        detail_rows = await self.conn.fetch(
            f"SELECT * FROM {self.view} "
            f"WHERE {key_tuple_sql} IN ({', '.join(tuples_sql)})",
            *in_params,
        )

        by_key: dict[tuple, list[dict]] = {}
        for r in detail_rows:
            row = dict(r)
            key = tuple(_norm_key_value(c, row.get(c)) for c in GROUP_KEY_COLS)
            by_key.setdefault(key, []).append(row)

        items: list[dict] = []
        for g in page_rows:
            key = tuple(g[c] for c in GROUP_KEY_COLS)
            rows = sorted(
                by_key.get(key, []),
                key=lambda r: str(r.get("neg_finder_tb_id") or ""),
            )
            if not rows:
                continue  # группа исчезла между фазами (гонка) — пропускаем
            src = max(
                rows,
                key=lambda r: (
                    r.get("updated_at") or r.get("created_at") or datetime.min,
                    r.get("id") or 0,
                ),
            )
            common = {k: v for k, v in src.items() if k not in PER_TB_FIELDS}
            divergent = [
                f for f in GROUP_FIELDS
                if len({str(r.get(f)) for r in rows}) > 1
            ]
            items.append({
                "group_key": {c: g[c] for c in GROUP_KEY_COLS},
                "row_ids": [r["id"] for r in rows],
                "common": common,
                "tb_breakdown": [
                    {
                        "row_id": r["id"],
                        "neg_finder_tb_id": r.get("neg_finder_tb_id"),
                        "metric_amount_rubles": r.get("metric_amount_rubles"),
                        "metric_element_counts": r.get("metric_element_counts"),
                    }
                    for r in rows
                ],
                "total_amount": g["total_amount"],
                "total_counts": g["total_counts"],
                "tb_count": g["tb_count"],
                "updated_at": g["max_updated_at"],
                "divergent_fields": divergent,
            })
        return items, int(total or 0)

    # ------------------------------------------------------------------
    # ГРУППОВОЕ СОХРАНЕНИЕ (дифференциальное) И УДАЛЕНИЕ
    # ------------------------------------------------------------------

    def _key_where(self, group_key: dict) -> tuple[str, list]:
        """WHERE по нормализованному ключу группы (bind-параметры)."""
        clauses = []
        params: list = []
        for i, col in enumerate(GROUP_KEY_COLS, start=1):
            clauses.append(f"{_GROUP_KEY_EXPR[col]} = ${i}")
            params.append(_norm_key_value(col, group_key.get(col)))
        return " AND ".join(clauses), params

    async def _load_group_rows(self, group_key: dict) -> list[dict]:
        where, params = self._key_where(group_key)
        rows = await self.conn.fetch(
            f"SELECT * FROM {self.table} WHERE {where} AND is_actual = true",
            *params,
        )
        return [dict(r) for r in rows]

    @staticmethod
    def _row_unchanged(row: dict, common: dict, want: dict) -> bool:
        """Строка не требует новой версии: групповые поля и per-ТБ значения совпали."""
        for f in GROUP_FIELDS:
            if _norm_cmp(f, row.get(f)) != _norm_cmp(f, common.get(f)):
                return False
        if _norm_cmp("metric_amount_rubles", row.get("metric_amount_rubles")) != \
                _norm_cmp("metric_amount_rubles", want.get("metric_amount_rubles")):
            return False
        if int(row.get("metric_element_counts") or 0) != int(want.get("metric_element_counts") or 0):
            return False
        return True

    def _build_version_values(
        self, common: dict, want: dict, username: str, old_row: dict | None,
    ) -> list:
        """Значения INSERT новой версии строки (порядок — _INSERT_FIELDS).

        Системные поля — «как прежний batch-update, но осознанно»:
        application_status/applied_into_ua копируются из прежней строки ТБ
        (для нового ТБ — из common / false); etl_loading_id → NULL и
        row_hash → '' — версия создана приложением, не ETL.
        """
        values: list = []
        for field in _INSERT_FIELDS:
            if field == "created_by":
                values.append(username)
            elif field in PER_TB_FIELDS:
                values.append(_coerce(field, want.get(field)))
            elif field == "application_status":
                if old_row is not None:
                    values.append(old_row.get("application_status") or "")
                else:
                    values.append(_coerce(field, common.get(field)))
            elif field == "applied_into_ua":
                values.append(bool(old_row["applied_into_ua"]) if old_row is not None else False)
            elif field == "etl_loading_id":
                values.append(None)
            elif field == "row_hash":
                values.append("")
            else:
                values.append(_coerce(field, common.get(field)))
        return values

    async def group_save(
        self,
        *,
        group_key: dict,
        expected_row_ids: list[int],
        common: dict,
        breakdown: list[dict],
        username: str,
    ) -> dict:
        """Дифференциальное сохранение группы: версионируются только изменённые
        строки; удалённые из развертки ТБ деактивируются; новые — вставляются.
        Несовпадение набора актуальных строк с ожидаемым — FRGroupConflictError
        (409): группу изменили параллельно, фронт должен перечитать данные.
        """
        async with self.conn.transaction():
            current_rows = await self._load_group_rows(group_key)
            current_ids = {r["id"] for r in current_rows}
            # Создание (expected_row_ids пуст), но группа с таким ключом уже
            # есть — это не гонка с параллельным изменением, а попытка
            # создать дубль пункта+метрики. Отдельное сообщение ДО общей
            # проверки набора id ниже (та — про "изменили параллельно").
            if not expected_row_ids and current_ids:
                raise FRGroupConflictError(
                    "Запись с таким пунктом и метрикой уже существует — откройте её для редактирования",
                )
            if current_ids != set(expected_row_ids):
                raise FRGroupConflictError(
                    "Запись изменена другим пользователем — обновите данные",
                )

            by_tb = {r["neg_finder_tb_id"]: r for r in current_rows}
            desired = {b["neg_finder_tb_id"]: b for b in breakdown}

            to_deactivate: list[int] = []
            to_insert: list[list] = []
            skipped = 0

            for tb, row in by_tb.items():
                want = desired.get(tb)
                if want is None:
                    to_deactivate.append(row["id"])  # ТБ убран из развертки
                    continue
                if self._row_unchanged(row, common, want):
                    skipped += 1  # строка не менялась — сохраняет ETL-происхождение
                    continue
                to_deactivate.append(row["id"])
                to_insert.append(self._build_version_values(common, want, username, old_row=row))

            for tb, want in desired.items():
                if tb not in by_tb:
                    to_insert.append(self._build_version_values(common, want, username, old_row=None))

            if to_deactivate:
                placeholders = ", ".join(f"${i + 2}" for i in range(len(to_deactivate)))
                result = await self.conn.execute(
                    f"UPDATE {self.table} "
                    f"SET updated_at = now(), is_actual = false, updated_by = $1 "
                    f"WHERE id IN ({placeholders}) AND is_actual = true",
                    username, *to_deactivate,
                )
                if (int(result.split()[-1]) if result else 0) != len(to_deactivate):
                    raise FRGroupConflictError(
                        "Запись изменена другим пользователем — обновите данные",
                    )
            if to_insert:
                columns = ", ".join(_INSERT_FIELDS)
                ph = ", ".join(f"${i}" for i in range(1, len(_INSERT_FIELDS) + 1))
                await self.conn.executemany(
                    f"INSERT INTO {self.table} ({columns}) VALUES ({ph})",
                    to_insert,
                )

        logger.info(
            "Групповое сохранение ЦКФР %s: деактивировано=%s, вставлено=%s, "
            "нетронуто=%s, пользователь %s",
            group_key, len(to_deactivate), len(to_insert), skipped, username,
        )
        return {
            "deactivated": len(to_deactivate),
            "inserted": len(to_insert),
            "skipped": skipped,
        }

    async def group_delete(
        self, *, group_key: dict, expected_row_ids: list[int], username: str,
    ) -> int:
        """Групповое удаление: деактивация всех строк группы с deleted_at."""
        async with self.conn.transaction():
            current_rows = await self._load_group_rows(group_key)
            current_ids = {r["id"] for r in current_rows}
            if current_ids != set(expected_row_ids):
                raise FRGroupConflictError(
                    "Запись изменена другим пользователем — обновите данные",
                )
            if not current_ids:
                return 0
            ids = sorted(current_ids)
            placeholders = ", ".join(f"${i + 2}" for i in range(len(ids)))
            result = await self.conn.execute(
                f"UPDATE {self.table} "
                f"SET is_actual = false, deleted_at = now(), updated_at = now(), "
                f"updated_by = $1 "
                f"WHERE id IN ({placeholders}) AND is_actual = true",
                username, *ids,
            )
            count = int(result.split()[-1]) if result else 0
            if count != len(ids):
                raise FRGroupConflictError(
                    "Запись изменена другим пользователем — обновите данные",
                )
        logger.info("Групповое удаление ЦКФР %s: %s строк, пользователь %s",
                    group_key, count, username)
        return count

    # ------------------------------------------------------------------
    # ПОЛУЧЕНИЕ ПО ID
    # ------------------------------------------------------------------

    async def get_by_id(self, record_id: int) -> dict | None:
        """Возвращает запись FR-валидации по ID (из VIEW)."""
        row = await self.conn.fetchrow(
            f"SELECT * FROM {self.view} WHERE id = $1",
            record_id,
        )
        return dict(row) if row else None
