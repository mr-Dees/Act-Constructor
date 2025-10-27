"""
Сервис для работы с хранилищем файлов.

Управляет сохранением, чтением и удалением файлов актов
в файловой системе.
"""

from datetime import datetime
from pathlib import Path

from docx import Document

from app.core.config import settings


class StorageService:
    """
    Сервис для сохранения актов в файловую систему.

    Обеспечивает уникальные имена файлов с временными метками
    и организует хранение в заданной директории.
    """

    def __init__(self, storage_dir: Path = settings.storage_dir):
        """
        Инициализация сервиса хранения.

        Args:
            storage_dir: Директория для хранения файлов актов
        """
        self.storage_dir = storage_dir
        # Создаем директорию, если её нет (включая родительские)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def save(
            self,
            content: str,
            prefix: str = "act",
            extension: str = "txt"
    ) -> str:
        """
        Сохраняет текстовое содержимое в файл с временной меткой.

        Формат имени файла: {prefix}_{YYYYMMDD_HHMMSS}.{extension}

        Args:
            content: Текстовое содержимое для сохранения
            prefix: Префикс имени файла
            extension: Расширение файла (без точки)

        Returns:
            str: Имя созданного файла (без полного пути)
        """
        # Генерация уникального имени на основе текущего времени
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{prefix}_{timestamp}.{extension}"
        filepath = self.storage_dir / filename

        # Запись содержимого в файл с кодировкой UTF-8
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

        return filename

    def save_docx(self, document: Document, prefix: str = "act") -> str:
        """
        Сохраняет документ DOCX в файл с временной меткой.

        Args:
            document: Объект Document из библиотеки python-docx
            prefix: Префикс имени файла

        Returns:
            str: Имя созданного файла (без полного пути)
        """
        # Генерация уникального имени на основе текущего времени
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{prefix}_{timestamp}.docx"
        filepath = self.storage_dir / filename

        # Сохранение документа через метод библиотеки python-docx
        document.save(str(filepath))

        return filename

    def get_all_acts(self) -> list[Path]:
        """
        Возвращает список всех сохраненных актов.

        Ищет файлы с паттерном act_*.txt и act_*.docx
        и сортирует по дате модификации (новые первые).

        Returns:
            list[Path]: Список объектов Path к файлам актов
        """
        # Поиск всех текстовых файлов актов
        txt_files = list(self.storage_dir.glob("act_*.txt"))

        # Поиск всех DOCX файлов актов
        docx_files = list(self.storage_dir.glob("act_*.docx"))

        # Объединение и сортировка (новые первые)
        all_files = txt_files + docx_files
        return sorted(all_files, reverse=True)

    def read(self, filename: str) -> str:
        """
        Читает содержимое текстового файла акта.

        Args:
            filename: Имя файла для чтения

        Returns:
            str: Содержимое файла

        Raises:
            FileNotFoundError: Если файл не существует
        """
        filepath = self.storage_dir / filename

        # Проверка существования файла
        if not filepath.exists():
            raise FileNotFoundError(f"Файл {filename} не найден")

        # Чтение содержимого с кодировкой UTF-8
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()

    def delete(self, filename: str) -> bool:
        """
        Удаляет файл акта из хранилища.

        Args:
            filename: Имя файла для удаления

        Returns:
            bool: True если файл успешно удален, False если не найден

        Raises:
            PermissionError: Если недостаточно прав для удаления
        """
        filepath = self.storage_dir / filename

        # Проверка существования файла
        if not filepath.exists():
            return False

        # Удаление файла
        filepath.unlink()
        return True
