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
    """
    Парсер HTML для преобразования в форматирование DOCX.

    Обрабатывает базовые HTML-теги (b/strong, i/em, u) и конвертирует
    их в соответствующие run-объекты python-docx с применением
    жирного начертания, курсива и подчеркивания.
    Корректно обрабатывает переносы строк (\n).
    """

    def __init__(self, paragraph):
        """
        Инициализация парсера.

        Args:
            paragraph: Объект параграфа python-docx для добавления форматированных runs
        """
        super().__init__()
        self.paragraph = paragraph
        # Флаги текущего состояния форматирования
        self.bold = False
        self.italic = False
        self.underline = False
        # Буфер для накопления текста перед добавлением в run
        self.text_buffer = []

    def handle_starttag(self, tag, attrs):
        """
        Обработка открывающих HTML-тегов.
        Сбрасывает буфер и устанавливает флаги форматирования.

        Args:
            tag: Имя тега (b, i, u и т.д.)
            attrs: Атрибуты тега (не используются)
        """
        self._flush_buffer()
        if tag in ['b', 'strong']:
            self.bold = True
        elif tag in ['i', 'em']:
            self.italic = True
        elif tag == 'u':
            self.underline = True

    def handle_endtag(self, tag):
        """
        Обработка закрывающих HTML-тегов.
        Сбрасывает буфер и снимает флаги форматирования.

        Args:
            tag: Имя закрывающегося тега
        """
        self._flush_buffer()
        if tag in ['b', 'strong']:
            self.bold = False
        elif tag in ['i', 'em']:
            self.italic = False
        elif tag == 'u':
            self.underline = False

    def handle_data(self, data):
        """
        Обработка текстового содержимого между тегами.
        Добавляет текст в буфер для последующего форматирования.

        Args:
            data: Текстовое содержимое
        """
        self.text_buffer.append(data)

    def _flush_buffer(self):
        """
        Сбрасывает накопленный текст в run с текущим форматированием.
        Корректно обрабатывает переносы строк, разбивая текст на части.
        """
        if not self.text_buffer:
            return

        text = ''.join(self.text_buffer)
        self.text_buffer = []

        # Разбиваем текст по переносам строк
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if line:
                # Создаем run с текущим форматированием
                run = self.paragraph.add_run(line)
                run.bold = self.bold
                run.italic = self.italic
                run.underline = self.underline

            # Добавляем перенос строки между частями (кроме последней)
            if i < len(lines) - 1:
                self.paragraph.add_run('\n')

    def close(self):
        """
        Завершение парсинга HTML.
        Сбрасывает оставшийся буфер и вызывает родительский close().
        """
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
        Парсит HTML-содержимое (b, i, u теги) и применяет форматирование
        к runs. Также применяет выравнивание и размер шрифта.

        Args:
            doc: Документ DOCX
            textblock_data: Словарь с данными текстового блока:
                - content: HTML-содержимое
                - formatting: объект с параметрами форматирования
                  (alignment, fontSize, bold, italic, underline)
        """
        content = textblock_data.get('content', '')
        formatting = textblock_data.get('formatting', {})

        if not content:
            return

        paragraph = doc.add_paragraph()

        # Применение выравнивания текста (left, center, right, justify)
        alignment = formatting.get('alignment', 'left')
        alignment_map = {
            'center': WD_PARAGRAPH_ALIGNMENT.CENTER,
            'right': WD_PARAGRAPH_ALIGNMENT.RIGHT,
            'justify': WD_PARAGRAPH_ALIGNMENT.JUSTIFY,
            'left': WD_PARAGRAPH_ALIGNMENT.LEFT
        }
        paragraph.alignment = alignment_map.get(alignment, WD_PARAGRAPH_ALIGNMENT.LEFT)

        # Парсинг HTML и добавление в параграф с форматированием через runs
        parser = HTMLToDocxParser(paragraph)
        parser.feed(content)
        parser.close()

        # Применение размера шрифта ко всем runs параграфа
        font_size = formatting.get('fontSize', 14)
        for run in paragraph.runs:
            run.font.size = Pt(font_size)

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
                            doc.add_picture(image_stream, width=Inches(4))

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
