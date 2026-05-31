"""DocxFormatter — фасад над builders'ами.

Принимает ExportContext, возвращает python-docx Document.
"""
from docx import Document as new_document
from docx.document import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt

from app.domains.acts.formatters.docx.builders.cover import build_cover_block
from app.domains.acts.formatters.docx.builders.header_footer import apply_header_footer
from app.domains.acts.formatters.docx.builders.inline import apply_inline_html
from app.domains.acts.formatters.docx.builders.rubricator import build_rubricator_plate
from app.domains.acts.formatters.docx.builders.signature import build_signature
from app.domains.acts.formatters.docx.builders.tables import build_table
from app.domains.acts.formatters.docx.builders.violation import build_violation
from app.domains.acts.formatters.docx.context import ExportContext
from app.domains.acts.formatters.docx.numbering import apply_numbering, ensure_rubricator
from app.domains.acts.formatters.docx.styles import (
    Fonts,
    Sizes,
    add_blank_line,
    apply_document_defaults,
    ensure_footnote_styles,
)


class DocxFormatter:
    """Stateless форматер. settings/acts_settings приняты для совместимости
    с ExportService.__init__ — реально не используются."""

    def __init__(self, settings=None, acts_settings=None):
        self._settings = settings
        self._acts_settings = acts_settings

    def format(self, ctx: ExportContext) -> Document:  # type: ignore[name-defined]
        doc = new_document()
        apply_document_defaults(doc)
        ensure_footnote_styles(doc)
        apply_header_footer(doc, ctx.metadata)
        build_cover_block(doc, ctx.metadata)
        num_id = ensure_rubricator(doc)
        self._render_tree(doc, ctx, num_id)
        build_signature(doc, ctx.metadata)
        _enable_update_fields(doc)
        return doc

    def _render_tree(self, doc, ctx: ExportContext, num_id: int) -> None:
        sections = (ctx.content.tree or {}).get("children", [])
        for section in sections:
            # Пустая строка-распорка до и после плашки рубрикатора.
            add_blank_line(doc)
            build_rubricator_plate(doc, num_id, section.get("label", ""))
            add_blank_line(doc)
            self._render_children(
                doc, section.get("children", []),
                ctx=ctx, num_id=num_id, ilvl=1,
            )

    def _render_children(self, doc, nodes, *, ctx, num_id, ilvl) -> None:
        for node in nodes:
            node_type = node.get("type", "item")
            if node_type == "item":
                # Пункты: выводятся и название, и нумерация уровня.
                self._render_item(doc, node, num_id=num_id, ilvl=ilvl)
                self._render_children(
                    doc, node.get("children", []),
                    ctx=ctx, num_id=num_id, ilvl=ilvl + 1,
                )
            elif node_type == "table" and node.get("tableId"):
                schema = ctx.content.tables.get(node["tableId"])
                if schema:
                    # Таблица: только заголовок, без нумерации (не пункт).
                    self._add_table_title(doc, node)
                    build_table(doc, schema)
                    # Пустая строка-распорка после любой таблицы.
                    add_blank_line(doc)
            elif node_type == "textblock" and node.get("textBlockId"):
                schema = ctx.content.textBlocks.get(node["textBlockId"])
                if schema:
                    # Текстблок: без заголовка и без нумерации — только содержимое.
                    para = doc.add_paragraph()
                    para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
                    apply_inline_html(para, schema.content, base_size_pt=Sizes.body_pt)
            elif node_type == "violation" and node.get("violationId"):
                schema = ctx.content.violations.get(node["violationId"])
                if schema:
                    # Нарушение: без заголовка и без нумерации (см. build_violation).
                    build_violation(doc, schema)

    def _render_item(self, doc, node, *, num_id, ilvl) -> None:
        para = doc.add_paragraph()
        para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        apply_numbering(para, num_id, ilvl=ilvl)
        label = node.get("customLabel") or node.get("label", "")
        run = para.add_run(label)
        run.font.name = Fonts.main
        run.font.size = Pt(Sizes.body_pt)
        # Пункт — жирный заголовок (как рубрикатор): текст и авто-номер.
        run.bold = True
        _set_mark_bold(para)

        if node.get("content"):
            body_para = doc.add_paragraph()
            body_para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            apply_inline_html(body_para, node["content"], base_size_pt=Sizes.body_pt)

    def _add_table_title(self, doc, node) -> None:
        """Заголовок таблицы: жирная подпись без нумерации (таблица — не пункт)."""
        title = node.get("customLabel") or node.get("label", "")
        if not title:
            return
        para = doc.add_paragraph()
        para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        # Заголовок не отрывается от своей таблицы и не делится между страницами
        # (контроль переносов — п.4: keepNext связывает заголовок с таблицей).
        para.paragraph_format.keep_with_next = True
        para.paragraph_format.keep_together = True
        run = para.add_run(title)
        run.font.name = Fonts.main
        run.font.size = Pt(Sizes.body_pt)
        run.bold = True


def _set_mark_bold(paragraph) -> None:
    """Делает метку абзаца жирной — чтобы авто-номер пункта тоже был жирным.

    Номер списка наследует начертание от метки абзаца (pPr/rPr), а не от run'а
    с текстом, поэтому жирность номера задаётся именно здесь.
    """
    p_pr = paragraph._p.get_or_add_pPr()
    r_pr = p_pr.find(qn("w:rPr"))
    if r_pr is None:
        r_pr = OxmlElement("w:rPr")
        p_pr.append(r_pr)
    if r_pr.find(qn("w:b")) is None:
        r_pr.append(OxmlElement("w:b"))


# Элементы CT_Settings, которые по схеме OOXML идут ПОСЛЕ w:updateFields.
# updateFields обязан стоять перед первым из них, иначе Word считает
# settings.xml некорректным и игнорирует флаг (NUMPAGES «застревает» на 1).
_SETTINGS_AFTER_UPDATE_FIELDS = frozenset({
    "hdrShapeDefaults", "footnotePr", "endnotePr", "compat", "rsids", "mathPr",
    "themeFontLang", "clrSchemeMapping", "doNotAutoCompressPictures", "shapeDefaults",
    "decimalSymbol", "listSeparator", "docId", "defaultImageDpi", "chartTrackingRefBased",
})


def _enable_update_fields(doc) -> None:
    """Помечает поля документа на пересчёт при открытии (w:updateFields).

    Вставляет флаг в схемо-корректную позицию (перед compat/rsids/mathPr/...),
    иначе Word игнорирует его и не пересчитывает NUMPAGES/PAGE — кэш «1».
    """
    settings = doc.settings.element
    if settings.find(qn("w:updateFields")) is not None:
        return
    el = OxmlElement("w:updateFields")
    el.set(qn("w:val"), "true")
    anchor = None
    for child in settings:
        if child.tag.rsplit("}", 1)[-1] in _SETTINGS_AFTER_UPDATE_FIELDS:
            anchor = child
            break
    if anchor is not None:
        anchor.addprevious(el)
    else:
        settings.append(el)
