"""Паритет-харнесс (идея 12 / §6.6): контракт «редактор ↔ allowlist ↔ inline.py».

Общий JSON tests/fixtures/textblock_parity.json гоняется здесь (бэкенд) и во
фронтовом tests/js/textblock-parity.test.mjs. Два инварианта на каждую фикстуру:

  1. DOCX-структура: _render_textblock даёт заявленные абзацы / ссылки / сноски
     (+ опц. размеры и выравнивания) — inline.py действительно рендерит
     конструкцию, объявленную фикстурой.
  2. Round-trip через bleach: render(sanitize_html(content)) СТРУКТУРНО совпадает
     с render(content). Санитайзер не съедает то, что DOCX умеет рендерить —
     иначе сохранённый акт терял бы конструкцию до экспорта.

Почему bleach, а не DOMPurify: node-тесты бегут в стабе без DOM, UMD-DOMPurify в
них не поднимается. Фронтовая сторона паритета пинит чистые функции/конфиги
allowlist на тех же фикстурах (см. node-файл).
"""
import json
from pathlib import Path

import pytest
from docx import Document
from docx.oxml.ns import qn

from app.domains.acts.formatters.docx import DocxFormatter
from app.domains.acts.schemas.act_content import TextBlockSchema
from app.domains.acts.utils.html_sanitizer import sanitize_html

_FIXTURES_PATH = Path(__file__).parents[4] / "fixtures" / "textblock_parity.json"
_FIXTURES = json.loads(_FIXTURES_PATH.read_text(encoding="utf-8"))["fixtures"]

_ALIGN_NAME = {0: "left", 1: "center", 2: "right", 3: "justify"}


def _render(content: str):
    """Рендерит текстблок в свежий Document, возвращает добавленные абзацы."""
    doc = Document()
    before = len(doc.paragraphs)
    schema = TextBlockSchema(id="t", nodeId="n", content=content)
    DocxFormatter()._render_textblock(doc, schema)
    return doc.paragraphs[before:]


def _counts(paras) -> dict:
    return {
        "paragraphs": len(paras),
        "hyperlinks": sum(len(p._p.findall(qn("w:hyperlink"))) for p in paras),
        "footnotes": sum(
            len(p._p.findall(".//" + qn("w:footnoteReference"))) for p in paras
        ),
    }


def _sizes_pt(paras) -> list:
    """Все размеры run'ов (pt) — включая run'ы внутри w:hyperlink (w:sz = pt×2)."""
    out = []
    for p in paras:
        for sz in p._p.findall(".//" + qn("w:sz")):
            out.append(int(sz.get(qn("w:val"))) / 2.0)
    return sorted(out)


def _alignments(paras) -> list:
    return [
        _ALIGN_NAME.get(int(p.alignment)) if p.alignment is not None else None
        for p in paras
    ]


def _ids(fixtures):
    return [f["name"] for f in fixtures]


def test_fixture_count_in_brief_range():
    """Брифом задан диапазон 8–12 контентов — страж от разрастания/усыхания."""
    assert 8 <= len(_FIXTURES) <= 12


@pytest.mark.parametrize("fx", _FIXTURES, ids=_ids(_FIXTURES))
def test_docx_structure_matches_declared(fx):
    """inline.py рендерит фикстуру ровно с заявленной DOCX-структурой."""
    paras = _render(fx["content"])
    exp = fx["docx"]
    assert _counts(paras) == {
        "paragraphs": exp["paragraphs"],
        "hyperlinks": exp["hyperlinks"],
        "footnotes": exp["footnotes"],
    }
    if "alignments" in exp:
        assert _alignments(paras) == exp["alignments"]
    for want in exp.get("sizes_pt", []):
        assert want in _sizes_pt(paras), f"размер {want}pt отсутствует в {_sizes_pt(paras)}"


@pytest.mark.parametrize("fx", _FIXTURES, ids=_ids(_FIXTURES))
def test_sanitizer_preserves_docx_constructs(fx):
    """Round-trip: bleach не срезает конструкции, которые рендерит DOCX —
    render(sanitize(content)) структурно == render(content)."""
    raw = _render(fx["content"])
    clean = _render(sanitize_html(fx["content"]))
    assert _counts(clean) == _counts(raw)
    assert _sizes_pt(clean) == _sizes_pt(raw)
    assert _alignments(clean) == _alignments(raw)


@pytest.mark.parametrize("fx", _FIXTURES, ids=_ids(_FIXTURES))
def test_sanitizer_keeps_declared_allowlist_tokens(fx):
    """Санитайзер сохраняет объявленные фикстурой теги/css/атрибуты — именно по
    ним DOCX-парсер узнаёт конструкцию (капсулы, размер, выравнивание)."""
    import re

    out = sanitize_html(fx["content"])
    for tag in fx["allowlist_tags"]:
        assert re.search(rf"<{re.escape(tag)}[\s/>]", out), f"<{tag}> срезан: {out!r}"
    for prop in fx["allowlist_css"]:
        assert prop in out, f"css {prop} срезан: {out!r}"
    for attr in fx["allowlist_attrs"]:
        assert f"{attr}=" in out, f"attr {attr} срезан: {out!r}"
