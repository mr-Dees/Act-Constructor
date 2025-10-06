"""Сервис для работы с хранилищем файлов."""

from pathlib import Path
from datetime import datetime
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

    def save(self, content: str, prefix: str = "act") -> str:
        """
        Сохраняет содержимое в файл с временной меткой.

        Args:
            content: Содержимое для сохранения
            prefix: Префикс имени файла

        Returns:
            Относительный путь к сохраненному файлу
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{prefix}_{timestamp}.txt"
        filepath = self.storage_dir / filename

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

        # Возвращаем относительный путь
        return str(filepath.relative_to(settings.base_dir))

    def get_all_acts(self) -> list[Path]:
        """
        Возвращает список всех сохраненных актов.

        Returns:
            Список путей к файлам актов
        """
        return sorted(self.storage_dir.glob("act_*.txt"), reverse=True)

    def read(self, filename: str) -> str:
        """
        Читает содержимое файла.

        Args:
            filename: Имя файла

        Returns:
            Содержимое файла

        Raises:
            FileNotFoundError: Если файл не найден
        """
        filepath = self.storage_dir / filename
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
