"""
Форматер для создания актов в формате DOCX.

Преобразует структуру акта в документ Microsoft Word
с поддержкой таблиц, форматирования текста и иерархической структуры.
Обрабатывает все типы элементов: обычные пункты, таблицы с объединенными ячейками,
текстовые блоки с HTML-форматированием и блоки нарушений с изображениями.
"""

import base64
from html.parser import HTMLParser
from io import BytesIO
from typing import Dict

from docx import Document
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
from docx.shared import Inches, Pt

from app.formatters.base_formatter import BaseFormatter


class HTMLToDocxParser(HTMLParser):
    """Парсер HTML с поддержкой div-блоков и inline-форматирования"""

    def __init__(self, paragraph):
        super().__init__()
        self.paragraph = paragraph
        self.bold = False
        self.italic = False
        self.underline = False
        self.strike = False
        self.font_size = None
        self.alignment = None
        self.text_buffer = []
        self.in_div = False

    def handle_starttag(self, tag, attrs):
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

    def handle_endtag(self, tag):
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
            self.font_size = None
        elif tag == 'div':
            # После div добавляем перенос строки
            self.paragraph.add_run('\n')
            self.in_div = False
            self.alignment = None

    def handle_data(self, data):
        # Игнорируем пустые строки между тегами
        if data.strip():
            self.text_buffer.append(data)

    def _parse_style(self, style_string):
        styles = {}
        if not style_string:
            return styles

        for item in style_string.split(';'):
            if ':' in item:
                prop, value = item.split(':', 1)
                styles[prop.strip()] = value.strip()

        return styles

    def _flush_buffer(self):
        if not self.text_buffer:
            return

        text = ''.join(self.text_buffer)
        self.text_buffer = []

        if not text.strip():
            return

        # Создаем run с форматированием
        run = self.paragraph.add_run(text)
        run.bold = self.bold
        run.italic = self.italic
        run.underline = self.underline

        if self.strike:
            run.font.strike = True

        if self.font_size:
            run.font.size = Pt(self.font_size)

    def close(self):
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

    def __init__(self):
        """
        Инициализация форматера с пустыми хранилищами для сущностей.
        Хранилища заполняются при вызове format() из входных данных.
        """
        self.violations = {}
        self.textBlocks = {}
        self.tables = {}

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
            # Ограничиваем уровень заголовка до 9 (максимум в Word)
            heading_level = min(level, 9)
            doc.add_heading(label, level=heading_level)

        # Добавляем текстовое содержание пункта
        content = item.get('content', '')
        if content:
            doc.add_paragraph(content)

        # Обработка связанной таблицы
        table_id = item.get('tableId')
        if table_id and table_id in self.tables:
            table_data = self.tables[table_id]
            self._add_table(doc, table_data)

        # Обработка текстового блока с форматированием
        textblock_id = item.get('textBlockId')
        if textblock_id and textblock_id in self.textBlocks:
            textblock_data = self.textBlocks[textblock_id]
            self._add_textblock(doc, textblock_data)

        # Обработка нарушения
        violation_id = item.get('violationId')
        if violation_id and violation_id in self.violations:
            violation_data = self.violations[violation_id]
            self._add_violation(doc, violation_data)

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
            table_data: Словарь с данными таблицы, содержащий:
                - grid: двумерный массив ячеек с содержимым и метаданными
        """
        # Получаем матричную структуру таблицы
        grid = table_data.get('grid', [])

        # Проверка на пустую таблицу
        if not grid or len(grid) == 0:
            doc.add_paragraph('[Пустая таблица]')
            return

        num_rows = len(grid)
        num_cols = len(grid[0]) if grid else 0

        if num_cols == 0:
            doc.add_paragraph('[Пустая таблица]')
            return

        # Создание таблицы с сеткой Word
        table = doc.add_table(rows=num_rows, cols=num_cols)
        table.style = 'Table Grid'

        # Отслеживаем уже обработанные объединения для избежания дублирования
        processed_merges = set()

        # Заполнение таблицы данными из grid-структуры
        for row_idx, row_data in enumerate(grid):
            for col_idx, cell_data in enumerate(row_data):
                # Пропускаем ячейки, поглощенные объединением
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

                # Обработка объединения ячеек (rowSpan/colSpan)
                rowspan = cell_data.get('rowSpan', 1)
                colspan = cell_data.get('colSpan', 1)

                if rowspan > 1 or colspan > 1:
                    merge_key = (row_idx, col_idx)
                    if merge_key not in processed_merges:
                        try:
                            # Вычисление конечной ячейки для объединения с защитой от выхода за границы
                            end_row = min(row_idx + rowspan - 1, num_rows - 1)
                            end_col = min(col_idx + colspan - 1, num_cols - 1)
                            end_cell = table.cell(end_row, end_col)

                            # Объединение диапазона ячеек
                            cell.merge(end_cell)
                            processed_merges.add(merge_key)
                        except Exception as e:
                            # Логируем ошибку, но продолжаем обработку документа
                            print(f"Ошибка объединения ячеек [{row_idx},{col_idx}]: {e}")

        # Добавляем пустой параграф для отступа после таблицы
        doc.add_paragraph()

    def _add_textblock(self, doc: Document, textblock_data: Dict):
        """
        Добавляет текстовый блок с HTML-форматированием в документ.
        Обрабатывает div-блоки с разным выравниванием и inline-стили.

        Args:
            doc: Документ DOCX
            textblock_data: Словарь с данными текстового блока:
                - content: HTML-содержимое с div/span и inline-стилями
                - formatting: базовые параметры (fontSize, alignment)
        """
        content = textblock_data.get('content', '')
        formatting = textblock_data.get('formatting', {})

        if not content:
            return

        # Очищаем контент
        content = content.strip()

        # Разбиваем по div-блокам
        import re

        # Простое разделение по div
        div_pattern = r'<div[^>]*>.*?</div>'
        div_matches = list(re.finditer(div_pattern, content, re.DOTALL))

        if not div_matches:
            # Нет div-блоков, обрабатываем как один параграф
            blocks = [{'content': content, 'alignment': formatting.get('alignment', 'left')}]
        else:
            blocks = []
            last_end = 0

            for match in div_matches:
                # Контент до div
                if match.start() > last_end:
                    pre_content = content[last_end:match.start()].strip()
                    if pre_content:
                        blocks.append({'content': pre_content, 'alignment': formatting.get('alignment', 'left')})

                # Извлекаем контент и стиль div
                div_html = match.group(0)
                div_content_match = re.search(r'<div[^>]*>(.*?)</div>', div_html, re.DOTALL)
                if div_content_match:
                    div_content = div_content_match.group(1).strip()

                    # Извлекаем text-align
                    style_match = re.search(r'style=["\']([^"\']*)["\']', div_html)
                    alignment = formatting.get('alignment', 'left')
                    if style_match:
                        style_str = style_match.group(1)
                        align_match = re.search(r'text-align:\s*([^;]+)', style_str)
                        if align_match:
                            alignment = align_match.group(1).strip()

                    blocks.append({'content': div_content, 'alignment': alignment})

                last_end = match.end()

            # Контент после последнего div
            if last_end < len(content):
                post_content = content[last_end:].strip()
                if post_content:
                    blocks.append({'content': post_content, 'alignment': formatting.get('alignment', 'left')})

        # Маппинг выравнивания
        alignment_map = {
            'center': WD_PARAGRAPH_ALIGNMENT.CENTER,
            'right': WD_PARAGRAPH_ALIGNMENT.RIGHT,
            'justify': WD_PARAGRAPH_ALIGNMENT.JUSTIFY,
            'left': WD_PARAGRAPH_ALIGNMENT.LEFT
        }

        # Создаем параграфы для каждого блока
        for block in blocks:
            if not block['content']:
                continue

            paragraph = doc.add_paragraph()
            paragraph.alignment = alignment_map.get(block['alignment'], WD_PARAGRAPH_ALIGNMENT.LEFT)

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

    def _add_violation(self, doc: Document, violation_data: Dict):
        """
        Добавляет блок нарушения в документ с полной структурой полей.
        Включает: нарушено, установлено, список описаний, дополнительный контент
        (кейсы, изображения, текст), причины, последствия, ответственных.

        Args:
            doc: Документ DOCX
            violation_data: Словарь с данными нарушения, содержащий:
                - violated: что нарушено
                - established: что установлено
                - descriptionList: список описаний (метрики)
                - additionalContent: дополнительный контент (кейсы, изображения, текст)
                - reasons: причины нарушения
                - consequences: последствия
                - responsible: ответственные лица
        """
        # Секция "Нарушено"
        violated = violation_data.get('violated', '')
        if violated:
            p = doc.add_paragraph()
            p.add_run('Нарушено: ').bold = True
            p.add_run(violated)

        # Секция "Установлено"
        established = violation_data.get('established', '')
        if established:
            p = doc.add_paragraph()
            p.add_run('Установлено: ').bold = True
            p.add_run(established)

        # Список описаний (метрик) с маркированным списком
        desc_list = violation_data.get('descriptionList', {})
        if desc_list.get('enabled', False):
            items = desc_list.get('items', [])
            if items:
                p = doc.add_paragraph()
                p.add_run('Описание:').bold = True

                for item in items:
                    if item.strip():
                        doc.add_paragraph(item, style='List Bullet')

        # Дополнительный контент (кейсы, изображения, свободный текст)
        additional_content = violation_data.get('additionalContent', {})
        if additional_content.get('enabled', False):
            items = additional_content.get('items', [])

            # Счетчик для нумерации последовательных кейсов
            case_number = 1
            for item in items:
                item_type = item.get('type')

                # Обработка кейсов с автонумерацией
                if item_type == 'case':
                    content = item.get('content', '')
                    if content:
                        p = doc.add_paragraph()
                        p.add_run(f'Кейс {case_number}: ').bold = True
                        p.add_run(content)
                        case_number += 1

                # Обработка изображений с декодированием base64
                elif item_type == 'image':
                    case_number = 1  # Сброс счетчика кейсов при изображении
                    url = item.get('url', '')
                    caption = item.get('caption', '')
                    filename = item.get('filename', '')

                    # Попытка вставить изображение из data URL
                    if url and url.startswith('data:image'):
                        try:
                            header, encoded = url.split(',', 1)
                            image_data = base64.b64decode(encoded)
                            image_stream = BytesIO(image_data)

                            # Создаем параграф для изображения и центрируем его
                            img_paragraph = doc.add_paragraph()
                            img_paragraph.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
                            img_run = img_paragraph.add_run()
                            img_run.add_picture(image_stream, width=Inches(4))

                            # Добавляем подпись с центрированием и курсивом
                            if caption:
                                p = doc.add_paragraph(caption)
                                p.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
                                for run in p.runs:
                                    run.italic = True
                                    run.font.size = Pt(10)
                        except Exception as e:
                            # Fallback: добавляем текстовую ссылку на изображение
                            p = doc.add_paragraph(f"Изображение: {filename}")
                            if caption:
                                p.add_run(f" - {caption}")
                    else:
                        # Если URL не является data URL, добавляем текстовую ссылку
                        p = doc.add_paragraph(f"Изображение: {filename}")
                        if caption:
                            p.add_run(f" - {caption}")

                # Обработка свободного текста
                elif item_type == 'freeText':
                    case_number = 1  # Сброс счетчика кейсов при свободном тексте
                    content = item.get('content', '')
                    if content:
                        doc.add_paragraph(content)

        # Опциональное поле "Причины"
        reasons = violation_data.get('reasons', {})
        if reasons.get('enabled', False):
            content = reasons.get('content', '')
            if content:
                p = doc.add_paragraph()
                p.add_run('Причины: ').bold = True
                p.add_run(content)

        # Опциональное поле "Последствия"
        consequences = violation_data.get('consequences', {})
        if consequences.get('enabled', False):
            content = consequences.get('content', '')
            if content:
                p = doc.add_paragraph()
                p.add_run('Последствия: ').bold = True
                p.add_run(content)

        # Опциональное поле "Ответственные лица"
        responsible = violation_data.get('responsible', {})
        if responsible.get('enabled', False):
            content = responsible.get('content', '')
            if content:
                p = doc.add_paragraph()
                p.add_run('Ответственные: ').bold = True
                p.add_run(content)

        # Добавляем пустой параграф для отступа после блока нарушения
        doc.add_paragraph()
