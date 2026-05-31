"""Cover-блок: 4 строки borderless-таблицы с дословными лейблами + NUMPAGES-параграф."""
from datetime import date

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml.ns import qn
from docx.shared import Pt

from app.domains.acts.formatters.docx.builders.cover import build_cover_block
from app.domains.acts.formatters.docx.styles import Margins, Page


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
    city = "Москва"
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


def _meta_with_team(team):
    """Копия _MetaStub с переопределённым составом группы (per-instance)."""
    meta = _MetaStub()
    meta.audit_team = team
    return meta


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


def test_cover_preamble_has_right_aligned_appendix_label():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    matches = [
        p for p in doc.paragraphs
        if p.text.strip() == "Приложение 1"
        and p.alignment == WD_ALIGN_PARAGRAPH.RIGHT
    ]
    assert matches, "ожидался абзац «Приложение 1» с выравниванием вправо"


def test_cover_preamble_has_city_and_start_date():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    matches = [p for p in doc.paragraphs if "г. Москва" in p.text]
    assert matches, "ожидался абзац с «г. Москва»"
    line = matches[0].text
    assert "«10» апреля 2026 г." in line


def test_cover_preamble_has_centered_title():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    expected = "Акт аудиторской проверки по Овернайт-выписки корпоративных клиентов"
    matches = [
        p for p in doc.paragraphs
        if p.text.strip() == expected
        and p.alignment == WD_ALIGN_PARAGRAPH.CENTER
    ]
    assert matches, "ожидался центрированный заголовок акта"


def test_cover_includes_sheets_paragraph_with_numpages_field():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    body_text = "\n".join(p.text for p in doc.paragraphs)
    assert "Акт аудиторской проверки составлен на" in body_text
    assert "листах" in body_text
    paragraphs_xml = "\n".join(p._p.xml for p in doc.paragraphs)
    assert "NUMPAGES" in paragraphs_xml


def test_appendix_label_is_bold():
    doc = Document()
    build_cover_block(doc, _MetaStub())
    appendix = next(p for p in doc.paragraphs if p.text.strip() == "Приложение 1")
    bold_run = next(r for r in appendix.runs if r.text.strip())
    assert bold_run.bold is True


def test_preamble_lines_have_12pt_after_spacing():
    """«Приложение 1», город+дата и заголовок — интервал после абзаца 12pt."""
    doc = Document()
    build_cover_block(doc, _MetaStub())
    targets = ("Приложение 1", "г. Москва", "Акт аудиторской проверки по")
    matched = [
        p for p in doc.paragraphs
        if any(t in p.text for t in targets) and p.paragraph_format.space_after == Pt(12)
    ]
    assert len(matched) == 3


def test_numpages_field_uses_separate_runs():
    """Поле NUMPAGES — каноничные отдельные run'ы begin/instr/separate/result/end."""
    doc = Document()
    build_cover_block(doc, _MetaStub())
    sheets = next(p for p in doc.paragraphs if "составлен на" in p.text)
    kinds = []
    for r in sheets._p.findall(qn("w:r")):
        fc = r.find(qn("w:fldChar"))
        it = r.find(qn("w:instrText"))
        tt = r.find(qn("w:t"))
        if fc is not None:
            kinds.append("fld:" + fc.get(qn("w:fldCharType")))
        elif it is not None:
            kinds.append("instr")
        elif tt is not None:
            kinds.append("t")
    want = ["fld:begin", "instr", "fld:separate", "t", "fld:end"]
    assert any(kinds[i:i + 5] == want for i in range(len(kinds)))


def test_title_is_bold():
    """п.1: заголовок «Акт аудиторской проверки по …» жирный."""
    doc = Document()
    build_cover_block(doc, _MetaStub())
    expected = "Акт аудиторской проверки по Овернайт-выписки корпоративных клиентов"
    title = next(p for p in doc.paragraphs if p.text.strip() == expected)
    bold_run = next(r for r in title.runs if r.text.strip())
    assert bold_run.bold is True


def test_numpages_field_begin_is_dirty_and_cache_empty():
    """п.2: fldChar begin имеет w:dirty="true", кэш результата (w:t) пустой."""
    doc = Document()
    build_cover_block(doc, _MetaStub())
    sheets = next(p for p in doc.paragraphs if "составлен на" in p.text)

    # Кэш результата — это w:t между fldChar separate и fldChar end.
    begin = None
    result_t = None
    in_field_result = False
    for r in sheets._p.findall(qn("w:r")):
        fc = r.find(qn("w:fldChar"))
        if fc is not None:
            kind = fc.get(qn("w:fldCharType"))
            if kind == "begin":
                begin = fc
            elif kind == "separate":
                in_field_result = True
            elif kind == "end":
                in_field_result = False
            continue
        tt = r.find(qn("w:t"))
        if tt is not None and in_field_result:
            result_t = tt

    assert begin is not None
    assert begin.get(qn("w:dirty")) == "true"
    assert result_t is not None
    assert (result_t.text or "") == ""


def test_city_date_right_tab_stop_equals_usable_width():
    """п.3: правый tab-stop города/даты = рабочая ширина (страница − поля)."""
    doc = Document()
    build_cover_block(doc, _MetaStub())
    city_para = next(p for p in doc.paragraphs if "г. Москва" in p.text)
    tab_stops = list(city_para.paragraph_format.tab_stops)
    assert len(tab_stops) == 1
    ts = tab_stops[0]
    assert ts.alignment == WD_TAB_ALIGNMENT.RIGHT
    expected = Page.width_twips - Margins.left - Margins.right
    # position в EMU; Twips(expected) даёт ту же величину.
    from docx.shared import Twips
    assert ts.position == Twips(expected)


def test_team_each_member_on_own_line():
    """п.3 (новое): каждый член — на своей строке, кураторы/руководители тоже."""
    team = [
        _Team("Куратор", "Иванов И.И.", "Директор", "1"),
        _Team("Куратор", "Орлов О.О.", "Зам. директора", "2"),
        _Team("Руководитель", "Сидоров С.С.", "Нач. отдела", "3"),
        _Team("Участник", "Петров П.П.", "Аудитор", "4"),
    ]
    doc = Document()
    build_cover_block(doc, _meta_with_team(team))
    cell = doc.tables[0].rows[1].cells[1]
    lines = [p.text for p in cell.paragraphs if p.text]
    # Два куратора — две отдельные строки, без запятой.
    assert "Куратор – Иванов И.И. (Директор)" in lines
    assert "Куратор – Орлов О.О. (Зам. директора)" in lines
    assert "Руководитель – Сидоров С.С. (Нач. отдела)" in lines
    assert "Участник – Петров П.П. (Аудитор)" in lines
    # Ничего не слито через запятую.
    assert not any("), " in ln for ln in lines)


def test_team_appendix_ref_renders_full_name_without_participants():
    """п.11: при AppendixRef рендерится его full_name, отдельных участников нет."""
    team = [
        _Team("Куратор", "Иванов И.И.", "Директор", "1"),
        _Team("Участник", "Петров П.П.", "Аудитор", "2"),
        _Team(
            "AppendixRef",
            "В соответствии с приложением №3 к распоряжению…",
            "-",
            "-",
        ),
    ]
    doc = Document()
    build_cover_block(doc, _meta_with_team(team))
    team_value = doc.tables[0].rows[1].cells[1].text
    assert "Участники – В соответствии с приложением №3 к распоряжению…" in team_value
    # Отдельный участник Петров не должен перечисляться.
    assert "Петров П.П." not in team_value


def test_team_without_appendix_lists_participants_and_editors_as_uchastnik():
    """п.12: без AppendixRef участники И редакторы построчно с подписью «Участник»."""
    team = [
        _Team("Куратор", "Иванов И.И.", "Директор", "1"),
        _Team("Руководитель", "Сидоров С.С.", "Нач. отдела", "2"),
        _Team("Участник", "Петров П.П.", "Аудитор", "3"),
        _Team("Редактор", "Смирнов С.С.", "Ст. аудитор", "4"),
    ]
    doc = Document()
    build_cover_block(doc, _meta_with_team(team))
    team_value = doc.tables[0].rows[1].cells[1].text
    assert "Участник – Петров П.П. (Аудитор)" in team_value
    # Редактор выводится как «Участник», без подписи «Редактор».
    assert "Участник – Смирнов С.С. (Ст. аудитор)" in team_value
    assert "Редактор" not in team_value
