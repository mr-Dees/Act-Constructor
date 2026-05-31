"""Cover-блок: borderless-таблица 2×4 под эталон + параграф «Акт … составлен на N листах»."""
from datetime import date

from docx.document import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, Twips

from app.domains.acts.formatters.docx.builders.tables import set_table_left_indent_zero
from app.domains.acts.formatters.docx.styles import Fonts, Margins, Page, Sizes

_MONTHS_GENITIVE = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)


def build_cover_block(doc: Document, metadata) -> None:
    """Рендерит шапку акта под эталон.

    0. Преамбула над таблицей: «Приложение 1» (вправо), строка «город + дата начала»
       (город слева, дата справа через tab-stop) и центрированный заголовок
       «Акт аудиторской проверки по {inspection_name}».
    1. Таблица 4×2 без видимых рамок.
       Левая колонка — bold-лейблы, правая — значения из metadata.
    2. Отдельный параграф под таблицей: «Акт аудиторской проверки составлен на N листах,
       приложение на 1 листе.» где N — Word-поле NUMPAGES (пересчитывается при открытии).
    """
    _add_preamble(doc, metadata)

    table = doc.add_table(rows=4, cols=2)
    table.autofit = False
    _set_invisible_borders(table)
    set_table_left_indent_zero(table)

    rows = _build_rows(metadata)
    for row_idx, (label, value_html) in enumerate(rows):
        _fill_label_cell(table.rows[row_idx].cells[0], label)
        _fill_value_cell(table.rows[row_idx].cells[1], value_html)

    _add_sheets_paragraph(doc)


def _add_preamble(doc, m) -> None:
    """Три элемента над таблицей параметров: «Приложение 1», город+дата, заголовок.

    У всех трёх строк интервал после абзаца — 12pt.
    """
    # 1. «Приложение 1» — вправо, жирным.
    app_para = doc.add_paragraph()
    app_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    app_para.paragraph_format.space_after = Pt(12)
    app_run = app_para.add_run("Приложение 1")
    app_run.font.name = Fonts.main
    app_run.font.size = Pt(Sizes.cover_label_pt)
    app_run.bold = True

    # 2. Город слева, дата начала проверки справа через правый tab-stop.
    city = getattr(m, "city", None) or ""
    city_date_para = doc.add_paragraph()
    city_date_para.alignment = WD_ALIGN_PARAGRAPH.LEFT
    city_date_para.paragraph_format.space_after = Pt(12)
    # Правый tab-stop — на рабочую ширину текста (страница − левое − правое поле),
    # чтобы дата прижималась ровно к правой границе текста.
    usable_twips = Page.width_twips - Margins.left - Margins.right
    city_date_para.paragraph_format.tab_stops.add_tab_stop(
        Twips(usable_twips), WD_TAB_ALIGNMENT.RIGHT
    )
    city_run = city_date_para.add_run(f"г. {city}\t{_format_start_date(m.inspection_start_date)}")
    city_run.font.name = Fonts.main
    city_run.font.size = Pt(Sizes.cover_label_pt)

    # 3. Заголовок по центру, жирным.
    title_para = doc.add_paragraph()
    title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_para.paragraph_format.space_after = Pt(12)
    title_run = title_para.add_run(f"Акт аудиторской проверки по {m.inspection_name}")
    title_run.font.name = Fonts.main
    title_run.font.size = Pt(Sizes.cover_label_pt)
    title_run.bold = True


def _format_start_date(d) -> str:
    """Дата начала проверки в формате «{день}» {месяц_род_падеж} {год} г."""
    if not d:
        return ""
    return f"«{d.day}» {_MONTHS_GENITIVE[d.month - 1]} {d.year} г."


def _build_rows(m) -> list[tuple[str, str]]:
    order_date = getattr(m, "order_date", None)
    audit_team = getattr(m, "audit_team", None) or []
    order_date_str = order_date.strftime("%d.%m.%Y") if order_date else ""
    start_str = m.inspection_start_date.strftime("%d.%m.%Y") if m.inspection_start_date else ""
    end_str = m.inspection_end_date.strftime("%d.%m.%Y") if m.inspection_end_date else ""

    order_year = order_date.year if order_date else (m.inspection_start_date.year if m.inspection_start_date else "")
    basis = (
        f"План работы СВА на {order_year} год. "
        f"Распоряжение от {order_date_str} №{m.order_number}."
    )

    team_lines = []

    # Каждый член группы — на отдельной строке (кураторы и руководители тоже,
    # без перечисления через запятую).
    for t in audit_team:
        if getattr(t, "role", None) == "Куратор":
            team_lines.append(f"Куратор – {t.full_name} ({t.position})")
    for t in audit_team:
        if getattr(t, "role", None) == "Руководитель":
            team_lines.append(f"Руководитель – {t.full_name} ({t.position})")

    # AppendixRef — служебная запись с готовым текстом «В соответствии с приложением…».
    # Если она есть, участников не перечисляем, выводим её full_name одной строкой.
    appendix_ref = next(
        (t for t in audit_team if getattr(t, "role", None) == "AppendixRef"), None
    )
    if appendix_ref is not None:
        team_lines.append(f"Участники – {appendix_ref.full_name}")
    else:
        # Участники и редакторы — построчно, оба с подписью «Участник».
        for t in audit_team:
            if getattr(t, "role", None) in ("Участник", "Редактор"):
                team_lines.append(f"Участник – {t.full_name} ({t.position})")

    team_value = "\n".join(team_lines)

    dates_value = f"Начата {start_str} и завершена {end_str}"

    return [
        ("Основание аудиторской проверки:", basis),
        ("Состав аудиторской группы:", team_value),
        ("Сроки проведения аудиторской проверки:", dates_value),
        ("Номер АП в АС СУП СВА:", m.km_number),
    ]


def _fill_label_cell(cell, label: str) -> None:
    cell.text = ""
    para = cell.paragraphs[0]
    run = para.add_run(label)
    run.bold = True
    run.font.name = Fonts.main
    run.font.size = Pt(Sizes.cover_label_pt)


def _fill_value_cell(cell, value: str) -> None:
    cell.text = ""
    lines = value.split("\n")
    for idx, line in enumerate(lines):
        para = cell.paragraphs[0] if idx == 0 else cell.add_paragraph()
        run = para.add_run(line)
        run.font.name = Fonts.main
        run.font.size = Pt(Sizes.body_pt)


def _set_invisible_borders(table) -> None:
    tbl_pr = table._element.find(qn("w:tblPr"))
    borders = OxmlElement("w:tblBorders")
    for tag in ("top", "left", "bottom", "right", "insideH", "insideV"):
        b = OxmlElement(f"w:{tag}")
        b.set(qn("w:val"), "nil")
        borders.append(b)
    tbl_pr.append(borders)


def _add_sheets_paragraph(doc) -> None:
    para = doc.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.LEFT

    prefix_run = para.add_run("Акт аудиторской проверки составлен на ")
    prefix_run.font.name = Fonts.main
    prefix_run.font.size = Pt(Sizes.body_pt)

    _append_field(para, "NUMPAGES")

    suffix_run = para.add_run(" листах, приложение на 1 листе.")
    suffix_run.font.name = Fonts.main
    suffix_run.font.size = Pt(Sizes.body_pt)


def _append_field(paragraph, instr: str) -> None:
    """Вставляет Word-поле { instr } каноническими отдельными run'ами.

    begin → instrText → separate → результат → end, каждый в своём <w:r>.
    Если свалить всё в один run, Word/LibreOffice не распознают поле и
    показывают литерал кэша («1»), не пересчитывая NUMPAGES.
    """
    def _emit(child) -> None:
        run = paragraph.add_run()
        run.font.name = Fonts.main
        run.font.size = Pt(Sizes.body_pt)
        run._r.append(child)

    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    # w:dirty="true" заставляет Word пересчитать именно это поле при открытии.
    fld_begin.set(qn("w:dirty"), "true")
    _emit(fld_begin)

    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = f" {instr} "
    _emit(instr_text)

    fld_separate = OxmlElement("w:fldChar")
    fld_separate.set(qn("w:fldCharType"), "separate")
    _emit(fld_separate)

    # Пустой кэш результата: не-пересчитывающий просмотрщик не напечатает неверную «1».
    result = OxmlElement("w:t")
    result.text = ""
    _emit(result)

    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    _emit(fld_end)
