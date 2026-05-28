"""Builder нарушений: «Проблема. ПNNNN.» + Нарушено/Установлено/Причины/...

Регрессия: рендеринг `recommendations` (раньше пропускалось).
"""
from docx.document import Document
from docx.shared import Pt

from app.domains.acts.formatters.docx.numbering import apply_numbering
from app.domains.acts.formatters.docx.styles import Fonts, Sizes
from app.domains.acts.schemas.act_content import ViolationSchema


def build_violation(
    doc: Document,
    violation: ViolationSchema,
    *,
    num_id: int,
    ilvl: int,
    problem_number: str,
) -> None:
    """Рендерит нарушение в документ.

    problem_number — например «П00001», берётся из violation.nodeId-маппинга
    либо генерируется снаружи (decoupling builder от counter'а).
    """
    header = doc.add_paragraph()
    apply_numbering(header, num_id, ilvl=ilvl)
    header_run = header.add_run(f"Проблема. {problem_number}.")
    header_run.font.name = Fonts.main
    header_run.font.size = Pt(Sizes.body_pt)
    header_run.bold = True

    _labeled_paragraph(doc, "Нарушено:", violation.violated)
    _labeled_paragraph(doc, "Установлено:", violation.established)

    if violation.descriptionList.enabled:
        for item in violation.descriptionList.items:
            bullet = doc.add_paragraph(style="List Bullet")
            run = bullet.add_run(item)
            run.font.name = Fonts.main
            run.font.size = Pt(Sizes.body_pt)

    # additionalContent (case / image / freeText) — пока только text-варианты.
    if violation.additionalContent.enabled:
        for item in violation.additionalContent.items:
            if item.type in ("case", "freeText"):
                _labeled_paragraph(
                    doc,
                    "Кейс:" if item.type == "case" else "",
                    item.content,
                    italic=(item.type == "case"),
                )

    for label, field in [
        ("Причины:", violation.reasons),
        ("Последствия:", violation.consequences),
        ("Ответственный:", violation.responsible),
        ("Рекомендации:", violation.recommendations),
    ]:
        if field.enabled and field.content:
            _labeled_paragraph(doc, label, field.content)


def _labeled_paragraph(
    doc: Document,
    label: str,
    body: str,
    *,
    italic: bool = False,
) -> None:
    """Параграф «Label_underlined body_plain»."""
    if not body and not label:
        return
    para = doc.add_paragraph()
    if label:
        label_run = para.add_run(label + " ")
        label_run.font.name = Fonts.main
        label_run.font.size = Pt(Sizes.body_pt)
        label_run.underline = True
        if italic:
            label_run.italic = True
    body_run = para.add_run(body)
    body_run.font.name = Fonts.main
    body_run.font.size = Pt(Sizes.body_pt)
    if italic and not label:
        body_run.italic = True
