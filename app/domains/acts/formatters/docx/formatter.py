"""DocxFormatter — фасад над builders'ами.

Принимает ExportContext, возвращает python-docx Document.
"""
from docx import Document as new_document
from docx.document import Document
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
from app.domains.acts.formatters.docx.styles import Fonts, Sizes


class DocxFormatter:
    """Stateless форматер. settings/acts_settings приняты для совместимости
    с ExportService.__init__ — реально не используются."""

    def __init__(self, settings=None, acts_settings=None):
        self._settings = settings
        self._acts_settings = acts_settings

    def format(self, ctx: ExportContext) -> Document:  # type: ignore[name-defined]
        doc = new_document()
        apply_header_footer(doc, ctx.metadata)
        build_cover_block(doc, ctx.metadata)
        num_id = ensure_rubricator(doc)
        self._render_tree(doc, ctx, num_id)
        build_signature(doc, ctx.metadata)
        return doc

    def _render_tree(self, doc, ctx: ExportContext, num_id: int) -> None:
        sections = (ctx.content.tree or {}).get("children", [])
        problem_counter = 0
        for section in sections:
            build_rubricator_plate(doc, num_id, section.get("label", ""))
            problem_counter = self._render_children(
                doc, section.get("children", []),
                ctx=ctx, num_id=num_id, ilvl=1,
                problem_counter=problem_counter,
            )

    def _render_children(self, doc, nodes, *, ctx, num_id, ilvl, problem_counter) -> int:
        for node in nodes:
            node_type = node.get("type", "item")
            if node_type == "item":
                self._render_item(doc, node, num_id=num_id, ilvl=ilvl)
                problem_counter = self._render_children(
                    doc, node.get("children", []),
                    ctx=ctx, num_id=num_id, ilvl=ilvl + 1,
                    problem_counter=problem_counter,
                )
            elif node_type == "table" and node.get("tableId"):
                schema = ctx.content.tables.get(node["tableId"])
                if schema:
                    self._add_item_title(doc, node, num_id=num_id, ilvl=ilvl)
                    build_table(doc, schema)
            elif node_type == "textblock" and node.get("textBlockId"):
                schema = ctx.content.textBlocks.get(node["textBlockId"])
                if schema:
                    self._add_item_title(doc, node, num_id=num_id, ilvl=ilvl)
                    para = doc.add_paragraph()
                    apply_inline_html(para, schema.content, base_size_pt=Sizes.body_pt)
            elif node_type == "violation" and node.get("violationId"):
                schema = ctx.content.violations.get(node["violationId"])
                if schema:
                    problem_counter += 1
                    build_violation(
                        doc, schema, num_id=num_id, ilvl=ilvl,
                        problem_number=f"П{problem_counter:05d}",
                    )
        return problem_counter

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

    def _add_item_title(self, doc, node, *, num_id, ilvl) -> None:
        para = doc.add_paragraph()
        apply_numbering(para, num_id, ilvl=ilvl)
        title = node.get("customLabel") or node.get("label", "")
        if title:
            run = para.add_run(title)
            run.font.name = Fonts.main
            run.font.size = Pt(Sizes.body_pt)
            run.bold = True
