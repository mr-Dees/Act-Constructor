"""Inline HTML → docx runs.

Поддерживает <b>, <strong>, <i>, <em>, <u>, <span style="font-size: ...">,
<br>. Любой другой тег игнорируется (содержимое сохраняется).

Размеры font-size:
    px → pt: умножение на 0.75 (16px → 12pt)
    pt    : без изменений
"""
import re
from html.parser import HTMLParser
from dataclasses import dataclass, replace

from docx.shared import Pt
from docx.text.paragraph import Paragraph

from app.domains.acts.formatters.docx.styles import Fonts


@dataclass(frozen=True)
class _RunState:
    bold: bool = False
    italic: bool = False
    underline: bool = False
    size_pt: float = 12.0


_PX_TO_PT = 0.75
_SIZE_RE = re.compile(r"font-size\s*:\s*(\d+(?:\.\d+)?)\s*(px|pt)", re.IGNORECASE)


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

    @property
    def state(self) -> _RunState:
        return self.stack[-1]

    def handle_starttag(self, tag, attrs):
        current = self.state
        if tag in ("b", "strong"):
            self.stack.append(replace(current, bold=True))
        elif tag in ("i", "em"):
            self.stack.append(replace(current, italic=True))
        elif tag == "u":
            self.stack.append(replace(current, underline=True))
        elif tag == "span":
            size = _extract_size_pt(dict(attrs))
            self.stack.append(replace(current, size_pt=size) if size else current)
        elif tag == "br":
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

    def handle_endtag(self, tag):
        if len(self.stack) > 1:
            self.stack.pop()

    def handle_data(self, data):
        if data:
            self._add_run(data)

    def _add_run(self, text: str):
        run = self.paragraph.add_run(text)
        run.font.name = Fonts.main
        run.font.size = Pt(self.state.size_pt)
        run.bold = self.state.bold
        run.italic = self.state.italic
        if self.state.underline:
            run.underline = True


def _extract_size_pt(attrs: dict) -> float | None:
    style = attrs.get("style", "")
    match = _SIZE_RE.search(style)
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2).lower()
    return value * _PX_TO_PT if unit == "px" else value
