"""Форматер для создания актов в формате DOCX."""

import re
from html.parser import HTMLParser
from typing import Dict

from docx import Document
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
from docx.shared import Pt

from app.formatters.base import BaseFormatter


class HTMLToDocxParser(HTMLParser):
    """Парсер HTML для преобразования в форматирование DOCX."""

    def __init__(self, paragraph):
        super().__init__()
        self.paragraph = paragraph
        self.bold = False
        self.italic = False
        self.underline = False
        self.text_buffer = []

    def handle_starttag(self, tag, attrs):
        """Обработка открывающих тегов."""
        self._flush_buffer()

        if tag in ['b', 'strong']:
            self.bold = True
        elif tag in ['i', 'em']:
            self.italic = True
        elif tag == 'u':
            self.underline = True
        elif tag == 'br':
            self._flush_buffer()
            self.paragraph.add_run('\n')

    def handle_endtag(self, tag):
        """Обработка закрывающих тегов."""
        self._flush_buffer()

        if tag in ['b', 'strong']:
            self.bold = False
        elif tag in ['i', 'em']:
            self.italic = False
        elif tag == 'u':
            self.underline = False
        elif tag in ['p', 'div']:
            self._flush_buffer()

    def handle_data(self, data):
        """Обработка текстовых данных."""
        if data:
            self.text_buffer.append(data)

    def _flush_buffer(self):
        """Сбрасывает буфер текста в paragraph с текущим форматированием."""
        if self.text_buffer:
            text = ''.join(self.text_buffer)
            if text.strip() or text.isspace():
                run = self.paragraph.add_run(text)
                run.bold = self.bold
                run.italic = self.italic
                run.underline = self.underline
            self.text_buffer = []

    def close(self):
        """Завершение парсинга."""
        self._flush_buffer()
        super().close()


class DocxFormatter(BaseFormatter):
    """Форматер для преобразования структуры акта в документ DOCX."""

    def __init__(self):
        """Инициализация форматера DOCX."""
        self.violations = {}
        self.textBlocks = {}
        self.tables = {}

    def format(self, data: Dict) -> Document:
        """
        Форматирует данные акта в документ DOCX.

        Args:
            data: Словарь с данными акта

        Returns:
            Документ Document (python-docx)
        """
        doc = Document()

        # Сохраняем ссылки на violations, textBlocks и tables для доступа при рекурсии
        self.violations = data.get('violations', {})
        self.textBlocks = data.get('textBlocks', {})
        self.tables = data.get('tables', {})

        # Главный заголовок акта
        heading = doc.add_heading('Акт', level=0)
        heading.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER

        # Обработка дерева структуры акта
        tree = data.get('tree', {})
        root_children = tree.get('children', [])

        for item in root_children:
            self._add_item(doc, item, level=1)

        return doc

    def _add_item(self, doc: Document, item: Dict, level: int = 1):
        """
        Рекурсивно добавляет пункт акта в документ.

        Args:
            doc: Документ DOCX
            item: Словарь с данными пункта
            level: Уровень вложенности (для заголовков)
        """
        # Заголовок пункта отображается для всех элементов кроме textblock и violation
        label = item.get('label', '')
        item_type = item.get('type', 'item')

        if label and item_type not in ['textblock', 'violation']:
            heading_level = min(level, 9)
            doc.add_heading(label, level=heading_level)

        # Текстовое содержание пункта
        content = item.get('content', '')
        if content:
            doc.add_paragraph(content)

        # Обработка связанной таблицы
        table_id = item.get('tableId')
        if table_id and table_id in self.tables:
            table_data = self.tables[table_id]
            self._add_table(doc, table_data)

        # Обработка текстового блока
        textblock_id = item.get('textBlockId')
        if textblock_id and textblock_id in self.textBlocks:
            textblock_data = self.textBlocks[textblock_id]
            self._add_textblock(doc, textblock_data)

        # Обработка нарушения
        violation_id = item.get('violationId')
        if violation_id and violation_id in self.violations:
            violation_data = self.violations[violation_id]
            self._add_violation(doc, violation_data)

        # Рекурсивная обработка дочерних элементов
        children = item.get('children', [])
        for child in children:
            self._add_item(doc, child, level + 1)

    def _add_table(self, doc: Document, table_data: Dict):
        """
        Добавляет таблицу в документ с учетом объединенных ячеек.

        Args:
            doc: Документ DOCX
            table_data: Словарь с данными таблицы (rows)
        """
        rows = table_data.get('rows', [])

        if not rows:
            doc.add_paragraph('[Пустая таблица]')
            return

        # Вычисляем размерность таблицы с учетом colspan
        max_cols = 0
        for row in rows:
            cells = row.get('cells', [])
            col_count = 0
            for cell in cells:
                if not cell.get('merged', False):
                    col_count += cell.get('colspan', 1)
            max_cols = max(max_cols, col_count)

        if max_cols == 0:
            doc.add_paragraph('[Пустая таблица]')
            return

        num_rows = len(rows)

        # Создаем таблицу
        table = doc.add_table(rows=num_rows, cols=max_cols)
        table.style = 'Table Grid'

        # Заполняем таблицу
        for row_idx, row in enumerate(rows):
            cells = row.get('cells', [])
            col_idx = 0

            for cell_data in cells:
                if cell_data.get('merged', False):
                    continue

                if col_idx >= max_cols:
                    break

                cell = table.cell(row_idx, col_idx)
                cell.text = str(cell_data.get('content', ''))

                # Жирный шрифт для заголовков
                if cell_data.get('isHeader', False):
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            run.bold = True

                # Обработка объединения ячеек
                rowspan = cell_data.get('rowspan', 1)
                colspan = cell_data.get('colspan', 1)

                if rowspan > 1 or colspan > 1:
                    try:
                        end_row = min(row_idx + rowspan - 1, num_rows - 1)
                        end_col = min(col_idx + colspan - 1, max_cols - 1)
                        end_cell = table.cell(end_row, end_col)
                        cell.merge(end_cell)
                    except Exception:
                        pass

                # Переходим к следующей колонке с учетом colspan
                col_idx += colspan

        # Добавляем отступ после таблицы
        doc.add_paragraph()

    def _add_textblock(self, doc: Document, textblock_data: Dict):
        """
        Добавляет текстовый блок с форматированием в документ.

        Args:
            doc: Документ DOCX
            textblock_data: Словарь с содержимым и параметрами форматирования
        """
        content = textblock_data.get('content', '')
        formatting = textblock_data.get('formatting', {})

        if not content:
            return

        # Обрабатываем HTML с сохранением переносов строк
        content_with_breaks = re.sub(r'<br\s*/?>', '|||LINEBREAK|||', content)
        content_with_breaks = re.sub(r'</p>', '|||LINEBREAK|||', content_with_breaks)
        content_with_breaks = re.sub(r'</div>', '|||LINEBREAK|||', content_with_breaks)

        # Разбиваем по маркерам переноса
        paragraphs_content = content_with_breaks.split('|||LINEBREAK|||')

        for para_content in paragraphs_content:
            para_content = para_content.strip()
            if not para_content:
                continue

            # Создаем параграф
            paragraph = doc.add_paragraph()

            # Применяем выравнивание
            alignment = formatting.get('alignment', 'left')
            if alignment == 'center':
                paragraph.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
            elif alignment == 'right':
                paragraph.alignment = WD_PARAGRAPH_ALIGNMENT.RIGHT
            elif alignment == 'justify':
                paragraph.alignment = WD_PARAGRAPH_ALIGNMENT.JUSTIFY
            else:
                paragraph.alignment = WD_PARAGRAPH_ALIGNMENT.LEFT

            # Парсим HTML и применяем форматирование через runs
            parser = HTMLToDocxParser(paragraph)
            try:
                parser.feed(para_content)
                parser.close()
            except Exception:
                clean_text = re.sub(r'<[^>]+>', '', para_content)
                paragraph.add_run(clean_text)

            # Применяем базовое форматирование из formatting
            if paragraph.runs:
                if formatting.get('bold', False):
                    for run in paragraph.runs:
                        if not run.bold:
                            run.bold = True

                if formatting.get('italic', False):
                    for run in paragraph.runs:
                        if not run.italic:
                            run.italic = True

                if formatting.get('underline', False):
                    for run in paragraph.runs:
                        if not run.underline:
                            run.underline = True

                font_size = formatting.get('fontSize', 14)
                for run in paragraph.runs:
                    run.font.size = Pt(font_size)

    def _add_violation(self, doc: Document, violation_data: Dict):
        """
        Добавляет блок нарушения в документ БЕЗ заголовка "НАРУШЕНИЕ".

        Args:
            doc: Документ DOCX
            violation_data: Словарь с данными нарушения
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

        # Список описаний
        desc_list = violation_data.get('descriptionList', {})
        if desc_list.get('enabled', False):
            items = desc_list.get('items', [])
            if items:
                p = doc.add_paragraph()
                p.add_run('Описание:').bold = True
                for item in items:
                    if item.strip():
                        doc.add_paragraph(item, style='List Bullet')

        # Дополнительный текст
        additional_text = violation_data.get('additionalText', {})
        if additional_text.get('enabled', False):
            content = additional_text.get('content', '')
            if content:
                doc.add_paragraph(content)

        # Причины
        reasons = violation_data.get('reasons', {})
        if reasons.get('enabled', False):
            content = reasons.get('content', '')
            if content:
                p = doc.add_paragraph()
                p.add_run('Причины: ').bold = True
                p.add_run(content)

        # Последствия
        consequences = violation_data.get('consequences', {})
        if consequences.get('enabled', False):
            content = consequences.get('content', '')
            if content:
                p = doc.add_paragraph()
                p.add_run('Последствия: ').bold = True
                p.add_run(content)

        # Ответственные лица
        responsible = violation_data.get('responsible', {})
        if responsible.get('enabled', False):
            content = responsible.get('content', '')
            if content:
                p = doc.add_paragraph()
                p.add_run('Ответственные: ').bold = True
                p.add_run(content)

        # Добавляем отступ после нарушения
        doc.add_paragraph()
