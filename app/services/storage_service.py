"""
Сервис для работы с хранилищем файлов.

Управляет сохранением, чтением и удалением файлов актов
в файловой системе.
"""

from datetime import datetime
from pathlib import Path
from typing import Optional

from docx import Document


class StorageService:
    """
    Сервис для сохранения актов в файловую систему.

    Обеспечивает уникальные имена файлов с временными метками
    и организует хранение в заданной директории.
    """

    def __init__(self, storage_dir: Optional[Path] = None):
        """
        Инициализация сервиса хранения.

        Args:
            storage_dir: Директория для хранения файлов актов.
                        Если None, используется путь из настроек.
        """
        if storage_dir is None:
            from app.core.config import Settings
            storage_dir = Settings().storage_dir

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
        filepath.write_text(content, encoding='utf-8')

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
