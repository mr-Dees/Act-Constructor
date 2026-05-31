"""Регистрация native footnotes через oxml.

python-docx не имеет high-level API для footnotes — собираем через
прямую работу с word/footnotes.xml и FOOTNOTES relationship.
"""
from lxml import etree

from docx.opc.constants import CONTENT_TYPE, RELATIONSHIP_TYPE
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsmap, qn
from docx.text.paragraph import Paragraph

from app.domains.acts.formatters.docx.styles import Fonts, Sizes


_FOOTNOTES_REL = RELATIONSHIP_TYPE.FOOTNOTES
_FOOTNOTES_CT = CONTENT_TYPE.WML_FOOTNOTES

# XML-скелет footnotes-части со стандартными разделителями (id=-1 и id=0)
_FOOTNOTES_INITIAL_XML = (
    b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    b'<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    b'<w:footnote w:id="-1" w:type="separator">'
    b'<w:p><w:r><w:separator/></w:r></w:p>'
    b'</w:footnote>'
    b'<w:footnote w:id="0" w:type="continuationSeparator">'
    b'<w:p><w:r><w:continuationSeparator/></w:r></w:p>'
    b'</w:footnote>'
    b'</w:footnotes>'
)


def add_footnote(paragraph: Paragraph, text: str) -> int:
    """Добавляет нативную сноску Word к параграфу и возвращает её id.

    При первом вызове создаёт footnotes-часть (word/footnotes.xml)
    с обязательными записями separator (id=-1) и continuationSeparator (id=0).
    Первая пользовательская сноска получает id=1.
    """
    doc_part = paragraph.part
    footnotes_part = _get_or_create_footnotes_part(doc_part)
    footnote_id = _next_footnote_id(footnotes_part)

    _append_footnote_element(footnotes_part, footnote_id, text)
    _insert_reference(paragraph, footnote_id)

    return footnote_id


def _get_or_create_footnotes_part(doc_part) -> Part:
    """Возвращает существующую footnotes-часть или создаёт новую."""
    try:
        return doc_part.part_related_by(_FOOTNOTES_REL)
    except KeyError:
        pass

    partname = PackURI("/word/footnotes.xml")
    part = Part(partname, _FOOTNOTES_CT, _FOOTNOTES_INITIAL_XML, doc_part.package)
    # Разбираем XML в lxml-элемент для дальнейших модификаций
    part._element = parse_xml(_FOOTNOTES_INITIAL_XML)
    doc_part.relate_to(part, _FOOTNOTES_REL)
    return part


def _next_footnote_id(footnotes_part: Part) -> int:
    """Возвращает следующий свободный id сноски (минимум 1)."""
    existing_ids = [
        int(el.get(qn("w:id")))
        for el in footnotes_part._element.findall(qn("w:footnote"))
        if el.get(qn("w:id")) is not None
    ]
    max_id = max(existing_ids) if existing_ids else 0
    return max(max_id + 1, 1)


def _append_footnote_element(footnotes_part: Part, footnote_id: int, text: str) -> None:
    """Добавляет w:footnote элемент в footnotes-часть и обновляет blob."""
    ns = nsmap["w"]
    safe = (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    xml = (
        f'<w:footnote xmlns:w="{ns}" w:id="{footnote_id}">'
        f'<w:p>'
        f'<w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'
        f'<w:r>'
        f'<w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
        f'<w:footnoteRef/>'
        f'</w:r>'
        f'<w:r>'
        f'<w:rPr>'
        f'<w:rFonts w:ascii="{Fonts.main}" w:hAnsi="{Fonts.main}"/>'
        f'<w:sz w:val="{Sizes.footnote_pt * 2}"/>'
        f'</w:rPr>'
        f'<w:t xml:space="preserve"> {safe}</w:t>'
        f'</w:r>'
        f'</w:p>'
        f'</w:footnote>'
    ).encode("utf-8")
    element = parse_xml(xml)
    footnotes_part._element.append(element)
    # Синхронизируем blob с актуальным состоянием XML-дерева
    footnotes_part._blob = etree.tostring(footnotes_part._element, xml_declaration=True, encoding="UTF-8", standalone=True)


def _insert_reference(paragraph: Paragraph, footnote_id: int) -> None:
    """Вставляет w:footnoteReference run в конец параграфа.

    Циферка-маркер оформляется символьным стилем FootnoteReference (как в
    эталоне) — он и даёт надстрочность; inline-vertAlign не используется.
    """
    run = paragraph.add_run()
    r_pr = run._r.get_or_add_rPr()
    rstyle = OxmlElement("w:rStyle")
    rstyle.set(qn("w:val"), "FootnoteReference")
    r_pr.append(rstyle)
    ref = OxmlElement("w:footnoteReference")
    ref.set(qn("w:id"), str(footnote_id))
    run._r.append(ref)
