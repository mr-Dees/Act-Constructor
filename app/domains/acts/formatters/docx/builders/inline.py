"""Inline HTML → docx runs.

Поддерживает <b>, <strong>, <i>, <em>, <u>, <s>/<strike>/<del>,
<span style="font-size: ...">, <span style="text-decoration: line-through">,
<br>, <a href="...">. Блочные теги (<div>/<p>/<li>/<h1>..<h6>) рендерятся как
мягкий перенос строки между блоками (контейнерная разметка contenteditable из
обычного Enter). Любой другой тег игнорируется (содержимое сохраняется).

Зачёркивание (M.19): Chromium execCommand('strikeThrough') эмитит <strike>
(тег-форма, styleWithCSS в приложении не включается); CSS-форма
text-decoration(-line): line-through поддержана для вставленного извне
контента, прошедшего bleach (text-decoration в ALLOWED_CSS_PROPERTIES).

Спец-разметка редактора текстблоков:
    <span class="text-footnote" data-footnote-text="...">якорь</span>
        → видимый текст + нативная сноска Word после него.
    <span class="text-link" data-link-url="https://...">текст</span>
        → гиперссылка (как <a href>).

Размеры font-size:
    px → pt: умножение на 0.75 (16px → 12pt)
    pt    : без изменений
"""
import re
from html.parser import HTMLParser
from dataclasses import dataclass, replace

from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.shared import Pt
from docx.text.paragraph import Paragraph
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE

from app.domains.acts.formatters.docx.footnotes import add_footnote
from app.domains.acts.formatters.docx.styles import Fonts


# Схемы, допустимые во ВНЕШНИХ гиперссылках DOCX. Зеркало фронтового
# validateLinkUrl (textblock-links-footnotes.js): веб, почта, телефон, ftp и
# локальные файлы. Якоря '#...' обрабатываются как ВНУТРЕННИЕ ссылки (w:anchor)
# в _open_hyperlink. javascript:/data:/vbscript: сюда не попадают → текст plain.
_SAFE_LINK_PREFIXES = ("http://", "https://", "mailto:", "tel:", "ftp://", "file:")


def _is_safe_url(href: str) -> bool:
    return href.strip().lower().startswith(_SAFE_LINK_PREFIXES)


@dataclass(frozen=True)
class _RunState:
    bold: bool = False
    italic: bool = False
    underline: bool = False
    strike: bool = False
    size_pt: float = 12.0


_PX_TO_PT = 0.75
# Блочные теги: их граница = перенос строки (Enter в contenteditable → <div>).
_BLOCK_TAGS = frozenset({"div", "p", "li", "h1", "h2", "h3", "h4", "h5", "h6"})
_SIZE_RE = re.compile(r"font-size\s*:\s*(\d+(?:\.\d+)?)\s*(px|pt)", re.IGNORECASE)
# Зачёркивание CSS-формой: и text-decoration, и text-decoration-line.
_STRIKE_RE = re.compile(r"text-decoration(?:-line)?\s*:\s*[^;]*line-through", re.IGNORECASE)


def apply_inline_html(paragraph: Paragraph, html: str, base_size_pt: float) -> None:
    """Парсит html-фрагмент и добавляет runs в paragraph."""
    if not html:
        return
    parser = _InlineParser(paragraph, base_size_pt)
    parser.feed(html)


class _InlineParser(HTMLParser):
    def __init__(self, paragraph: Paragraph, base_size_pt: float):
        super().__init__(convert_charrefs=True)
        self.paragraph = paragraph
        self.stack: list[_RunState] = [_RunState(size_pt=base_size_pt)]
        self._hyperlink: OxmlElement | None = None
        # Параллельно стеку span'ов: что делать при их закрытии.
        # ("footnote", текст) | ("link", None) | ("plain", None)
        self._span_kinds: list[tuple[str, str | None]] = []
        # Был ли уже выведен видимый контент (run/перенос) — чтобы не ставить
        # перенос ПЕРЕД самым первым блоком (иначе пустая первая строка).
        self._produced_output = False
        # BUG-5: следующий текстовый run идёт сразу за номером сноски — его
        # ведущий обычный пробел делаем неразрывным (см. _add_run).
        self._after_footnote_ref = False
        # BUG-3: под выравниванием «по ширине» (w:jc both) Word растягивает
        # ТОЛЬКО обычный пробел U+0020 (U+00A0 не тянется). Разделитель перед
        # словом-якорем сноски тогда растягивается и отрывает блок «слово+номер»
        # от предыдущего слова — под justify делаем его неразрывным (см.
        # _open_span footnote-ветку). Выравнивание известно: formatter.py
        # выставляет paragraph.alignment ДО apply_inline_html.
        self._justify = paragraph.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY
        # BUG-3: последний run параграфа на момент открытия footnote-span —
        # ориентир, чтобы strip хвостового пробела якоря не задел предыдущий run.
        self._footnote_run_before: OxmlElement | None = None

    @property
    def state(self) -> _RunState:
        return self.stack[-1]

    def handle_starttag(self, tag, attrs):
        current = self.state
        if tag == "a":
            href = dict(attrs).get("href", "")
            if href and self._open_hyperlink(href):
                self.stack.append(replace(current, underline=True))
                return
            self.stack.append(current)
            return
        if tag in ("b", "strong"):
            self.stack.append(replace(current, bold=True))
        elif tag in ("i", "em"):
            self.stack.append(replace(current, italic=True))
        elif tag == "u":
            self.stack.append(replace(current, underline=True))
        elif tag in ("s", "strike", "del"):
            self.stack.append(replace(current, strike=True))
        elif tag == "span":
            self._open_span(dict(attrs), current)
        elif tag == "br":
            # Void-тег: кадр НЕ пушим (как в handle_startendtag), иначе
            # закрывающий </b> снял бы лишний кадр вместо bold-фрейма и
            # текст после </b> остался бы жирным (H7). </br>, если придёт,
            # игнорируется в handle_endtag.
            self._add_break()
        elif tag in _BLOCK_TAGS:
            # Граница блока = перенос строки. Перед содержимым нового блока
            # вставляем перенос, но НЕ перед первым (guard по _produced_output).
            # Кадр пушим — парный close-tag снимет его в handle_endtag (len>1).
            if self._produced_output:
                self._add_break()
            self.stack.append(current)
        else:
            self.stack.append(current)

    def handle_startendtag(self, tag, attrs):
        """Обрабатывает self-closing теги вида <br/>."""
        if tag == "br":
            self._add_break()
        else:
            self.handle_starttag(tag, attrs)
            self.handle_endtag(tag)

    def _open_span(self, attrs: dict, current: "_RunState") -> None:
        """Открывает <span>: footnote-якорь, ссылку или обычный span."""
        cls = attrs.get("class", "")
        if "text-footnote" in cls:
            # BUG-3: под justify разделитель перед словом-якорем делаем
            # неразрывным, иначе блок «слово-якорь + номер» отрывается от
            # предыдущего слова (Word тянет только U+0020).
            if self._justify:
                self._nbsp_trailing_space_before_footnote()
            # Снимок последнего run'а ДО якоря — чтобы strip хвостового пробеля
            # якоря (BUG-3) не задел предыдущий run, если якорь без текста.
            existing_runs = self.paragraph._p.findall(qn("w:r"))
            self._footnote_run_before = existing_runs[-1] if existing_runs else None
            # Якорь рендерим обычным текстом; сноску добавим при закрытии.
            self._span_kinds.append(("footnote", attrs.get("data-footnote-text")))
            self.stack.append(current)
            return
        url = attrs.get("data-link-url", "")
        if "text-link" in cls and url and self._open_hyperlink(url):
            self._span_kinds.append(("link", None))
            self.stack.append(replace(current, underline=True))
            return
        size = _extract_size_pt(attrs)
        self._span_kinds.append(("plain", None))
        state = current
        if size:
            state = replace(state, size_pt=size)
        if _STRIKE_RE.search(attrs.get("style", "")):
            state = replace(state, strike=True)
        self.stack.append(state)

    def handle_endtag(self, tag):
        if tag == "br":
            # Void-тег: handle_starttag кадр не пушил — снимать нечего.
            return
        if tag == "a" and self._hyperlink is not None:
            self._close_hyperlink()
        if tag == "span" and self._span_kinds:
            kind, payload = self._span_kinds.pop()
            if kind == "footnote" and payload:
                # BUG-3: хвостовой обычный пробел ВНУТРИ якоря (например из
                # вставки Word) дал бы растяжимую щель между якорем и номером
                # под justify — срезаем его перед добавлением сноски.
                self._strip_trailing_anchor_space()
                add_footnote(self.paragraph, payload)
                # Номер сноски только что вставлен — следующий текстовый run
                # должен начинаться с неразрывного пробела (BUG-5).
                self._after_footnote_ref = True
            elif kind == "link":
                self._close_hyperlink()
        if len(self.stack) > 1:
            self.stack.pop()

    def handle_data(self, data):
        if data:
            self._add_run(data)

    def _add_run(self, text: str) -> None:
        # BUG-5: текст сразу после сноски, начинающийся с ОБЫЧНОГО пробела-
        # разделителя, под выравниванием «по ширине» (w:jc both) отрывал бы номер
        # сноски — Word растягивает обычные пробелы. Делаем этот первый пробел
        # неразрывным (U+00A0): номер «прилипает» к последующему слову. Работает
        # для любого контента (старого/нового), т.к. нормализуется на экспорте.
        if self._after_footnote_ref:
            self._after_footnote_ref = False
            if text.startswith(" "):
                text = "\u00A0" + text[1:]
        self._produced_output = True
        # Вне <a> используем высокоуровневый API python-docx — он создаёт
        # `w:r` с привычным порядком элементов (важно для обратной совместимости
        # с тестами, читающими p.runs/run.bold/run.font.size).
        if self._hyperlink is None:
            run = self.paragraph.add_run(text)
            run.font.name = Fonts.main
            run.font.size = Pt(self.state.size_pt)
            run.bold = self.state.bold
            run.italic = self.state.italic
            if self.state.underline:
                run.underline = True
            if self.state.strike:
                run.font.strike = True
            return

        # Внутри <a> конструируем `w:r` напрямую через oxml,
        # чтобы родителем стал именно `w:hyperlink`, а не `w:p`.
        r_el = OxmlElement("w:r")
        r_pr = OxmlElement("w:rPr")

        rfonts = OxmlElement("w:rFonts")
        rfonts.set(qn("w:ascii"), Fonts.main)
        rfonts.set(qn("w:hAnsi"), Fonts.main)
        r_pr.append(rfonts)

        sz = OxmlElement("w:sz")
        sz.set(qn("w:val"), str(int(self.state.size_pt * 2)))
        r_pr.append(sz)

        if self.state.bold:
            r_pr.append(OxmlElement("w:b"))
        if self.state.italic:
            r_pr.append(OxmlElement("w:i"))
        if self.state.strike:
            r_pr.append(OxmlElement("w:strike"))
        if self.state.underline:
            u = OxmlElement("w:u")
            u.set(qn("w:val"), "single")
            r_pr.append(u)

        color = OxmlElement("w:color")
        color.set(qn("w:val"), "0563C1")
        r_pr.append(color)

        r_el.append(r_pr)

        t_el = OxmlElement("w:t")
        t_el.set(qn("xml:space"), "preserve")
        t_el.text = text
        r_el.append(t_el)

        self._hyperlink.append(r_el)

    def _add_break(self) -> None:
        """Реальный OOXML-перенос строки (<w:br/>).

        Литеральный '\\n' внутри <w:t> Word НЕ интерпретирует как разрыв
        (схлопывает в пробел) — видимый перенос даёт только элемент w:br.
        """
        self._produced_output = True
        if self._hyperlink is None:
            run = self.paragraph.add_run()
            run.font.name = Fonts.main
            run.font.size = Pt(self.state.size_pt)
            run.add_break(WD_BREAK.LINE)
            return
        # Внутри <a>: w:br отдельным w:r внутри w:hyperlink.
        r_el = OxmlElement("w:r")
        r_el.append(OxmlElement("w:br"))
        self._hyperlink.append(r_el)

    def _nbsp_trailing_space_before_footnote(self) -> None:
        """BUG-3: заменяет единственный хвостовой U+0020 предыдущего текстового
        run'а на U+00A0 — под justify слово-якорь со своим номером не отрывается
        от предыдущего слова. Несколько пробелов: рвём только последний (стык
        слово↔якорь), более ранние остаются растяжимыми. Берём только прямые
        w:r параграфа (runs внутри w:hyperlink не трогаем — сноска сразу за
        ссылкой редка, неразрывный пробел тогда просто не ставится)."""
        for r in reversed(self.paragraph._p.findall(qn("w:r"))):
            t = r.find(qn("w:t"))
            if t is None or not t.text:
                continue
            if t.text.endswith(" "):
                t.text = t.text[:-1] + chr(0xA0)
                t.set(qn("xml:space"), "preserve")
            return

    def _strip_trailing_anchor_space(self) -> None:
        """BUG-3: срезает хвостовые обычные пробелы у текста ЯКОРЯ сноски —
        иначе они дали бы растяжимую щель между якорем и номером под justify.
        Стрипаем только run, добавленный ВНУТРИ footnote-span (сравнение со
        снимком _footnote_run_before), чтобы у пустого якоря не задеть
        предыдущий run."""
        runs = self.paragraph._p.findall(qn("w:r"))
        if not runs:
            return
        last = runs[-1]
        if last is self._footnote_run_before:
            return  # якорь без текста — собственный run не добавлялся
        t = last.find(qn("w:t"))
        if t is not None and t.text and t.text.endswith(" "):
            t.text = t.text.rstrip(" ")

    def _open_hyperlink(self, href: str) -> bool:
        """Создаёт w:hyperlink. Якорь '#...' → внутренняя ссылка (w:anchor),
        безопасная внешняя схема → external relationship (r:id). Небезопасный
        протокол (javascript: и т.п.) отклоняется → текст останется plain."""
        href = href.strip()
        hyperlink = OxmlElement("w:hyperlink")
        if href.startswith("#"):
            # Внутри-документный якорь (закладка) — без external relationship.
            hyperlink.set(qn("w:anchor"), href[1:])
        elif _is_safe_url(href):
            part = self.paragraph.part
            r_id = part.relate_to(href, RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
            hyperlink.set(qn("r:id"), r_id)
        else:
            return False
        self.paragraph._p.append(hyperlink)
        self._hyperlink = hyperlink
        return True

    def _close_hyperlink(self) -> None:
        self._hyperlink = None


def _extract_size_pt(attrs: dict) -> float | None:
    style = attrs.get("style", "")
    match = _SIZE_RE.search(style)
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2).lower()
    return value * _PX_TO_PT if unit == "px" else value
