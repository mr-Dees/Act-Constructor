"""
Форматер для создания актов в формате DOCX.

Преобразует структуру акта в документ Microsoft Word
с поддержкой таблиц, форматирования текста и иерархической структуры.
Обрабатывает все типы элементов: обычные пункты, таблицы с объединенными ячейками,
текстовые блоки с HTML-форматированием и блоки нарушений с изображениями.
"""

import base64
import re
from html.parser import HTMLParser
from io import BytesIO
from typing import Dict, List, Tuple, Optional

from docx import Document
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
from docx.shared import Inches, Pt

from app.formatters.base_formatter import BaseFormatter


class HTMLToDocxParser(HTMLParser):
    """Парсер HTML с поддержкой div-блоков, inline-форматирования, гиперссылок и сносок"""

    def __init__(self, paragraph):
        super().__init__()
        self.paragraph = paragraph
        self.bold = False
        self.italic = False
        self.underline = False
        self.strike = False
        self.font_size: Optional[int] = None
        self.alignment: Optional[str] = None
        self.text_buffer: List[str] = []
        self.in_div = False

        # Для ссылок
        self.in_link = False
        self.link_url: Optional[str] = None
        self.link_text: List[str] = []

        # Для сносок
        self.in_footnote = False
        self.footnote_text: Optional[str] = None
        self.footnote_content: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, str]]):
        if tag == 'br':
            return

        # Сбрасываем буфер перед изменением стиля
        self._flush_buffer()

        if tag in ['b', 'strong']:
            self.bold = True
        elif tag in ['i', 'em']:
            self.italic = True
        elif tag == 'u':
            self.underline = True
        elif tag in ['s', 'strike', 'del']:
            self.strike = True
        elif tag in ['span', 'div']:
            attrs_dict = dict(attrs)

            # Обработка гиперссылок
            if 'data-link-url' in attrs_dict:
                self.in_link = True
                self.link_url = attrs_dict['data-link-url']
                self.link_text = []
                return

            # Обработка сносок
            if 'data-footnote-text' in attrs_dict:
                self.in_footnote = True
                self.footnote_text = attrs_dict['data-footnote-text']
                self.footnote_content = []
                return

            # Обработка стилей
            style_dict = self._parse_style(attrs_dict.get('style', ''))
            if 'font-size' in style_dict:
                size_str = style_dict['font-size'].replace('px', '').strip()
                try:
                    self.font_size = int(size_str)
                except ValueError:
                    pass

            if 'text-align' in style_dict:
                self.alignment = style_dict['text-align']

            if tag == 'div':
                self.in_div = True

    def handle_endtag(self, tag: str):
        if tag == 'br':
            self._flush_buffer()
            self.paragraph.add_run('\n')
            return

        self._flush_buffer()

        if tag in ['b', 'strong']:
            self.bold = False
        elif tag in ['i', 'em']:
            self.italic = False
        elif tag == 'u':
            self.underline = False
        elif tag in ['s', 'strike', 'del']:
            self.strike = False
        elif tag == 'span':
            # Обработка закрытия гиперссылки
            if self.in_link:
                self._add_link()
                return

            # Обработка закрытия сноски
            if self.in_footnote:
                self._add_footnote()
                return

            self.font_size = None
        elif tag == 'div':
            # После div добавляем перенос строки
            self.paragraph.add_run('\n')
            self.in_div = False
            self.alignment = None

    def handle_data(self, data: str):
        # Игнорируем пустые строки между тегами
        if not data.strip():
            return

        # Если внутри ссылки - собираем текст отдельно
        if self.in_link:
            self.link_text.append(data)
            return

        # Если внутри сноски - собираем текст отдельно
        if self.in_footnote:
            self.footnote_content.append(data)
            return

        # Обычная обработка
        self.text_buffer.append(data)

    def _parse_style(self, style_string: str) -> Dict[str, str]:
        """Парсит CSS-строку стилей"""
        styles = {}
        if not style_string:
            return styles

        for item in style_string.split(';'):
            if ':' in item:
                prop, value = item.split(':', 1)
                styles[prop.strip()] = value.strip()

        return styles

    def _flush_buffer(self):
        """Сбрасывает текстовый буфер в run с текущим форматированием"""
        if not self.text_buffer:
            return

        text = ''.join(self.text_buffer)
        self.text_buffer = []

        if not text.strip():
            return

        # Создаем run с форматированием
        run = self.paragraph.add_run(text)
        self._apply_formatting(run)

    def _apply_formatting(self, run):
        """Применяет текущее форматирование к run"""
        run.bold = self.bold
        run.italic = self.italic
        run.underline = self.underline

        if self.strike:
            run.font.strike = True

        if self.font_size:
            run.font.size = Pt(self.font_size)

    def _add_link(self):
        """Добавляет гиперссылку в markdown-формате"""
        link_text = ''.join(self.link_text)
        run = self.paragraph.add_run(f'[{link_text}]({self.link_url})')
        self._apply_formatting(run)

        self.in_link = False
        self.link_url = None
        self.link_text = []

    def _add_footnote(self):
        """Добавляет сноску в markdown-формате"""
        footnote_content = ''.join(self.footnote_content)
        run = self.paragraph.add_run(f'{footnote_content}^[{self.footnote_text}]')
        self._apply_formatting(run)

        self.in_footnote = False
        self.footnote_text = None
        self.footnote_content = []

    def close(self):
        """Завершает парсинг"""
        self._flush_buffer()
        super().close()


class DocxFormatter(BaseFormatter):
    """
    Форматер для преобразования структуры акта в документ DOCX.

    Рекурсивно обходит древовидную структуру акта и создает
    документ Microsoft Word с заголовками различных уровней,
    таблицами с объединенными ячейками, текстовыми блоками
    с HTML-форматированием и блоками нарушений с изображениями.
    """

    # Константы для настройки форматирования
    MAX_HEADING_LEVEL = 9
    DEFAULT_IMAGE_WIDTH = Inches(4)
    CAPTION_FONT_SIZE = Pt(10)

    # Маппинг выравнивания CSS -> Word
    ALIGNMENT_MAP = {
        'center': WD_PARAGRAPH_ALIGNMENT.CENTER,
        'right': WD_PARAGRAPH_ALIGNMENT.RIGHT,
        'justify': WD_PARAGRAPH_ALIGNMENT.JUSTIFY,
        'left': WD_PARAGRAPH_ALIGNMENT.LEFT
    }

    def __init__(self):
        """
        Инициализация форматера с пустыми хранилищами для сущностей.
        Хранилища заполняются при вызове format() из входных данных.
        """
        self.violations: Dict = {}
        self.textBlocks: Dict = {}
        self.tables: Dict = {}

    def format(self, data: Dict) -> Document:
        """
        Форматирует данные акта в документ DOCX.

        Args:
            data: Словарь с данными акта, содержащий:
                - tree: древовидная структура документа
                - tables: словарь таблиц по ID
                - textBlocks: словарь текстовых блоков по ID
                - violations: словарь нарушений по ID

        Returns:
            Document: Объект документа python-docx, готовый для сохранения
        """
        doc = Document()

        # Сохраняем ссылки на сущности для использования в _add_item
        self.violations = data.get('violations', {})
        self.textBlocks = data.get('textBlocks', {})
        self.tables = data.get('tables', {})

        # Создаем главный заголовок документа
        heading = doc.add_heading('Акт', level=0)
        heading.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER

        # Обработка дерева структуры акта (рекурсивно)
        tree = data.get('tree', {})
        root_children = tree.get('children', [])

        for item in root_children:
            self._add_item(doc, item, level=1)

        return doc

    def _add_item(self, doc: Document, item: Dict, level: int = 1):
        """
        Рекурсивно добавляет пункт акта в документ.
        Обрабатывает заголовок, содержимое, связанные сущности (таблицы, текстовые блоки,
        нарушения) и дочерние элементы.

        Args:
            doc: Документ DOCX для добавления элементов
            item: Словарь с данными пункта (label, type, content, children и т.д.)
            level: Уровень вложенности для определения размера заголовков (1-9)
        """
        label = item.get('label', '')
        item_type = item.get('type', 'item')

        # Добавляем заголовок пункта (кроме текстовых блоков и нарушений)
        if label and item_type not in ['textblock', 'violation']:
            heading_level = min(level, self.MAX_HEADING_LEVEL)
            doc.add_heading(label, level=heading_level)

        # Добавляем текстовое содержание пункта
        content = item.get('content', '')
        if content:
            doc.add_paragraph(content)

        # Обработка связанной таблицы
        table_id = item.get('tableId')
        if table_id and table_id in self.tables:
            self._add_table(doc, self.tables[table_id])

        # Обработка текстового блока с форматированием
        textblock_id = item.get('textBlockId')
        if textblock_id and textblock_id in self.textBlocks:
            self._add_textblock(doc, self.textBlocks[textblock_id])

        # Обработка нарушения
        violation_id = item.get('violationId')
        if violation_id and violation_id in self.violations:
            self._add_violation(doc, self.violations[violation_id])

        # Рекурсивная обработка дочерних элементов с увеличением уровня
        children = item.get('children', [])
        for child in children:
            self._add_item(doc, child, level + 1)

    def _add_table(self, doc: Document, table_data: Dict):
        """
        Добавляет таблицу в документ с матричной grid-структурой.
        Обрабатывает объединенные ячейки (colspan/rowspan) и применяет
        жирное начертание к заголовкам.

        Args:
            doc: Документ DOCX
            table_data: Словарь с данными таблицы, содержащий grid
        """
        grid = table_data.get('grid', [])

        # Проверка на пустую таблицу
        if not grid or not grid[0]:
            doc.add_paragraph('[Пустая таблица]')
            return

        num_rows = len(grid)
        num_cols = len(grid[0])

        # Создание таблицы с сеткой Word
        table = doc.add_table(rows=num_rows, cols=num_cols)
        table.style = 'Table Grid'

        # Отслеживаем уже обработанные объединения
        processed_merges = set()

        # Заполнение таблицы данными
        for row_idx, row_data in enumerate(grid):
            for col_idx, cell_data in enumerate(row_data):
                # Пропускаем поглощенные ячейки
                if cell_data.get('isSpanned', False):
                    continue

                # Заполнение содержимого ячейки
                cell = table.cell(row_idx, col_idx)
                cell.text = str(cell_data.get('content', ''))

                # Применяем жирное начертание к заголовкам
                if cell_data.get('isHeader', False):
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            run.bold = True

                # Обработка объединения ячеек
                self._merge_cells(
                    table, cell, cell_data,
                    row_idx, col_idx,
                    num_rows, num_cols,
                    processed_merges
                )

        # Добавляем пустой параграф после таблицы
        doc.add_paragraph()

    def _merge_cells(
            self, table, cell, cell_data: Dict,
            row_idx: int, col_idx: int,
            num_rows: int, num_cols: int,
            processed_merges: set
    ):
        """Обрабатывает объединение ячеек таблицы"""
        rowspan = cell_data.get('rowSpan', 1)
        colspan = cell_data.get('colSpan', 1)

        if rowspan > 1 or colspan > 1:
            merge_key = (row_idx, col_idx)
            if merge_key not in processed_merges:
                try:
                    # Вычисление конечной ячейки с защитой от выхода за границы
                    end_row = min(row_idx + rowspan - 1, num_rows - 1)
                    end_col = min(col_idx + colspan - 1, num_cols - 1)
                    end_cell = table.cell(end_row, end_col)

                    # Объединение диапазона ячеек
                    cell.merge(end_cell)
                    processed_merges.add(merge_key)
                except Exception as e:
                    # Логируем ошибку, но продолжаем
                    print(f"Ошибка объединения ячеек [{row_idx},{col_idx}]: {e}")

    def _add_textblock(self, doc: Document, textblock_data: Dict):
        """
        Добавляет текстовый блок с HTML-форматированием в документ.
        Обрабатывает div-блоки с разным выравниванием и inline-стили.

        Args:
            doc: Документ DOCX
            textblock_data: Словарь с content и formatting
        """
        content = textblock_data.get('content', '').strip()
        if not content:
            return

        formatting = textblock_data.get('formatting', {})
        blocks = self._parse_div_blocks(content, formatting)

        # Создаем параграфы для каждого блока
        for block in blocks:
            if not block['content']:
                continue

            paragraph = doc.add_paragraph()
            paragraph.alignment = self.ALIGNMENT_MAP.get(
                block['alignment'],
                WD_PARAGRAPH_ALIGNMENT.LEFT
            )

            # Парсинг HTML
            parser = HTMLToDocxParser(paragraph)
            parser.feed(block['content'])
            parser.close()

            # Применение базового размера шрифта
            base_font_size = formatting.get('fontSize', 14)
            for run in paragraph.runs:
                if not run.font.size:
                    run.font.size = Pt(base_font_size)

        # Пустой параграф после блока
        doc.add_paragraph()

    def _parse_div_blocks(self, content: str, formatting: Dict) -> List[Dict]:
        """Разбивает HTML-контент на блоки по div-элементам"""
        div_pattern = r'<div[^>]*>.*?</div>'
        div_matches = list(re.finditer(div_pattern, content, re.DOTALL))

        if not div_matches:
            return [{'content': content, 'alignment': formatting.get('alignment', 'left')}]

        blocks = []
        last_end = 0
        default_alignment = formatting.get('alignment', 'left')

        for match in div_matches:
            # Контент до div
            if match.start() > last_end:
                pre_content = content[last_end:match.start()].strip()
                if pre_content:
                    blocks.append({'content': pre_content, 'alignment': default_alignment})

            # Извлекаем контент и стиль div
            div_html = match.group(0)
            div_content = self._extract_div_content(div_html)
            alignment = self._extract_div_alignment(div_html, default_alignment)

            if div_content:
                blocks.append({'content': div_content, 'alignment': alignment})

            last_end = match.end()

        # Контент после последнего div
        if last_end < len(content):
            post_content = content[last_end:].strip()
            if post_content:
                blocks.append({'content': post_content, 'alignment': default_alignment})

        return blocks

    def _extract_div_content(self, div_html: str) -> str:
        """Извлекает содержимое из div-тега"""
        match = re.search(r'<div[^>]*>(.*?)</div>', div_html, re.DOTALL)
        return match.group(1).strip() if match else ''

    def _extract_div_alignment(self, div_html: str, default: str) -> str:
        """Извлекает text-align из style атрибута div"""
        style_match = re.search(r'style=["\']([^"\']*)["\']', div_html)
        if not style_match:
            return default

        style_str = style_match.group(1)
        align_match = re.search(r'text-align:\s*([^;]+)', style_str)
        return align_match.group(1).strip() if align_match else default

    def _add_violation(self, doc: Document, violation_data: Dict):
        """
        Добавляет блок нарушения в документ с полной структурой полей.
        Включает: нарушено, установлено, список описаний, дополнительный контент,
        причины, последствия, ответственных.

        Args:
            doc: Документ DOCX
            violation_data: Словарь с данными нарушения
        """
        # Секция "Нарушено"
        self._add_labeled_field(doc, 'Нарушено', violation_data.get('violated', ''))

        # Секция "Установлено"
        self._add_labeled_field(doc, 'Установлено', violation_data.get('established', ''))

        # Список описаний (метрик)
        self._add_description_list(doc, violation_data.get('descriptionList', {}))

        # Дополнительный контент
        self._add_additional_content(doc, violation_data.get('additionalContent', {}))

        # Опциональные поля
        self._add_labeled_field(doc, 'Причины', violation_data.get('reasons', {}))
        self._add_labeled_field(doc, 'Последствия', violation_data.get('consequences', {}))
        self._add_labeled_field(doc, 'Ответственные', violation_data.get('responsible', {}))

        # Пустой параграф после блока
        doc.add_paragraph()

    def _add_labeled_field(self, doc: Document, label: str, data):
        """Добавляет поле с меткой (если данные не пусты)"""
        # Обработка опциональных полей с enabled флагом
        if isinstance(data, dict):
            if not data.get('enabled', False):
                return
            content = data.get('content', '')
        else:
            content = data

        if content:
            p = doc.add_paragraph()
            p.add_run(f'{label}: ').bold = True
            p.add_run(content)

    def _add_description_list(self, doc: Document, desc_list: Dict):
        """Добавляет список описаний с маркерами"""
        if not desc_list.get('enabled', False):
            return

        items = desc_list.get('items', [])
        if not items:
            return

        p = doc.add_paragraph()
        p.add_run('Описание:').bold = True

        for item in items:
            if item.strip():
                doc.add_paragraph(item, style='List Bullet')

    def _add_additional_content(self, doc: Document, additional_content: Dict):
        """Добавляет дополнительный контент (кейсы, изображения, текст)"""
        if not additional_content.get('enabled', False):
            return

        items = additional_content.get('items', [])
        case_number = 1

        for item in items:
            item_type = item.get('type')

            if item_type == 'case':
                case_number = self._add_case(doc, item, case_number)
            elif item_type == 'image':
                self._add_image(doc, item)
                case_number = 1  # Сброс счетчика
            elif item_type == 'freeText':
                self._add_free_text(doc, item)
                case_number = 1  # Сброс счетчика

    def _add_case(self, doc: Document, item: Dict, case_number: int) -> int:
        """Добавляет кейс с номером"""
        content = item.get('content', '')
        if content:
            p = doc.add_paragraph()
            p.add_run(f'Кейс {case_number}: ').bold = True
            p.add_run(content)
            return case_number + 1
        return case_number

    def _add_image(self, doc: Document, item: Dict):
        """Добавляет изображение из base64 data URL"""
        url = item.get('url', '')
        caption = item.get('caption', '')
        filename = item.get('filename', '')

        if url and url.startswith('data:image'):
            try:
                # Декодирование base64
                header, encoded = url.split(',', 1)
                image_data = base64.b64decode(encoded)
                image_stream = BytesIO(image_data)

                # Вставка изображения с центрированием
                img_paragraph = doc.add_paragraph()
                img_paragraph.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
                img_run = img_paragraph.add_run()
                img_run.add_picture(image_stream, width=self.DEFAULT_IMAGE_WIDTH)

                # Подпись с центрированием и курсивом
                if caption:
                    p = doc.add_paragraph(caption)
                    p.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
                    for run in p.runs:
                        run.italic = True
                        run.font.size = self.CAPTION_FONT_SIZE
            except Exception as e:
                # Fallback: текстовая ссылка
                self._add_image_fallback(doc, filename, caption)
        else:
            # Если URL не data URL
            self._add_image_fallback(doc, filename, caption)

    def _add_image_fallback(self, doc: Document, filename: str, caption: str):
        """Добавляет текстовую ссылку на изображение при ошибке"""
        p = doc.add_paragraph(f"Изображение: {filename}")
        if caption:
            p.add_run(f" - {caption}")

    def _add_free_text(self, doc: Document, item: Dict):
        """Добавляет свободный текст"""
        content = item.get('content', '')
        if content:
            doc.add_paragraph(content)
