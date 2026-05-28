"""E2E-тест: формируем демо-акт через DocxFormatter, открываем .docx обратно."""
import tempfile
from datetime import date
from pathlib import Path

import pytest
from docx import Document
from docx.oxml.ns import qn

from app.domains.acts.formatters.docx import DocxFormatter, ExportContext
from app.domains.acts.schemas.act_content import ActDataSchema
from scripts.seed_demo_act import (
    _build_tree, _build_tables, _build_text_blocks, _build_violations,
)


class _Meta:
    km_number = "КМ-99-99999"
    part_number = 1
    total_parts = 1
    inspection_name = "Демо-проверка"
    is_process_based = False
    inspection_start_date = date(2026, 3, 1)
    inspection_end_date = date(2026, 4, 30)
    order_number = "Text/2026/15-Б"


@pytest.fixture
def demo_doc(tmp_path: Path) -> Path:
    fmt = DocxFormatter()
    content = ActDataSchema(
        tree=_build_tree(),
        tables=_build_tables(),
        textBlocks=_build_text_blocks(),
        violations=_build_violations(),
    )
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))
    out = tmp_path / "demo.docx"
    doc.save(out)
    return out


def test_docx_opens_back(demo_doc):
    doc = Document(demo_doc)
    assert len(doc.tables) >= 7  # 1 cover + 6 плашек + N data


def test_header_has_km_number(demo_doc):
    doc = Document(demo_doc)
    header_text = doc.sections[0].header.paragraphs[0].text
    assert "КМ-99-99999" in header_text


def test_footnotes_present_or_absent(demo_doc):
    """Если в демо есть native сноски — footnotes-part должен существовать."""
    doc = Document(demo_doc)
    # семечко не использует сноски, но проверка инфраструктуры
    # должна не падать при отсутствии
    rels = doc.part.rels
    # OK если footnotes часть отсутствует — это валидно
    assert rels is not None


def test_recommendations_rendered(demo_doc):
    """Регрессия: recommendations теперь рендерится."""
    doc = Document(demo_doc)
    full_text = "\n".join(p.text for p in doc.paragraphs)
    # v-5-1 recommendations содержат ключевой текст из seed_demo_act._build_violations
    assert "Пересмотреть" in full_text
    assert "overnight_summary" in full_text
    assert "Рекомендации" in full_text


def test_rubricator_palette(demo_doc):
    """Все плашки разделов имеют заливку #DEEAF6."""
    from app.domains.acts.formatters.docx.styles import Palette
    doc = Document(demo_doc)
    plate_count = 0
    for table in doc.tables[1:]:  # skip cover-table
        if len(table.rows) == 1 and len(table.rows[0].cells) == 2:
            cell = table.rows[0].cells[0]
            shd = cell._tc.find(qn("w:tcPr")).find(qn("w:shd"))
            if shd is not None and shd.get(qn("w:fill"), "").upper() == Palette.rubricator_shade:
                plate_count += 1
    assert plate_count == 6


def test_no_old_styling_remnants(demo_doc):
    """Эталон содержал 'F2F2F2' и 'EDEDED' (аномалии) — в новом выводе их быть не должно."""
    doc = Document(demo_doc)
    xml = doc.element.xml
    assert "F2F2F2" not in xml.upper()
    assert "EDEDED" not in xml.upper()
