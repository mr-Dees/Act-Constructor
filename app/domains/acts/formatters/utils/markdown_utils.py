"""
Утилиты для экранирования произвольного текста под inline-синтаксис Markdown.

Правило — CommonMark backslash escapes: любой ASCII punctuation может быть
экранирован обратным слэшем, и сам слэш обязан экранироваться ПЕРВЫМ (иначе
он «съедает» экранирование следующего за ним спецсимвола).
"""


class MarkdownUtils:
    """Stateless класс-утилита для экранирования Markdown inline-синтаксиса."""

    @staticmethod
    def escape_inline(text: str, special_chars: str) -> str:
        """
        Экранирует текст для однострочной вставки в Markdown.

        Переводы строк сворачиваются в пробел (текст остаётся частью одной
        inline-конструкции, не порождает новые блоки). Обратный слэш
        экранируется первым, затем — каждый символ из special_chars.

        Args:
            text: Исходный текст (подпись, имя файла и т.п.)
            special_chars: Символы, значимые для конкретной MD-конструкции
                (например, "[]" для alt-текста, '"' для title)

        Returns:
            Текст, безопасный для вставки в Markdown
        """
        text = text.replace("\r", " ").replace("\n", " ")
        text = text.replace("\\", "\\\\")
        for ch in special_chars:
            text = text.replace(ch, "\\" + ch)
        return text
