"""
Утилиты для работы с HTML-контентом.

Предоставляет функции для очистки, конвертации и парсинга HTML.
"""

import html
import re
from typing import Dict


class HTMLUtils:
    """
    Stateless класс-утилита для работы с HTML.

    Все методы статические для удобства использования.
    """

    @staticmethod
    def clean_html(content: str) -> str:
        """
        Удаляет все HTML-теги и декодирует HTML-сущности.

        Args:
            content: HTML-контент

        Returns:
            str: Очищенный plain text

        Example:
            >>> HTMLUtils.clean_html('<b>Hello</b><br/>World')
            'Hello\\nWorld'
        """
        # Замена <br> на переносы строк
        clean = re.sub(r'<br\s*/?>', '\n', content, flags=re.IGNORECASE)

        # Удаление всех HTML-тегов
        clean = re.sub(r'<[^>]+>', '', clean)

        # Декодирование HTML-сущностей (&nbsp;, &lt; и т.д.)
        return html.unescape(clean)

    @staticmethod
    def html_to_markdown(content: str) -> str:
        """
        Конвертирует HTML в Markdown синтаксис.

        Поддерживает:
        - <b>, <strong> -> **bold**
        - <i>, <em> -> *italic*
        - <u> -> удаление (Markdown не поддерживает)
        - <br> -> hard break (два пробела + \\n)

        Args:
            content: HTML-контент

        Returns:
            str: Markdown-текст

        Example:
            >>> HTMLUtils.html_to_markdown('<b>Bold</b> and <i>italic</i>')
            '**Bold** and *italic*'
        """
        # <br> -> Markdown hard break
        result = re.sub(r'<br\s*/?>', '  \n', content, flags=re.IGNORECASE)

        # <b>, <strong> -> **текст**
        result = re.sub(
            r'<(?:b|strong)>(.+?)</(?:b|strong)>',
            r'**\1**',
            result,
            flags=re.DOTALL
        )

        # <i>, <em> -> *текст*
        result = re.sub(
            r'<(?:i|em)>(.+?)</(?:i|em)>',
            r'*\1*',
            result,
            flags=re.DOTALL
        )

        # <u> -> текст (underline не поддерживается в Markdown)
        result = re.sub(r'<u>(.+?)</u>', r'\1', result, flags=re.DOTALL)

        # Удаление остальных тегов
        result = re.sub(r'<[^>]+>', '', result)

        # Декодирование HTML-сущностей
        return html.unescape(result)

    @staticmethod
    def extract_style_property(html_element: str, property_name: str, default: str = '') -> str:
        """
        Извлекает значение CSS-свойства из style атрибута.

        Args:
            html_element: HTML-строка элемента
            property_name: Имя CSS-свойства (например, 'text-align')
            default: Значение по умолчанию

        Returns:
            str: Значение свойства или default

        Example:
            >>> html = '<div style="text-align: center; color: red">'
            >>> HTMLUtils.extract_style_property(html, 'text-align')
            'center'
        """
        # Извлечение style атрибута
        style_match = re.search(r'style=["\']([^"\']*)["\']', html_element)
        if not style_match:
            return default

        style_str = style_match.group(1)

        # Поиск конкретного свойства
        prop_pattern = rf'{re.escape(property_name)}\s*:\s*([^;]+)'
        prop_match = re.search(prop_pattern, style_str)

        return prop_match.group(1).strip() if prop_match else default

    @staticmethod
    def parse_style_dict(style_string: str) -> Dict[str, str]:
        """
        Парсит CSS-строку стилей в словарь.

        Args:
            style_string: CSS строка (например, 'color: red; font-size: 14px')

        Returns:
            Dict[str, str]: Словарь {property: value}

        Example:
            >>> HTMLUtils.parse_style_dict('color: red; font-size: 14px')
            {'color': 'red', 'font-size': '14px'}
        """
        styles = {}
        if not style_string:
            return styles

        for item in style_string.split(';'):
            if ':' not in item:
                continue

            prop, value = item.split(':', 1)
            styles[prop.strip()] = value.strip()

        return styles
