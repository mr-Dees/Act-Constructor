"""
Форматеры для представления актов в различных форматах.

Содержит:
- базовый абстрактный класс BaseFormatter
- текстовый форматер (plain text, ASCII-таблицы)
- Markdown форматер
- DOCX форматер (Microsoft Word)

Примечание: ActFormatter перемещён в app.integrations.ai_assistant.formatters.
"""

from app.formatters.base_formatter import BaseFormatter
from app.formatters.acts.docx_formatter import DocxFormatter
from app.formatters.acts.markdown_formatter import MarkdownFormatter
from app.formatters.acts.text_formatter import TextFormatter

__all__ = [
    "BaseFormatter",
    "TextFormatter",
    "MarkdownFormatter",
    "DocxFormatter",
]
