"""Подпись руководителя аудиторской проверки в конце документа.

Формат: «Руководитель аудиторской проверки[TAB]ФИО»
где TAB разнесён правым tab-stop'ом на 17 см от левого поля.
ФИО берётся из audit_team, role="Руководитель"; если такого нет — заглушка.
"""
from docx.document import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.shared import Cm, Pt

from app.domains.acts.formatters.docx.styles import Fonts, Sizes

_LEADER_FALLBACK = "_______________"


def build_signature(doc: Document, metadata) -> None:
    """Добавляет блок подписи в конец документа."""
    doc.add_paragraph()  # воздух

    leader_fio = _resolve_leader_fio(metadata)

    para = doc.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.LEFT
    para.paragraph_format.tab_stops.add_tab_stop(Cm(17), WD_TAB_ALIGNMENT.RIGHT)

    label_run = para.add_run("Руководитель аудиторской проверки\t")
    label_run.font.name = Fonts.main
    label_run.font.size = Pt(Sizes.body_pt)

    fio_run = para.add_run(leader_fio)
    fio_run.font.name = Fonts.main
    fio_run.font.size = Pt(Sizes.body_pt)


def _resolve_leader_fio(metadata) -> str:
    team = getattr(metadata, "audit_team", None) or []
    for member in team:
        if getattr(member, "role", None) == "Руководитель":
            return _short_fio(member.full_name)
    return _LEADER_FALLBACK


def _short_fio(full_name: str) -> str:
    """Преобразует «Фамилия Имя Отчество» в «Фамилия И.О.».

    2 слова → «Фамилия И.», 1 слово → возвращается как есть.
    Инициалы — без пробелов между ними.
    """
    parts = full_name.split()
    if len(parts) <= 1:
        return full_name
    surname = parts[0]
    initials = "".join(f"{word[0]}." for word in parts[1:])
    return f"{surname} {initials}"
