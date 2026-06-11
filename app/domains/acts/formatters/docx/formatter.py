"""DocxFormatter — фасад над builders'ами.

Принимает ExportContext, возвращает python-docx Document.
"""
from docx import Document as new_document
from docx.document import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt

from app.domains.acts.block_types import NODE_TYPE_TABLE
from app.domains.acts.formatters.docx.builders.cover import build_cover_block
from app.domains.acts.formatters.docx.builders.header_footer import apply_header_footer
from app.domains.acts.formatters.docx.builders.inline import apply_inline_html
from app.domains.acts.formatters.docx.builders.rubricator import build_rubricator_plate
from app.domains.acts.formatters.docx.builders.signature import build_signature
from app.domains.acts.formatters.docx.builders.tables import build_table
from app.domains.acts.formatters.docx.builders.violation import build_violation
from app.domains.acts.formatters.docx.context import ExportContext
from app.domains.acts.formatters.docx.numbering import apply_numbering, ensure_rubricator
from app.domains.acts.formatters.tree_walker import WalkContext, collect_blocks, walk
from app.domains.acts.formatters.docx.styles import (
    Fonts,
    Sizes,
    add_blank_line,
    apply_document_defaults,
    ensure_footnote_styles,
)
from app.domains.acts.schemas.act_content import TextBlockFormattingSchema

# Нетронутый юзером formatting (все значения схемных дефолтов) → легаси-рендер
# текстблока: JUSTIFY + body_pt. Любое отличие — formatting задан явно и
# применяется буквально (M.1): поведение существующих актов не меняется.
_DEFAULT_TB_FORMATTING = TextBlockFormattingSchema()

# px → pt: умножение на 0.75 (16px → 12pt), как в builders/inline.py.
_PX_TO_PT = 0.75

_TB_ALIGNMENT_MAP = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}


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
        # Обход дерева — единый walker, представление — в визиторе.
        visitor = _DocxTreeVisitor(self, doc, num_id)
        walk(ctx.content.tree or {}, visitor, collect_blocks(ctx.content))

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
            # content пункта — plain-текст из textarea (M.4): выводится дословно,
            # без HTML-парсинга — литеральные `<`/`&` не искажаются (паритет MD/TXT).
            body_para = doc.add_paragraph()
            body_para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            body_run = body_para.add_run(node["content"])
            body_run.font.name = Fonts.main
            body_run.font.size = Pt(Sizes.body_pt)

    def _render_textblock(self, doc, schema) -> None:
        """Текстблок с учётом базового formatting (M.1).

        Нетронутый formatting (равен схемным дефолтам) → легаси: JUSTIFY +
        body_pt. Заданный юзером — применяется буквально: alignment,
        fontSize (px→pt ×0.75), bold/italic/underline поверх runs.
        Inline-разметка содержимого (теги <b>/<i>/... ) имеет приоритет —
        базовые свойства лишь «включают», но не снимают начертание.
        """
        para = doc.add_paragraph()
        fmt = schema.formatting
        if fmt == _DEFAULT_TB_FORMATTING:
            para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            apply_inline_html(para, schema.content, base_size_pt=Sizes.body_pt)
            return
        para.alignment = _TB_ALIGNMENT_MAP.get(fmt.alignment, WD_ALIGN_PARAGRAPH.JUSTIFY)
        apply_inline_html(para, schema.content, base_size_pt=fmt.fontSize * _PX_TO_PT)
        if fmt.bold or fmt.italic or fmt.underline:
            for run in para.runs:
                if fmt.bold:
                    run.bold = True
                if fmt.italic:
                    run.italic = True
                if fmt.underline:
                    run.underline = True

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


class _DocxTreeVisitor:
    """Визитор tree-walker'а для DOCX: представление узлов дерева.

    Контекст обхода (depth) транслируется в Word-нумерацию: дети корня
    (depth 0) — плашки рубрикатора (уровень 0 multilevel-списка), вложенные
    пункты — ilvl = depth. Рендеринг делегируется builders'ам и методам
    DocxFormatter — сами builders walker'ом не затронуты.
    """

    def __init__(self, formatter: DocxFormatter, doc, num_id: int):
        self._fmt = formatter
        self._doc = doc
        self._num_id = num_id

    def on_item_enter(self, node: dict, ctx: WalkContext) -> None:
        if ctx.depth == 0:
            # Раздел верхнего уровня: плашка рубрикатора с распорками.
            add_blank_line(self._doc)
            build_rubricator_plate(self._doc, self._num_id, node.get("label", ""))
            add_blank_line(self._doc)
            return
        # Пункт: выводятся и название, и нумерация уровня (ilvl = depth).
        self._fmt._render_item(self._doc, node, num_id=self._num_id, ilvl=ctx.depth)

    def on_item_exit(self, node: dict, ctx: WalkContext) -> None:
        pass

    def on_table(self, node: dict, schema, ctx: WalkContext) -> None:
        if schema is None:
            return
        if node.get("type") == NODE_TYPE_TABLE:
            # Узел-таблица: только заголовок, без нумерации (не пункт).
            # Прикреплённой к пункту таблице заголовком служит сам пункт.
            self._fmt._add_table_title(self._doc, node)
        build_table(self._doc, schema)
        # Пустая строка-распорка после любой таблицы.
        add_blank_line(self._doc)

    def on_textblock(self, node: dict, schema, ctx: WalkContext) -> None:
        if schema is not None:
            # Текстблок: без заголовка и без нумерации — только содержимое.
            self._fmt._render_textblock(self._doc, schema)

    def on_violation(self, node: dict, schema, ctx: WalkContext) -> None:
        if schema is not None:
            # Нарушение: без заголовка и без нумерации (см. build_violation).
            build_violation(self._doc, schema)


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
