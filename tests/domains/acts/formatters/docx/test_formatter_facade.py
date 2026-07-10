"""Smoke-тест фасада: формирует Document без падений на минимальном content."""
from datetime import date

import pytest
from docx.document import Document

from docx.oxml.ns import qn

from app.domains.acts.formatters.docx import DocxFormatter, ExportContext
from app.domains.acts.schemas.act_content import ActDataSchema, TextBlockSchema


class _Meta:
    km_number = "КМ-99-99999"
    part_number = 1
    total_parts = 1
    inspection_name = "Демо"
    is_process_based = False
    inspection_start_date = date(2026, 3, 1)
    inspection_end_date = date(2026, 4, 30)
    order_number = "Text/2026/15-Б"
    order_date = date(2026, 1, 15)
    city = "Москва"
    audit_team = []
    directives = []


def test_facade_renders_empty_tree_without_error():
    fmt = DocxFormatter()
    content = ActDataSchema(tree={"id": "root", "label": "Акт", "children": []})
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    assert hasattr(doc, "save")


def test_facade_renders_6_rubricators():
    fmt = DocxFormatter()
    sections = [
        {"id": str(i), "label": f"Раздел {i}", "children": []} for i in range(1, 7)
    ]
    content = ActDataSchema(tree={"id": "root", "label": "Акт", "children": sections})
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    # 1 cover-таблица + 6 рубрикаторов = 7 таблиц минимум
    assert len(doc.tables) >= 7


def test_tb_is_not_rendered():
    """#3: ТБ-узлы больше не выводятся («Территориальные банки: …» отсутствует)."""
    fmt = DocxFormatter()
    section = {
        "id": "1", "label": "Раздел 1",
        "children": [
            {"id": "1.1", "type": "item", "label": "Пункт", "tb": ["ВВБ", "СЗБ"]},
        ],
    }
    content = ActDataSchema(tree={"id": "root", "label": "Акт", "children": [section]})
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    assert not any("Территориальные банки" in p.text for p in doc.paragraphs)


def test_textblock_has_no_title():
    """#5: у текстового блока не выводится название узла — только содержимое."""
    fmt = DocxFormatter()
    section = {
        "id": "1", "label": "Раздел 1",
        "children": [
            {"id": "1.1", "type": "textblock", "textBlockId": "tb1",
             "label": "СЕКРЕТНЫЙ ЗАГОЛОВОК"},
        ],
    }
    content = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": [section]},
        textBlocks={"tb1": TextBlockSchema(id="tb1", nodeId="1.1", content="Тело текста")},
    )
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    texts = [p.text for p in doc.paragraphs]
    assert any("Тело текста" in t for t in texts)
    assert not any("СЕКРЕТНЫЙ ЗАГОЛОВОК" in t for t in texts)


def test_body_text_is_justified():
    """#3: текст пунктов и текстблоков выровнен по ширине (jc=both)."""
    fmt = DocxFormatter()
    section = {
        "id": "1", "label": "Раздел 1",
        "children": [
            {"id": "1.1", "type": "item", "label": "Пункт",
             "content": "Текст пункта для выравнивания по ширине листа."},
            {"id": "1.2", "type": "textblock", "textBlockId": "tb1", "label": "X"},
        ],
    }
    content = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": [section]},
        textBlocks={"tb1": TextBlockSchema(id="tb1", nodeId="1.2", content="Тело текстблока")},
    )
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    justified = [
        p.text for p in doc.paragraphs
        if p.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY
    ]
    assert any("Текст пункта" in t for t in justified)
    assert any("Тело текстблока" in t for t in justified)


def test_item_label_and_number_are_bold():
    """#6: пункт — жирный заголовок: и run с текстом, и метка абзаца (авто-номер)."""
    fmt = DocxFormatter()
    section = {
        "id": "1", "label": "Раздел 1",
        "children": [
            {"id": "1.1", "type": "item", "label": "Заголовок пункта"},
        ],
    }
    content = ActDataSchema(tree={"id": "root", "label": "Акт", "children": [section]})
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    para = next(p for p in doc.paragraphs if "Заголовок пункта" in p.text)
    # Текст пункта жирный.
    assert para.runs[0].bold is True
    # Метка абзаца жирная → жирный авто-номер.
    r_pr = para._p.find(qn("w:pPr")).find(qn("w:rPr"))
    assert r_pr is not None and r_pr.find(qn("w:b")) is not None


def test_table_title_keeps_with_next():
    """#4: заголовок таблицы не отрывается от неё (keepNext + keepLines)."""
    from app.domains.acts.schemas.act_content import TableCellSchema, TableSchema
    fmt = DocxFormatter()
    section = {
        "id": "1", "label": "Раздел 1",
        "children": [
            {"id": "1.1", "type": "table", "tableId": "t1", "label": "Таблица рисков"},
        ],
    }
    grid = [[TableCellSchema(content="A", isHeader=True)], [TableCellSchema(content="1")]]
    content = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": [section]},
        tables={"t1": TableSchema(id="t1", nodeId="1.1", grid=grid)},
    )
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    title = next(p for p in doc.paragraphs if "Таблица рисков" in p.text)
    p_pr = title._p.find(qn("w:pPr"))
    assert p_pr.find(qn("w:keepNext")) is not None
    assert p_pr.find(qn("w:keepLines")) is not None


def test_textblock_default_formatting_keeps_legacy_defaults():
    """formatting по умолчанию (нетронутый юзером) → JUSTIFY + body_pt (M.1)."""
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt
    from app.domains.acts.formatters.docx.styles import Sizes
    fmt = DocxFormatter()
    section = {
        "id": "1", "label": "Раздел 1",
        "children": [
            {"id": "1.1", "type": "textblock", "textBlockId": "tb1", "label": "X"},
        ],
    }
    content = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": [section]},
        textBlocks={"tb1": TextBlockSchema(id="tb1", nodeId="1.1", content="Дефолтный блок")},
    )
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    para = next(p for p in doc.paragraphs if "Дефолтный блок" in p.text)
    assert para.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY
    assert para.runs[0].font.size == Pt(Sizes.body_pt)
    assert not para.runs[0].bold
    assert not para.runs[0].italic
    assert not para.runs[0].underline


def test_textblock_inline_formatting_applied():
    """Начертание — из inline-тегов content (B-1/B-37); выравнивание — из
    style="text-align" блочного элемента (TB-1); базовый размер — экранный
    дефолт настроек ×0.75 (16px → 12pt, EXP-2)."""
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt
    fmt = DocxFormatter()
    section = {
        "id": "1", "label": "Раздел 1",
        "children": [
            {"id": "1.1", "type": "textblock", "textBlockId": "tb1", "label": "X"},
        ],
    }
    content = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": [section]},
        textBlocks={"tb1": TextBlockSchema(
            id="tb1", nodeId="1.1",
            # Начертание — inline-тегами в content (единственный источник, B-1);
            # выравнивание — text-align блочного элемента (TB-1).
            content='<div style="text-align: center;">'
                    "<b><i><u>Форматированный блок</u></i></b></div>",
        )},
    )
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    para = next(p for p in doc.paragraphs if "Форматированный блок" in p.text)
    assert para.alignment == WD_ALIGN_PARAGRAPH.CENTER
    run = para.runs[0]
    assert run.font.size == Pt(12)  # база 16px × 0.75
    assert run.bold is True
    assert run.italic is True
    assert run.underline is True


def test_textblock_html_left_alignment_applied():
    """text-align: left применяется буквально (LEFT); начертание — из inline <b>."""
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    fmt = DocxFormatter()
    section = {
        "id": "1", "label": "Раздел 1",
        "children": [
            {"id": "1.1", "type": "textblock", "textBlockId": "tb1", "label": "X"},
        ],
    }
    content = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": [section]},
        textBlocks={"tb1": TextBlockSchema(
            id="tb1", nodeId="1.1",
            content='<div style="text-align: left;"><b>Левый блок</b></div>',
        )},
    )
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    para = next(p for p in doc.paragraphs if "Левый блок" in p.text)
    assert para.alignment == WD_ALIGN_PARAGRAPH.LEFT
    assert para.runs[0].bold is True


def test_textblock_default_size_with_custom_alignment_keeps_body_pt():
    """База текстблока = экранный дефолт настроек ×0.75 = 12pt (=body_pt, EXP-2);
    смена только выравнивания (center) размер не трогает (прежний спец-кейс
    «14px→12pt» удалён — база берётся из настроек единообразно).
    """
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt
    from app.domains.acts.formatters.docx.styles import Sizes
    fmt = DocxFormatter()
    section = {
        "id": "1", "label": "Раздел 1",
        "children": [
            {"id": "1.1", "type": "textblock", "textBlockId": "tb1", "label": "X"},
        ],
    }
    content = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": [section]},
        textBlocks={"tb1": TextBlockSchema(
            id="tb1", nodeId="1.1",
            content='<div style="text-align: center;">Центрированный блок</div>',
        )},
    )
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    para = next(p for p in doc.paragraphs if "Центрированный блок" in p.text)
    assert para.alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert para.runs[0].font.size == Pt(Sizes.body_pt)  # 12pt


def test_item_content_rendered_as_plain_text():
    """item.content — plain-текст из textarea: <b> и & выводятся дословно (M.4)."""
    fmt = DocxFormatter()
    section = {
        "id": "1", "label": "Раздел 1",
        "children": [
            {"id": "1.1", "type": "item", "label": "Пункт",
             "content": "Сравнение: a<b>c & d"},
        ],
    }
    content = ActDataSchema(tree={"id": "root", "label": "Акт", "children": [section]})
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Сравнение: a<b>c & d" in text


def test_update_fields_enabled():
    """#8: документ помечен на пересчёт полей (NUMPAGES/PAGE) при открытии."""
    fmt = DocxFormatter()
    content = ActDataSchema(tree={"id": "root", "label": "Акт", "children": []})
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    update = doc.settings.element.find(qn("w:updateFields"))
    assert update is not None
    assert update.get(qn("w:val")) == "true"


def test_shift_return_expansion_disabled():
    """Строки с мягким переносом (<w:br> из Enter) не раздуваются под «по ширине».

    Без <w:doNotExpandShiftReturn/> Word растягивает короткую строку с ручным
    переносом на всю ширину абзаца, и единственная щель на ней (стык
    «слово-якорь ↔ номер сноски») баллонит. Естественно переносимый текст
    остаётся justified.
    """
    fmt = DocxFormatter()
    content = ActDataSchema(tree={"id": "root", "label": "Акт", "children": []})
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    compat = doc.settings.element.find(qn("w:compat"))
    assert compat is not None
    el = compat.find(qn("w:doNotExpandShiftReturn"))
    assert el is not None
    # #13: CT_Compat — фиксированная xsd:sequence. doNotExpandShiftReturn обязан
    # идти РАНЬШЕ useFELayout (дефолтный шаблон python-docx) и любого
    # compatSetting, иначе settings.xml схемо-невалиден. Проверяем именно порядок.
    children = [c.tag.rsplit("}", 1)[-1] for c in compat]
    idx = children.index("doNotExpandShiftReturn")
    if "useFELayout" in children:
        assert idx < children.index("useFELayout")
    if "compatSetting" in children:
        assert idx < children.index("compatSetting")
