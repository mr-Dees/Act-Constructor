"""Тесты builder'а нарушений."""
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Emu, Twips

from app.domains.acts.formatters.docx.builders.violation import (
    _USABLE_WIDTH_TWIPS,
    _scale_picture,
    build_violation,
)
from app.domains.acts.schemas.act_content import (
    ViolationAdditionalContentSchema,
    ViolationContentItemSchema,
    ViolationOptionalFieldSchema,
    ViolationSchema,
)

# Валидный PNG 1×1 (прозрачный пиксель) для проверки встраивания.
_PNG_1PX_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
    "AAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
_PNG_1PX_DATA_URL = f"data:image/png;base64,{_PNG_1PX_B64}"


def _v(**overrides):
    base = dict(
        id="v1", nodeId="5.1", violated="Текст нарушения",
        established="Текст установлено",
        reasons=ViolationOptionalFieldSchema(enabled=True, content="Причина-X"),
        consequences=ViolationOptionalFieldSchema(enabled=True, content="Последствие-Y"),
        responsible=ViolationOptionalFieldSchema(enabled=True, content="Иванов И.И."),
        recommendations=ViolationOptionalFieldSchema(
            enabled=True, content="Рекомендация-Z",
        ),
    )
    base.update(overrides)
    return ViolationSchema(**base)


def test_violation_renders_recommendations(doc):
    """Регрессия: recommendations раньше не рендерились."""
    build_violation(doc, _v())
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Рекомендация-Z" in text
    assert "Рекомендации" in text


def test_violation_renders_required_fields(doc):
    """Поля «Нарушено:»/«Установлено:» присутствуют."""
    build_violation(doc, _v())
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Нарушено:" in text
    assert "Текст нарушения" in text
    assert "Установлено:" in text
    assert "Текст установлено" in text


def test_violation_has_no_header_paragraph(doc):
    """Нет абзаца, начинающегося со слова «Проблема»."""
    build_violation(doc, _v())
    assert not any(p.text.strip().startswith("Проблема") for p in doc.paragraphs)


def test_violation_has_no_numbering(doc):
    """Ни в одном абзаце нарушения нет numPr."""
    build_violation(doc, _v())
    for p in doc.paragraphs:
        p_pr = p._p.find(qn("w:pPr"))
        if p_pr is None:
            continue
        assert p_pr.find(qn("w:numPr")) is None


def test_disabled_optional_fields_not_rendered(doc):
    violation = _v(
        reasons=ViolationOptionalFieldSchema(enabled=False, content="скрытая"),
    )
    build_violation(doc, violation)
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "скрытая" not in text


def test_labels_are_underlined(doc):
    build_violation(doc, _v())
    label_runs = [
        r for p in doc.paragraphs for r in p.runs
        if r.text.strip() in {"Причины:", "Последствия:", "Ответственный:", "Рекомендации:"}
    ]
    assert len(label_runs) == 4
    assert all(r.underline for r in label_runs)


# --- Картинки дополнительного контента (M.2 / H4) ---

def _img_item(**overrides):
    base = dict(
        id="img1", type="image", url=_PNG_1PX_DATA_URL,
        caption="", filename="screen.png", order=0,
    )
    base.update(overrides)
    return ViolationContentItemSchema(**base)


def _v_with_items(*items):
    return _v(additionalContent=ViolationAdditionalContentSchema(
        enabled=True, items=list(items),
    ))


def test_image_embedded_as_inline_shape(doc):
    """PNG 1×1 из data-URL встраивается в документ как inline shape."""
    build_violation(doc, _v_with_items(_img_item()))
    assert len(doc.inline_shapes) == 1


def test_image_paragraph_centered(doc):
    """Абзац с картинкой выровнен по центру (Б-1.5)."""
    build_violation(doc, _v_with_items(_img_item()))
    pic_para = next(
        p for p in doc.paragraphs if p._p.findall(".//" + qn("w:drawing"))
    )
    assert pic_para.alignment == WD_ALIGN_PARAGRAPH.CENTER


def test_image_caption_italic_centered_below(doc):
    """Подпись — отдельный абзац под картинкой: курсив, по центру."""
    build_violation(doc, _v_with_items(_img_item(caption="Скриншот экрана")))
    cap_para = next(p for p in doc.paragraphs if "Скриншот экрана" in p.text)
    assert cap_para.alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert all(r.italic for r in cap_para.runs if r.text.strip())


def test_broken_base64_renders_placeholder(doc):
    """Битый base64 → текстовый плейсхолдер «Изображение: …», без исключения."""
    build_violation(doc, _v_with_items(
        _img_item(url="data:image/png;base64,@@не-base64@@"),
    ))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Изображение: screen.png" in text
    assert len(doc.inline_shapes) == 0


def test_empty_url_renders_placeholder(doc):
    """Пустой url (черновик без содержимого) → плейсхолдер (паритет с MD/TXT)."""
    violation = _v_with_items(
        ViolationContentItemSchema(
            id="img1", type="image", url="", caption="", filename="ext.png",
        ),
    )
    build_violation(doc, violation)
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Изображение: ext.png" in text
    assert len(doc.inline_shapes) == 0


def test_undecodable_image_bytes_render_placeholder(doc):
    """Валидный base64, но не картинка → плейсхолдер, без исключения."""
    build_violation(doc, _v_with_items(_img_item(url="data:image/png;base64,AAAA")))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Изображение: screen.png" in text
    assert len(doc.inline_shapes) == 0


def test_image_width_50_percent_is_half_usable_width(doc):
    """width=50 → ширина shape ≈ 5173 твип (половина полезной ширины)."""
    build_violation(doc, _v_with_items(_img_item(width=50)))
    shape = doc.inline_shapes[0]
    expected = Twips(_USABLE_WIDTH_TWIPS * 50 // 100)
    assert abs(int(shape.width) - int(expected)) <= int(Twips(1))
    assert _USABLE_WIDTH_TWIPS == 10346  # Page 11906 − left 851 − right 709


def test_scale_picture_caps_natural_size_at_usable_width():
    """Без width картинка шире полезной ширины ужимается с сохранением пропорций."""
    class _FakeShape:
        width = Emu(int(Twips(_USABLE_WIDTH_TWIPS)) * 2)
        height = Emu(1_000_000)

    shape = _FakeShape()
    _scale_picture(shape, 0)
    assert int(shape.width) == int(Twips(_USABLE_WIDTH_TWIPS))
    assert int(shape.height) == 500_000


def test_scale_picture_keeps_natural_size_when_fits():
    """Без width картинка уже полезной ширины остаётся в натуральном размере."""
    class _FakeShape:
        width = Emu(100_000)
        height = Emu(50_000)

    shape = _FakeShape()
    _scale_picture(shape, 0)
    assert int(shape.width) == 100_000
    assert int(shape.height) == 50_000


# --- Нумерация кейсов (паритет с MD/TXT и фронтом) ---

def _case(content, **overrides):
    base = dict(id=f"c_{content}", type="case", content=content)
    base.update(overrides)
    return ViolationContentItemSchema(**base)


def test_cases_are_numbered_sequentially(doc):
    """Подряд идущие кейсы нумеруются: «Кейс 1:», «Кейс 2:»."""
    build_violation(doc, _v_with_items(_case("Первый"), _case("Второй")))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Кейс 1:" in text
    assert "Кейс 2:" in text


def test_case_numbering_resets_after_non_case_item(doc):
    """Не-кейс (image/freeText) сбрасывает нумерацию — как в MD/TXT и превью."""
    build_violation(doc, _v_with_items(
        _case("До картинки"),
        _img_item(),
        _case("После картинки"),
    ))
    labels = [
        r.text for p in doc.paragraphs for r in p.runs
        if r.text.strip().startswith("Кейс")
    ]
    assert labels == ["Кейс 1: ", "Кейс 1: "]


def test_empty_case_not_rendered_and_not_numbered(doc):
    """Пустой кейс пропускается и не двигает нумерацию (как в MD/TXT)."""
    build_violation(doc, _v_with_items(_case(""), _case("Единственный")))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Кейс 1: Единственный" in text
    assert "Кейс 2:" not in text
