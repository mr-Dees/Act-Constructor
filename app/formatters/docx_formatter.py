"""
Форматер для создания актов в формате DOCX.

Преобразует структуру акта в документ Microsoft Word
с поддержкой таблиц, форматирования и иерархии.
"""

from html.parser import HTMLParser
from typing import Dict

from docx import Document
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
from docx.shared import Pt

from app.formatters.base_formatter import BaseFormatter


class HTMLToDocxParser(HTMLParser):
    """
    Парсер HTML для преобразования в форматирование DOCX.

    Обрабатывает базовые HTML-теги (b, i, u) и конвертирует
    их в соответствующие run-объекты python-docx с форматированием.
    """

    def __init__(self, paragraph):
        """
        Инициализация парсера.

        Args:
            paragraph: Объект параграфа python-docx для добавления runs
        """
        super().__init__()
        self.paragraph = paragraph  # Целевой параграф

        # Флаги активного форматирования
        self.bold = False
        self.italic = False
        self.underline = False

        # Буфер для накопления текста
        self.text_buffer = []

    def handle_starttag(self, tag, attrs):
        """
        Обработка открывающих HTML-тегов.

        Args:
            tag: Имя тега (например, 'b', 'i', 'u')
            attrs: Атрибуты тега (не используются)
        """
        # Сбрасываем буфер перед сменой форматирования
        self._flush_buffer()

        # Активация флагов форматирования
        if tag in ['b', 'strong']:
            self.bold = True
        elif tag in ['i', 'em']:
            self.italic = True
        elif tag == 'u':
            self.underline = True

    def handle_endtag(self, tag):
        """
        Обработка закрывающих HTML-тегов.

        Args:
            tag: Имя закрывающего тега
        """
        # Сбрасываем буфер перед сменой форматирования
        self._flush_buffer()

        # Деактивация флагов форматирования
        if tag in ['b', 'strong']:
            self.bold = False
        elif tag in ['i', 'em']:
            self.italic = False
        elif tag == 'u':
            self.underline = False

    def handle_data(self, data):
        """
        Обработка текстового содержимого между тегами.

        Args:
            data: Текстовое содержимое
        """
        # Накапливаем текст в буфере
        self.text_buffer.append(data)

    def _flush_buffer(self):
        """
        Сбрасывает накопленный текст в run с текущим форматированием.

        Обрабатывает переносы строк внутри текста.
        """
        if not self.text_buffer:
            return

        # Объединяем весь накопленный текст
        text = ''.join(self.text_buffer)
        self.text_buffer = []

        # Обрабатываем переносы строк
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if line:  # Добавляем только непустые строки
                # Создаем run с текущим форматированием
                run = self.paragraph.add_run(line)
                run.bold = self.bold
                run.italic = self.italic
                run.underline = self.underline

            # Добавляем перенос строки между частями (кроме последней)
            if i < len(lines) - 1:
                self.paragraph.add_run('\n')

    def close(self):
        """Завершение парсинга, сброс оставшегося буфера."""
        self._flush_buffer()
        super().close()


class DocxFormatter(BaseFormatter):
    """
    Форматер для преобразования структуры акта в документ DOCX.

    Рекурсивно обходит дерево структуры акта и создает
    документ Word с заголовками, таблицами, текстовыми блоками
    и блоками нарушений.
    """

    def __init__(self):
        """Инициализация форматера с пустыми хранилищами."""
        # Хранилища для быстрого доступа к связанным сущностям
        self.violations = {}
        self.textBlocks = {}
        self.tables = {}

    def format(self, data: Dict) -> Document:
        """
        Форматирует данные акта в документ DOCX.

        Args:
            data: Словарь с данными акта:
                - tree: древовидная структура
                - tables: словарь таблиц
                - textBlocks: словарь текстовых блоков
                - violations: словарь нарушений

        Returns:
            Document: Объект документа python-docx
        """
        # Создание нового документа Word
        doc = Document()

        # Сохраняем ссылки на сущности для доступа при рекурсии
        self.violations = data.get('violations', {})
        self.textBlocks = data.get('textBlocks', {})
        self.tables = data.get('tables', {})

        # Добавление главного заголовка акта по центру
        heading = doc.add_heading('Акт', level=0)
        heading.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER

        # Обработка дерева структуры акта
        tree = data.get('tree', {})
        root_children = tree.get('children', [])

        # Рекурсивная обработка каждого пункта верхнего уровня
        for item in root_children:
            self._add_item(doc, item, level=1)

        return doc

    def _add_item(self, doc: Document, item: Dict, level: int = 1):
        """
        Рекурсивно добавляет пункт акта в документ.

        Args:
            doc: Документ DOCX для добавления элементов
            item: Словарь с данными пункта (узла дерева)
            level: Уровень вложенности для заголовков (1-9)
        """
        # Извлечение метаданных пункта
        label = item.get('label', '')
        item_type = item.get('type', 'item')

        # Заголовок пункта (кроме textblock и violation)
        if label and item_type not in ['textblock', 'violation']:
            heading_level = min(level, 9)  # Ограничение уровня Word
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

        # Вычисление максимальной ширины таблицы с учетом colspan
        max_cols = 0
        for row in rows:
            cells = row.get('cells', [])
            col_count = 0
            for cell in cells:
                # Пропускаем объединенные ячейки
                if not cell.get('merged', False):
                    col_count += cell.get('colspan', 1)
            max_cols = max(max_cols, col_count)

        if max_cols == 0:
            doc.add_paragraph('[Пустая таблица]')
            return

        num_rows = len(rows)

        # Создание таблицы с сеткой
        table = doc.add_table(rows=num_rows, cols=max_cols)
        table.style = 'Table Grid'

        # Заполнение таблицы данными
        for row_idx, row in enumerate(rows):
            cells = row.get('cells', [])
            col_idx = 0

            for cell_data in cells:
                # Пропускаем объединенные ячейки (уже обработаны)
                if cell_data.get('merged', False):
                    continue

                if col_idx >= max_cols:
                    break

                # Заполнение ячейки
                cell = table.cell(row_idx, col_idx)
                cell.text = str(cell_data.get('content', ''))

                # Жирный шрифт для заголовков
                if cell_data.get('isHeader', False):
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            run.bold = True

                # Обработка объединения ячеек (rowspan/colspan)
                rowspan = cell_data.get('rowspan', 1)
                colspan = cell_data.get('colspan', 1)

                if rowspan > 1 or colspan > 1:
                    try:
                        # Вычисление конечной ячейки для объединения
                        end_row = min(row_idx + rowspan - 1, num_rows - 1)
                        end_col = min(col_idx + colspan - 1, max_cols - 1)
                        end_cell = table.cell(end_row, end_col)

                        # Объединение ячеек
                        cell.merge(end_cell)
                    except Exception:
                        # Игнорируем ошибки объединения
                        pass

                # Переход к следующей колонке с учетом colspan
                col_idx += colspan

        # Отступ после таблицы
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

        # Создание параграфа
        paragraph = doc.add_paragraph()

        # Применение выравнивания текста
        alignment = formatting.get('alignment', 'left')
        alignment_map = {
            'center': WD_PARAGRAPH_ALIGNMENT.CENTER,
            'right': WD_PARAGRAPH_ALIGNMENT.RIGHT,
            'justify': WD_PARAGRAPH_ALIGNMENT.JUSTIFY,
            'left': WD_PARAGRAPH_ALIGNMENT.LEFT
        }
        paragraph.alignment = alignment_map.get(
            alignment,
            WD_PARAGRAPH_ALIGNMENT.LEFT
        )

        # Парсинг HTML и добавление в параграф с форматированием
        parser = HTMLToDocxParser(paragraph)
        parser.feed(content)
        parser.close()

        # Применение размера шрифта ко всем runs в параграфе
        font_size = formatting.get('fontSize', 14)
        for run in paragraph.runs:
            run.font.size = Pt(font_size)

    def _add_violation(self, doc: Document, violation_data: Dict):
        """
        Добавляет блок нарушения в документ БЕЗ заголовка "НАРУШЕНИЕ".

        Структура блока:
        - Нарушено: <текст>
        - Установлено: <текст>
        - Описание: <буллитный список>
        - Дополнительный текст
        - Причины: <текст>
        - Последствия: <текст>
        - Ответственные: <текст>

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

        # Список описаний (буллитный)
        desc_list = violation_data.get('descriptionList', {})
        if desc_list.get('enabled', False):
            items = desc_list.get('items', [])
            if items:
                # Заголовок списка
                p = doc.add_paragraph()
                p.add_run('Описание:').bold = True

                # Элементы списка
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

        # Отступ после блока нарушения
        doc.add_paragraph()
