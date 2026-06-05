"""
Тесты структурных инвариантов TableSchema / TableCellSchema (P6a: R6, A2, A3).

Проверяют, что схема таблицы отбраковывает заведомо битые данные (→ 422):
- верхние границы colSpan / rowSpan (R6);
- прямоугольность матрицы (A2);
- совпадение числа ширин с числом колонок (A2);
- объединения в пределах границ таблицы (R6, закрывает IndexError в DOCX);
- взаимоисключение флагов подвида таблицы (A3).

Отдельно — что реальные сетки (двухстрочная шапка метрик, обычная 3×3)
проходят валидацию без ложных отказов.
"""
import pytest
from pydantic import ValidationError

from app.domains.acts.schemas.act_content import TableCellSchema, TableSchema


def _cell(**kw):
    """Хелпер: ячейка с дефолтами, переопределяемыми kwargs."""
    return TableCellSchema(**kw)


def _table(grid_data, **kw):
    """Хелпер: TableSchema из «сырого» списка-списков dict'ов."""
    grid = [[TableCellSchema(**c) for c in row] for row in grid_data]
    return TableSchema(id="t1", nodeId="n1", grid=grid, **kw)


# ── T6a.1: верхние границы colSpan / rowSpan (R6) ──


class TestCellSpanBounds:

    def test_col_span_above_limit_rejected(self):
        with pytest.raises(ValidationError):
            TableCellSchema(colSpan=99)

    def test_col_span_at_limit_allowed(self):
        assert TableCellSchema(colSpan=16).colSpan == 16

    def test_row_span_above_limit_rejected(self):
        with pytest.raises(ValidationError):
            TableCellSchema(rowSpan=99)

    def test_row_span_at_limit_allowed(self):
        assert TableCellSchema(rowSpan=64).rowSpan == 64


# ── T6a.2 (1): прямоугольность матрицы (A2) ──


class TestRectangularity:

    def test_ragged_grid_rejected(self):
        with pytest.raises(ValidationError, match="разную длину"):
            _table([
                [{"content": "A"}, {"content": "B"}],
                [{"content": "C"}],  # короткая строка
            ])

    def test_rectangular_grid_allowed(self):
        t = _table([
            [{"content": "A"}, {"content": "B"}],
            [{"content": "C"}, {"content": "D"}],
        ])
        assert len(t.grid) == 2

    def test_empty_grid_allowed(self):
        t = TableSchema(id="t1", nodeId="n1")
        assert t.grid == []


# ── T6a.2 (2): совпадение числа ширин с числом колонок (A2) ──


class TestColWidthsMatchColumns:

    def test_widths_mismatch_rejected(self):
        with pytest.raises(ValidationError, match="ширин колонок"):
            _table(
                [[{"content": "A"}, {"content": "B"}, {"content": "C"}]],
                colWidths=[100, 100],  # 2 ширины на 3 колонки
            )

    def test_widths_match_allowed(self):
        t = _table(
            [[{"content": "A"}, {"content": "B"}, {"content": "C"}]],
            colWidths=[100, 100, 100],
        )
        assert t.colWidths == [100, 100, 100]

    def test_empty_widths_allowed(self):
        """Пустой colWidths допустим — DOCX делит ширину поровну."""
        t = _table([[{"content": "A"}, {"content": "B"}]])
        assert t.colWidths == []


# ── T6a.2 (3): объединения в пределах границ (R6) ──


class TestSpanWithinBounds:

    def test_col_span_out_of_bounds_rejected(self):
        with pytest.raises(ValidationError, match="выходит за границы"):
            _table([
                [{"content": "A", "colSpan": 3}, {"content": "B"}],
                [{"content": "C"}, {"content": "D"}],
            ])

    def test_row_span_out_of_bounds_rejected(self):
        with pytest.raises(ValidationError, match="выходит за границы"):
            _table([
                [{"content": "A", "rowSpan": 3}, {"content": "B"}],
                [{"content": "", "isSpanned": True}, {"content": "D"}],
            ])

    def test_span_within_bounds_allowed(self):
        t = _table([
            [{"content": "A", "colSpan": 2}, {"content": "", "isSpanned": True}],
            [{"content": "C"}, {"content": "D"}],
        ])
        assert t.grid[0][0].colSpan == 2


# ── T6a.2 (4): взаимоисключение флагов подвида (A3) ──


class TestMutuallyExclusiveFlags:

    def test_two_type_flags_rejected(self):
        with pytest.raises(ValidationError, match="несколько типов"):
            TableSchema(
                id="t1", nodeId="n1",
                isMetricsTable=True, isRegularRiskTable=True,
            )

    def test_metrics_pair_also_rejected(self):
        """isMetricsTable и isMainMetricsTable одновременно — тоже запрещено."""
        with pytest.raises(ValidationError, match="несколько типов"):
            TableSchema(
                id="t1", nodeId="n1",
                isMetricsTable=True, isMainMetricsTable=True,
            )

    def test_single_flag_allowed(self):
        t = TableSchema(id="t1", nodeId="n1", isMetricsTable=True)
        assert t.isMetricsTable is True

    def test_no_flags_allowed(self):
        t = TableSchema(id="t1", nodeId="n1")
        assert t.isMetricsTable is False


# ── Анти-ложные-отказы: реальные сетки проходят ──


class TestNoFalseRejections:

    def test_real_metrics_header_grid_passes(self):
        """Реальная двухстрочная шапка метрик (7 колонок) проходит валидацию.

        Структура 1:1 с `_createMetricsHeaderGrid` во фронте:
        строка 0 — colSpan=2 на «Количество клиентов...» + rowSpan=2 на части
        колонок; строка 1 — spanned-ячейки + «ФЛ»/«ЮЛ».
        """
        grid = [
            [
                {"content": "Код метрики", "isHeader": True, "rowSpan": 2},
                {"content": "Наименование метрики", "isHeader": True, "rowSpan": 2},
                {"content": "Количество клиентов / элементов, ед.",
                 "isHeader": True, "colSpan": 2},
                {"content": "", "isHeader": True, "isSpanned": True,
                 "spanOrigin": {"row": 0, "col": 2}},
                {"content": "Сумма, руб.", "isHeader": True, "rowSpan": 2},
                {"content": "Код БП", "isHeader": True, "rowSpan": 2},
                {"content": "Пункт / подпункт акта", "isHeader": True, "rowSpan": 2},
            ],
            [
                {"content": "", "isHeader": True, "isSpanned": True,
                 "spanOrigin": {"row": 0, "col": 0}},
                {"content": "", "isHeader": True, "isSpanned": True,
                 "spanOrigin": {"row": 0, "col": 1}},
                {"content": "ФЛ", "isHeader": True},
                {"content": "ЮЛ", "isHeader": True},
                {"content": "", "isHeader": True, "isSpanned": True,
                 "spanOrigin": {"row": 0, "col": 4}},
                {"content": "", "isHeader": True, "isSpanned": True,
                 "spanOrigin": {"row": 0, "col": 5}},
                {"content": "", "isHeader": True, "isSpanned": True,
                 "spanOrigin": {"row": 0, "col": 6}},
            ],
            [{"content": ""} for _ in range(7)],
            [{"content": ""} for _ in range(7)],
        ]
        t = _table(grid, colWidths=[80, 200, 100, 100, 120, 80, 120],
                   isMetricsTable=True)
        assert len(t.grid) == 4
        assert all(len(row) == 7 for row in t.grid)

    def test_normal_3x3_with_widths_passes(self):
        t = _table(
            [
                [{"content": "A"}, {"content": "B"}, {"content": "C"}],
                [{"content": "1"}, {"content": "2"}, {"content": "3"}],
                [{"content": "4"}, {"content": "5"}, {"content": "6"}],
            ],
            colWidths=[100, 100, 100],
        )
        assert len(t.grid) == 3
