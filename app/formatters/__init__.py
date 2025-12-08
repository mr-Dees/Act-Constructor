"""
Форматеры для представления актов в различных форматах.

Содержит:
- базовый абстрактный класс BaseFormatter
- текстовый форматер (plain text, ASCII-таблицы)
- Markdown форматер
- DOCX форматер (Microsoft Word)
- утилитарный ActFormatter для человекочитаемого вывода данных из БД
"""

from app.formatters.ai_readable_formatter import ActFormatter
from app.formatters.base_formatter import BaseFormatter
from app.formatters.docx_formatter import DocxFormatter
from app.formatters.markdown_formatter import MarkdownFormatter
from app.formatters.text_formatter import TextFormatter

__all__ = [
    "BaseFormatter",
    "TextFormatter",
    "MarkdownFormatter",
    "DocxFormatter",
    "ActFormatter",
]
