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


def test_update_fields_enabled():
    """#8: документ помечен на пересчёт полей (NUMPAGES/PAGE) при открытии."""
    fmt = DocxFormatter()
    content = ActDataSchema(tree={"id": "root", "label": "Акт", "children": []})
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    update = doc.settings.element.find(qn("w:updateFields"))
    assert update is not None
    assert update.get(qn("w:val")) == "true"
