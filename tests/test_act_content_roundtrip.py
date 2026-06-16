"""
Round-trip-страж контракта фронт↔бэк для данных акта (рекомендация §5.3 аудита).

Фикстура повторяет ТОЧНУЮ форму фронтового снимка AppState.exportData()
(static/js/constructor/state/state-core.js, _serializeTree/_serializeTables/
_serializeTextBlocks/_serializeViolations): дерево с разделами, обычная
таблица с colWidths, текстблок с formatting, нарушение с descriptionList и
additionalContent. Прогон ActDataSchema.model_validate → model_dump обязан
сохранить КАЖДОЕ поле фикстуры (рекурсивное сравнение): если схему изменят
несинхронно с фронтом (переименуют/удалят поле, extra="ignore" молча выкинет
ключ) — тест укажет на потерянное поле.

Вторая часть — границы лимитов: 64×16 для grid и fontSize 8-72 обязаны
совпадать с константами теста (зеркало AppConfig.limits во фронте,
static/js/shared/app-config.js; JS-страж — tests/js/table-cells-limits.test.mjs).
"""
import pytest
from pydantic import ValidationError

from app.domains.acts.schemas.act_content import (
    ActDataSchema,
    TableSchema,
    TextBlockFormattingSchema,
)

# Контрактные константы (зеркало фронтового AppConfig.limits).
MAX_TABLE_ROWS = 64
MAX_TABLE_COLS = 16
FONT_SIZE_MIN = 8
FONT_SIZE_MAX = 72


def _cell(row: int, col: int, **overrides) -> dict:
    """Ячейка grid в форме _serializeTables: всегда все 8 полей."""
    cell = {
        "content": f"{row}:{col}",
        "isHeader": row == 0,
        "colSpan": 1,
        "rowSpan": 1,
        "isSpanned": False,
        "spanOrigin": None,
        "originRow": row,
        "originCol": col,
    }
    cell.update(overrides)
    return cell


def _grid(rows: int, cols: int) -> list[list[dict]]:
    """Сетка rows×cols: первая строка — заголовок, остальные — данные."""
    return [[_cell(r, c) for c in range(cols)] for r in range(rows)]


def _make_export_fixture() -> dict:
    """
    Минимальный акт в точной форме exportData():
    дерево (root → раздел 5 → пункт с таблицей/текстблоком/нарушением),
    1 обычная таблица с colWidths и объединением, 1 риск-таблица с подвидом
    kind (exportData сериализует kind только при не-'regular'), 1 текстблок
    с formatting, 1 нарушение с descriptionList и additionalContent.
    """
    grid = _grid(3, 3)
    # Горизонтальное объединение в строке данных — spanOrigin переживает round-trip.
    grid[1][0]["colSpan"] = 2
    grid[1][1] = _cell(1, 1, content="", isSpanned=True, spanOrigin={"row": 1, "col": 0})

    return {
        "tree": {
            "id": "root",
            "label": "Акт",
            "type": "item",
            "protected": False,
            "deletable": True,
            "content": "",
            "children": [
                {
                    "id": "5",
                    "label": "Результаты проверки",
                    "type": "item",
                    "protected": True,
                    "deletable": False,
                    "content": "",
                    "children": [
                        {
                            "id": "5.1",
                            "label": "Пункт проверки",
                            "type": "item",
                            "protected": False,
                            "deletable": True,
                            "content": "Текст пункта",
                            "customLabel": "Пункт проверки",
                            "number": "5.1",
                            "tb": ["СибБ"],
                            "auditPointId": "ap-1",
                            "children": [
                                {
                                    "id": "5.1_table_1",
                                    "label": "Таблица",
                                    "type": "table",
                                    "protected": False,
                                    "deletable": True,
                                    "tableId": "t1",
                                    "children": [],
                                },
                                {
                                    "id": "5.1_table_2",
                                    "label": "Выявлены риски",
                                    "type": "table",
                                    "protected": True,
                                    "deletable": True,
                                    "tableId": "t2",
                                    "kind": "regularRisk",
                                    "children": [],
                                },
                                {
                                    "id": "5.1_tb_1",
                                    "label": "Текстовый блок",
                                    "type": "textblock",
                                    "protected": False,
                                    "deletable": True,
                                    "textBlockId": "b1",
                                    "children": [],
                                },
                                {
                                    "id": "5.1_v_1",
                                    "label": "Нарушение",
                                    "type": "violation",
                                    "protected": False,
                                    "deletable": True,
                                    "violationId": "v1",
                                    "children": [],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        "tables": {
            "t1": {
                "id": "t1",
                "nodeId": "5.1_table_1",
                "grid": grid,
                "colWidths": [150, 200, 100],
                "protected": False,
                "deletable": True,
            },
            "t2": {
                "id": "t2",
                "nodeId": "5.1_table_2",
                "grid": _grid(2, 2),
                "colWidths": [100, 100],
                "protected": True,
                "deletable": True,
                "kind": "regularRisk",
            },
        },
        "textBlocks": {
            "b1": {
                "id": "b1",
                "nodeId": "5.1_tb_1",
                "content": "<p>Текст блока</p>",
                "formatting": {
                    "bold": True,
                    "italic": False,
                    "underline": False,
                    "fontSize": 14,
                    "alignment": "justify",
                },
            },
        },
        "violations": {
            "v1": {
                "id": "v1",
                "nodeId": "5.1_v_1",
                "violated": "Нарушен пункт регламента",
                "established": "Установлено отклонение",
                "descriptionList": {
                    "enabled": True,
                    "items": ["Описание один", "Описание два"],
                },
                "additionalContent": {
                    "enabled": True,
                    "items": [
                        {
                            "id": "ac-1",
                            "type": "case",
                            "content": "Кейс с примером",
                            "url": "",
                            "caption": "",
                            "filename": "",
                            "order": 0,
                            "width": 0,
                        },
                        {
                            "id": "ac-2",
                            "type": "image",
                            "content": "",
                            "url": "data:image/png;base64,AAAA",
                            "caption": "Скриншот",
                            "filename": "screen.png",
                            "order": 1,
                            "width": 50,
                        },
                    ],
                },
                "reasons": {"enabled": True, "content": "Причина"},
                "consequences": {"enabled": False, "content": ""},
                "responsible": {"enabled": False, "content": ""},
                "recommendations": {"enabled": True, "content": "Рекомендация"},
            },
        },
        "invoiceNodeIds": ["5.1"],
    }


def _assert_no_field_lost(expected, actual, path: str = "$") -> None:
    """
    Рекурсивно проверяет, что КАЖДЫЙ ключ/элемент expected присутствует в
    actual с тем же значением. Дополнительные ключи в actual допустимы
    (дефолты схемы: changelog, saveType и т.п.).
    """
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: ожидался dict, получен {type(actual).__name__}"
        for key, exp_value in expected.items():
            assert key in actual, f"{path}.{key}: поле фикстуры потеряно после round-trip"
            _assert_no_field_lost(exp_value, actual[key], f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list), f"{path}: ожидался list, получен {type(actual).__name__}"
        assert len(actual) == len(expected), (
            f"{path}: длина списка изменилась ({len(expected)} → {len(actual)})"
        )
        for i, (exp_item, act_item) in enumerate(zip(expected, actual)):
            _assert_no_field_lost(exp_item, act_item, f"{path}[{i}]")
    else:
        assert actual == expected, f"{path}: значение изменилось ({expected!r} → {actual!r})"


class TestExportDataRoundTrip:
    """Снимок exportData() переживает validate → dump без потери полей."""

    def test_roundtrip_preserves_every_fixture_field(self):
        """Ни одно поле фикстуры не теряется и не меняет значения."""
        fixture = _make_export_fixture()

        data = ActDataSchema.model_validate(fixture)
        dumped = data.model_dump()

        _assert_no_field_lost(fixture, dumped)

    def test_roundtrip_keeps_colwidths_untouched_when_length_matches(self):
        """colWidths по числу колонок не нормализуются (длина и значения те же)."""
        fixture = _make_export_fixture()

        dumped = ActDataSchema.model_validate(fixture).model_dump()

        assert dumped["tables"]["t1"]["colWidths"] == [150, 200, 100]


class TestLimitsMatchContractConstants:
    """Границы схемы совпадают с контрактными константами (64×16, 8-72)."""

    def test_grid_at_limit_validates(self):
        """Грид ровно 64×16 проходит валидацию."""
        table = {
            "id": "t1",
            "nodeId": "n1",
            "grid": _grid(MAX_TABLE_ROWS, MAX_TABLE_COLS),
            "colWidths": [100] * MAX_TABLE_COLS,
        }
        validated = TableSchema.model_validate(table)
        assert len(validated.grid) == MAX_TABLE_ROWS
        assert len(validated.grid[0]) == MAX_TABLE_COLS

    def test_grid_rows_over_limit_rejected(self):
        """65 строк — отказ 422-семантикой (ValidationError)."""
        table = {
            "id": "t1",
            "nodeId": "n1",
            "grid": _grid(MAX_TABLE_ROWS + 1, 2),
            "colWidths": [100, 100],
        }
        with pytest.raises(ValidationError):
            TableSchema.model_validate(table)

    def test_grid_cols_over_limit_rejected(self):
        """17 колонок в строке — отказ (validate_grid_dimensions)."""
        table = {
            "id": "t1",
            "nodeId": "n1",
            "grid": _grid(2, MAX_TABLE_COLS + 1),
            "colWidths": [100] * (MAX_TABLE_COLS + 1),
        }
        with pytest.raises(ValidationError):
            TableSchema.model_validate(table)

    def test_font_size_bounds_accept_min_and_max(self):
        """Границы fontSize включительны: 8 и 72 валидны."""
        assert TextBlockFormattingSchema(fontSize=FONT_SIZE_MIN).fontSize == FONT_SIZE_MIN
        assert TextBlockFormattingSchema(fontSize=FONT_SIZE_MAX).fontSize == FONT_SIZE_MAX

    def test_font_size_out_of_bounds_rejected(self):
        """За границами (7 и 73) — отказ."""
        with pytest.raises(ValidationError):
            TextBlockFormattingSchema(fontSize=FONT_SIZE_MIN - 1)
        with pytest.raises(ValidationError):
            TextBlockFormattingSchema(fontSize=FONT_SIZE_MAX + 1)
