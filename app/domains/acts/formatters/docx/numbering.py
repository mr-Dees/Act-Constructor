"""Регистрация multilevel-рубрикатора через oxml.

Один abstractNum + один num на весь документ. Без lvlOverride.
Используется и плашками-таблицами, и параграфами после них.
Подробности: docs/superpowers/specs/numbering-pattern.md
"""
from docx.document import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

_MARKER_ATTR = "actsDocxRubricator"  # маркер для идемпотентности


def ensure_rubricator(doc: Document) -> int:
    """Регистрирует рубрикатор (или возвращает существующий num_id).

    Идемпотентно. Безопасно вызывать многократно.
    """
    numbering_part = doc.part.numbering_part
    root = numbering_part.element

    # Идемпотентность через маркер.
    for existing_num in root.findall(qn("w:num")):
        if existing_num.get(_MARKER_ATTR) == "1":
            return int(existing_num.get(qn("w:numId")))

    abstract_id = _next_id(root, qn("w:abstractNum"), qn("w:abstractNumId"))
    num_id = _next_id(root, qn("w:num"), qn("w:numId"))

    abstract = _build_abstract_num(abstract_id)
    num = _build_num(num_id, abstract_id)
    num.set(_MARKER_ATTR, "1")

    # abstractNum строго ПЕРЕД num (иначе Word считает файл повреждённым).
    # Вставляем наш abstractNum после последнего существующего abstractNum.
    last_abstract = root.findall(qn("w:abstractNum"))
    if last_abstract:
        last_abstract[-1].addnext(abstract)
    else:
        root.insert(0, abstract)

    # num вставляем перед первым существующим num, чтобы соблюдать
    # порядок: все abstractNum идут до всех num.
    first_num = root.find(qn("w:num"))
    if first_num is not None:
        first_num.addprevious(num)
    else:
        root.append(num)

    return num_id


def apply_numbering(paragraph, num_id: int, ilvl: int) -> None:
    """Привязывает параграф к рубрикатору на нужном уровне.

    Безопасно для параграфов внутри ячеек таблиц — Word сохраняет
    сквозную нумерацию вне зависимости от tbl-границ.
    """
    p_pr = paragraph._p.get_or_add_pPr()
    # Снести предыдущий numPr если был, чтобы не плодить дубли.
    for old in p_pr.findall(qn("w:numPr")):
        p_pr.remove(old)
    num_pr = OxmlElement("w:numPr")
    ilvl_el = OxmlElement("w:ilvl")
    ilvl_el.set(qn("w:val"), str(ilvl))
    num_id_el = OxmlElement("w:numId")
    num_id_el.set(qn("w:val"), str(num_id))
    num_pr.append(ilvl_el)
    num_pr.append(num_id_el)
    p_pr.append(num_pr)


# ---------------------------------------------------------------------------
# Внутренние хелперы
# ---------------------------------------------------------------------------

def _next_id(root, tag: str, id_attr: str) -> int:
    existing = [int(el.get(id_attr)) for el in root.findall(tag) if el.get(id_attr)]
    return (max(existing) + 1) if existing else 1


def _build_abstract_num(abstract_id: int) -> OxmlElement:
    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), str(abstract_id))

    mlt = OxmlElement("w:multiLevelType")
    mlt.set(qn("w:val"), "multilevel")
    abstract.append(mlt)

    for ilvl in range(9):
        abstract.append(_build_level(ilvl))

    return abstract


def _build_level(ilvl: int) -> OxmlElement:
    lvl = OxmlElement("w:lvl")
    lvl.set(qn("w:ilvl"), str(ilvl))

    start = OxmlElement("w:start")
    start.set(qn("w:val"), "1")
    lvl.append(start)

    fmt = OxmlElement("w:numFmt")
    fmt.set(qn("w:val"), "decimal")
    lvl.append(fmt)

    # Порядок дочерних w:lvl по схеме: start, numFmt, [suff], lvlText, lvlJc, pPr.
    if ilvl >= 1:
        # Текст идёт сразу после номера (через пробел), а не по табстопу.
        suff = OxmlElement("w:suff")
        suff.set(qn("w:val"), "space")
        lvl.append(suff)

    lvl_text = OxmlElement("w:lvlText")
    lvl_text.set(qn("w:val"), ".".join(f"%{i + 1}" for i in range(ilvl + 1)) + ".")
    lvl.append(lvl_text)

    # ilvl=0 — номер рубрикатора в узкой ячейке плашки, прижат вправо (к заголовку).
    # ilvl>=1 — номера пунктов прижаты к ЛЕВОМУ краю и нарастают вправо: «5.»
    # стоит у поля, «5.1.1.» — длиннее, но левый край номера всегда на поле.
    lvl_jc = OxmlElement("w:lvlJc")
    lvl_jc.set(qn("w:val"), "right" if ilvl == 0 else "left")
    lvl.append(lvl_jc)

    p_pr = OxmlElement("w:pPr")
    ind = OxmlElement("w:ind")
    # Все уровни прижаты к левому краю (left=0, firstLine=0): за левое поле
    # ничего не выходит, абзац не сдвигается вправо при углублении.
    ind.set(qn("w:left"), "0")
    ind.set(qn("w:firstLine"), "0")
    p_pr.append(ind)
    lvl.append(p_pr)

    return lvl


def _build_num(num_id: int, abstract_id: int) -> OxmlElement:
    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(num_id))

    ref = OxmlElement("w:abstractNumId")
    ref.set(qn("w:val"), str(abstract_id))
    num.append(ref)

    return num
