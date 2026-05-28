"""Cover-блок: 4 строки borderless-таблицы с дословными лейблами + NUMPAGES-параграф."""
from datetime import date

from docx import Document
from docx.oxml.ns import qn

from app.domains.acts.formatters.docx.builders.cover import build_cover_block


class _Team:
    def __init__(self, role, full_name, position, username):
        self.role = role
        self.full_name = full_name
        self.position = position
        self.username = username


class _MetaStub:
    km_number = "КМ-99-99999"
    part_number = 1
    total_parts = 1
    inspection_name = "Овернайт-выписки корпоративных клиентов"
    is_process_based = False
    order_number = "АА-99/999-АА"
    order_date = date(2026, 4, 10)
    inspection_start_date = date(2026, 4, 10)
    inspection_end_date = date(2026, 5, 15)
    audit_team = [
        _Team("Куратор", "А.А. Куратова", "Начальник УВА", "99000001"),
        _Team("Руководитель", "Б.Б. Иванов", "Главный аудитор УВА", "99000002"),
    ]


def test_cover_table_has_4_rows_2_cols():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    table = doc.tables[0]
    assert len(table.rows) == 4
    assert all(len(row.cells) == 2 for row in table.rows)


def test_cover_table_borders_are_nil():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    table = doc.tables[0]
    tbl_borders = table._element.find(qn("w:tblPr")).find(qn("w:tblBorders"))
    assert tbl_borders is not None
    for tag in ("top", "left", "bottom", "right", "insideH", "insideV"):
        b = tbl_borders.find(qn(f"w:{tag}"))
        assert b is not None
        assert b.get(qn("w:val")) == "nil"


def test_cover_left_column_has_etalon_labels():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    table = doc.tables[0]
    labels = [row.cells[0].text.strip() for row in table.rows]
    assert labels == [
        "Основание аудиторской проверки:",
        "Состав аудиторской группы:",
        "Сроки проведения аудиторской проверки:",
        "Номер АП в АС СУП СВА:",
    ]


def test_cover_right_column_basis_renders_order_metadata():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    table = doc.tables[0]
    basis_value = table.rows[0].cells[1].text
    assert "АА-99/999-АА" in basis_value
    assert "10.04.2026" in basis_value


def test_cover_right_column_team_includes_kurator_and_lead():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    team_value = doc.tables[0].rows[1].cells[1].text
    assert "Куратор" in team_value
    assert "А.А. Куратова" in team_value
    assert "Руководитель" in team_value
    assert "Б.Б. Иванов" in team_value


def test_cover_right_column_dates_in_dd_mm_yyyy():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    dates_value = doc.tables[0].rows[2].cells[1].text
    assert "10.04.2026" in dates_value
    assert "15.05.2026" in dates_value


def test_cover_right_column_km_number():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    km_value = doc.tables[0].rows[3].cells[1].text
    assert km_value.strip() == "КМ-99-99999"


def test_cover_includes_sheets_paragraph_with_numpages_field():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    body_text = "\n".join(p.text for p in doc.paragraphs)
    assert "Акт аудиторской проверки составлен на" in body_text
    assert "листах" in body_text
    paragraphs_xml = "\n".join(p._p.xml for p in doc.paragraphs)
    assert "NUMPAGES" in paragraphs_xml
