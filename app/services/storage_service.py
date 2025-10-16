"""Сервис для работы с хранилищем файлов."""

from datetime import datetime
from pathlib import Path

from docx import Document

from app.core.config import settings


class StorageService:
    """Сервис для сохранения актов в файловую систему."""

    def __init__(self, storage_dir: Path = settings.storage_dir):
        """
        Инициализация сервиса хранения.

        Args:
            storage_dir: Директория для хранения файлов
        """
        self.storage_dir = storage_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def save(self, content: str, prefix: str = "act", extension: str = "txt") -> str:
        """
        Сохраняет текстовое содержимое в файл с временной меткой.

        Args:
            content: Содержимое для сохранения
            prefix: Префикс имени файла
            extension: Расширение файла

        Returns:
            Имя файла (без пути)
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{prefix}_{timestamp}.{extension}"
        filepath = self.storage_dir / filename

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

        # Возвращаем только имя файла
        return filename

    def save_docx(self, document: Document, prefix: str = "act") -> str:
        """
        Сохраняет документ DOCX в файл с временной меткой.

        Args:
            document: Документ python-docx для сохранения
            prefix: Префикс имени файла

        Returns:
            Имя файла (без пути)
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{prefix}_{timestamp}.docx"
        filepath = self.storage_dir / filename

        document.save(str(filepath))

        # Возвращаем только имя файла
        return filename

    def get_all_acts(self) -> list[Path]:
        """
        Возвращает список всех сохраненных актов.

        Returns:
            Список путей к файлам актов (отсортированы по дате, новые первые)
        """
        txt_files = list(self.storage_dir.glob("act_*.txt"))
        docx_files = list(self.storage_dir.glob("act_*.docx"))
        all_files = txt_files + docx_files

        return sorted(all_files, reverse=True)

    def read(self, filename: str) -> str:
        """
        Читает содержимое текстового файла.

        Args:
            filename: Имя файла

        Returns:
            Содержимое файла

        Raises:
            FileNotFoundError: Если файл не найден
        """
        filepath = self.storage_dir / filename
        if not filepath.exists():
            raise FileNotFoundError(f"Файл {filename} не найден")

        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()

    def delete(self, filename: str) -> bool:
        """
        Удаляет файл акта.

        Args:
            filename: Имя файла для удаления

        Returns:
            True если файл успешно удален, False если файл не найден

        Raises:
            PermissionError: Если недостаточно прав для удаления
        """
        filepath = self.storage_dir / filename
        if not filepath.exists():
            return False

        filepath.unlink()
        return True
