"""Inline HTML → docx runs.

Поддерживает <b>, <strong>, <i>, <em>, <u>, <s>/<strike>/<del>,
<span style="font-size: ...">, <span style="text-decoration: line-through">,
<br>, <a href="...">. Любой другой тег игнорируется (содержимое сохраняется).

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

from docx.shared import Pt
from docx.text.paragraph import Paragraph
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE

from app.domains.acts.formatters.docx.footnotes import add_footnote
from app.domains.acts.formatters.docx.styles import Fonts


# Протоколы, допустимые в гиперссылках DOCX (совпадает с html_sanitizer).
_SAFE_LINK_PREFIXES = ("http://", "https://", "mailto:")


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
            self._add_run("\n")
        else:
            self.stack.append(current)

    def handle_startendtag(self, tag, attrs):
        """Обрабатывает self-closing теги вида <br/>."""
        if tag == "br":
            self._add_run("\n")
        else:
            self.handle_starttag(tag, attrs)
            self.handle_endtag(tag)

    def _open_span(self, attrs: dict, current: "_RunState") -> None:
        """Открывает <span>: footnote-якорь, ссылку или обычный span."""
        cls = attrs.get("class", "")
        if "text-footnote" in cls:
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
                add_footnote(self.paragraph, payload)
            elif kind == "link":
                self._close_hyperlink()
        if len(self.stack) > 1:
            self.stack.pop()

    def handle_data(self, data):
        if data:
            self._add_run(data)

    def _add_run(self, text: str) -> None:
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

    def _open_hyperlink(self, href: str) -> bool:
        """Создаёт w:hyperlink с external relationship. Небезопасный
        протокол (javascript: и т.п.) отклоняется → текст останется plain."""
        if not _is_safe_url(href):
            return False
        part = self.paragraph.part
        r_id = part.relate_to(href, RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
        hyperlink = OxmlElement("w:hyperlink")
        hyperlink.set(qn("r:id"), r_id)
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
