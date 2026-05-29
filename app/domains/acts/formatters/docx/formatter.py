"""DocxFormatter — фасад над builders'ами.

Принимает ExportContext, возвращает python-docx Document.
"""
from docx import Document as new_document
from docx.document import Document
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
from app.domains.acts.formatters.docx.styles import Fonts, Sizes, apply_document_defaults


class DocxFormatter:
    """Stateless форматер. settings/acts_settings приняты для совместимости
    с ExportService.__init__ — реально не используются."""

    def __init__(self, settings=None, acts_settings=None):
        self._settings = settings
        self._acts_settings = acts_settings

    def format(self, ctx: ExportContext) -> Document:  # type: ignore[name-defined]
        doc = new_document()
        apply_document_defaults(doc)
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
            build_rubricator_plate(doc, num_id, section.get("label", ""))
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
            elif node_type == "textblock" and node.get("textBlockId"):
                schema = ctx.content.textBlocks.get(node["textBlockId"])
                if schema:
                    # Текстблок: без заголовка и без нумерации — только содержимое.
                    para = doc.add_paragraph()
                    apply_inline_html(para, schema.content, base_size_pt=Sizes.body_pt)
            elif node_type == "violation" and node.get("violationId"):
                schema = ctx.content.violations.get(node["violationId"])
                if schema:
                    # Нарушение: без заголовка и без нумерации (см. build_violation).
                    build_violation(doc, schema)

    def _render_item(self, doc, node, *, num_id, ilvl) -> None:
        para = doc.add_paragraph()
        apply_numbering(para, num_id, ilvl=ilvl)
        label = node.get("customLabel") or node.get("label", "")
        run = para.add_run(label)
        run.font.name = Fonts.main
        run.font.size = Pt(Sizes.body_pt)

        if node.get("content"):
            body_para = doc.add_paragraph()
            apply_inline_html(body_para, node["content"], base_size_pt=Sizes.body_pt)

    def _add_table_title(self, doc, node) -> None:
        """Заголовок таблицы: жирная подпись без нумерации (таблица — не пункт)."""
        title = node.get("customLabel") or node.get("label", "")
        if not title:
            return
        para = doc.add_paragraph()
        run = para.add_run(title)
        run.font.name = Fonts.main
        run.font.size = Pt(Sizes.body_pt)
        run.bold = True


def _enable_update_fields(doc) -> None:
    """Помечает поля документа на пересчёт при открытии (w:updateFields).

    Без этого Word не пересчитывает NUMPAGES/PAGE и показывает кэш (часто «1»).
    """
    settings = doc.settings.element
    if settings.find(qn("w:updateFields")) is not None:
        return
    el = OxmlElement("w:updateFields")
    el.set(qn("w:val"), "true")
    settings.insert(0, el)
