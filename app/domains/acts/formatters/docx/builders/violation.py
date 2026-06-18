"""Builder нарушений: Нарушено/Установлено/Причины/...

Заголовок и нумерация нарушения не выводятся: шаблон «Проблема. ПNNNN.»
указывается в блоке пункта (item) и подставляется при сборке в formatter.py.

Регрессия: рендеринг `recommendations` (раньше пропускалось).

Дополнительный контент:
- кейсы нумеруются («Кейс 1:», «Кейс 2:»), нумерация сбрасывается после
  не-кейса — та же семантика, что в MD/TXT-форматтерах и превью;
- картинки (data:image-URL) встраиваются inline shape'ом: отдельный абзац
  по центру, подпись курсивом по центру ниже (Б-1.5). Ширина — поле
  `width` (% полезной ширины страницы); 0/не задана — натуральный размер,
  но не шире полезной ширины (Б-1.4). Допустимые форматы — из настроек
  ACTS__IMAGES__ALLOWED_MIME_TYPES (через image_data_url_pattern из act_content,
  тот же источник, что и у валидатора url). Битый/пустой url или формат вне
  whitelist → текстовый плейсхолдер «Изображение: {filename}» (паритет с MD/TXT).
"""
import base64
import binascii
import io
import re
from functools import lru_cache

from docx.document import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, Twips

from app.domains.acts.formatters.docx.styles import Fonts, Margins, Page, Sizes
from app.domains.acts.schemas.act_content import (
    image_data_url_pattern,
    ViolationContentItemSchema,
    ViolationSchema,
)

# Полезная ширина страницы (A4 минус поля) в твипах — потолок ширины картинок.
_USABLE_WIDTH_TWIPS = Page.width_twips - Margins.left - Margins.right


@lru_cache(maxsize=8)
def _data_url_re_for(pattern: str) -> re.Pattern:
    """regex выделения base64-payload для данного whitelist-паттерна."""
    return re.compile("^" + pattern + r"(?P<payload>.+)$", re.IGNORECASE | re.DOTALL)


def _data_url_re() -> re.Pattern:
    """data:image-URL regex с выделением payload по живому whitelist'у настроек.

    Whitelist форматов берётся из ACTS__IMAGES__ALLOWED_MIME_TYPES (через
    image_data_url_pattern) — тот же источник, что и у валидатора схемы, чтобы
    форматы не разъезжались между валидацией и сборкой DOCX.
    """
    return _data_url_re_for(image_data_url_pattern())


def build_violation(doc: Document, violation: ViolationSchema) -> None:
    """Рендерит нарушение в документ (без заголовка и нумерации)."""
    _labeled_paragraph(
        doc, "Нарушено:", violation.violated,
        italic=True, size_pt=Sizes.violation_pt,
    )
    _labeled_paragraph(
        doc, "Установлено:", violation.established,
        italic=True, size_pt=Sizes.violation_pt,
    )

    if violation.descriptionList.enabled:
        for item in violation.descriptionList.items:
            bullet = doc.add_paragraph(style="List Bullet")
            bullet.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            run = bullet.add_run(item)
            run.font.name = Fonts.main
            run.font.size = Pt(Sizes.violation_pt)
            run.italic = True

    # additionalContent (case / image / freeText). Нумерация кейсов сбрасывается
    # после не-кейса — зеркало markdown/text_formatter._add_additional_content.
    if violation.additionalContent.enabled:
        case_number = 1
        for item in violation.additionalContent.items:
            if item.type == "case":
                if item.content:
                    _labeled_paragraph(
                        doc, f"Кейс {case_number}:", item.content,
                        italic=True, size_pt=Sizes.violation_pt,
                    )
                    case_number += 1
            elif item.type == "image":
                _add_image(doc, item)
                case_number = 1
            elif item.type == "freeText":
                _labeled_paragraph(
                    doc, "", item.content,
                    italic=True, size_pt=Sizes.violation_pt,
                )
                case_number = 1

    for label, field in [
        ("Причины:", violation.reasons),
        ("Последствия:", violation.consequences),
        ("Ответственный:", violation.responsible),
        ("Рекомендации:", violation.recommendations),
    ]:
        if field.enabled and field.content:
            _labeled_paragraph(doc, label, field.content)


def _add_image(doc: Document, item: ViolationContentItemSchema) -> None:
    """Картинка: абзац по центру; подпись курсивом по центру ниже (Б-1.5).

    Не удалось встроить (битый base64, пустой url, формат без поддержки
    в python-docx) → текстовый плейсхолдер «Изображение: {filename}».
    Подпись выводится в обоих случаях.
    """
    embedded = False
    data = _decode_data_url(item.url)
    if data is not None:
        para = doc.add_paragraph()
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = para.add_run()
        try:
            shape = run.add_picture(io.BytesIO(data))
        except Exception:
            # Байты не распознаны как картинка (обрезанный файл и т.п.) —
            # убираем пустой абзац и откатываемся к плейсхолдеру. Экспорт не
            # должен падать из-за одной битой картинки.
            para._p.getparent().remove(para._p)
        else:
            _scale_picture(shape, item.width)
            embedded = True

    if not embedded:
        _labeled_paragraph(
            doc, "", f"Изображение: {item.filename}",
            italic=True, size_pt=Sizes.violation_pt,
        )

    if item.caption:
        cap_para = doc.add_paragraph()
        cap_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cap_run = cap_para.add_run(item.caption)
        cap_run.font.name = Fonts.main
        cap_run.font.size = Pt(Sizes.violation_pt)
        cap_run.italic = True


def _decode_data_url(url: str) -> bytes | None:
    """Достаёт байты картинки из data:image-URL; None — если url не пригоден."""
    if not url:
        return None
    match = _data_url_re().match(url)
    if not match:
        return None
    try:
        return base64.b64decode(match.group("payload"), validate=True)
    except (binascii.Error, ValueError):
        return None


def _scale_picture(shape, width_percent: int) -> None:
    """Подгоняет размер inline shape с сохранением пропорций (Б-1.4).

    width_percent > 0 — процент полезной ширины страницы; 0 — натуральный
    размер с потолком по полезной ширине.

    Картинка нулевой ширины (битый/вырожденный shape, который python-docx всё
    же встроил) не масштабируется — иначе деление на ноль уронило бы весь
    экспорт DOCX. Оставляем натуральный размер и продолжаем сборку.
    """
    if not int(shape.width):
        return
    usable_emu = int(Twips(_USABLE_WIDTH_TWIPS))
    if width_percent:
        target = usable_emu * width_percent // 100
    elif int(shape.width) > usable_emu:
        target = usable_emu
    else:
        return
    shape.height = round(int(shape.height) * target / int(shape.width))
    shape.width = target


def _labeled_paragraph(
    doc: Document,
    label: str,
    body: str,
    *,
    italic: bool = False,
    size_pt: int = Sizes.body_pt,
) -> None:
    """Параграф «Label_underlined body_plain».

    italic ставится и на метку, и на тело; size_pt задаёт размер обоих run'ов.
    """
    if not body and not label:
        return
    para = doc.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    if label:
        label_run = para.add_run(label + " ")
        label_run.font.name = Fonts.main
        label_run.font.size = Pt(size_pt)
        label_run.underline = True
        if italic:
            label_run.italic = True
    body_run = para.add_run(body)
    body_run.font.name = Fonts.main
    body_run.font.size = Pt(size_pt)
    if italic:
        body_run.italic = True
