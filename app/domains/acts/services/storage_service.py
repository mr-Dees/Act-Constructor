"""
Сервис для работы с хранилищем файлов.

Управляет сохранением, чтением и удалением файлов актов
в файловой системе.
"""

import json
import logging
import secrets
from datetime import datetime
from pathlib import Path

from docx import Document

logger = logging.getLogger("act_constructor.service.storage")


class StorageService:
    """
    Сервис для сохранения актов в файловую систему.

    Обеспечивает уникальные имена файлов с временными метками
    и организует хранение в заданной директории.

    Note:
        Singleton не используется из-за thread-safety в uvicorn
        workers.
    """

    def __init__(self, storage_dir: Path | None = None):
        """
        Инициализация сервиса хранения.

        Args:
            storage_dir: Директория для хранения файлов актов.
                Если None, используется путь из настроек.
        """
        if storage_dir is None:
            from app.core.config import get_settings
            storage_dir = get_settings().storage_dir

        self.storage_dir = storage_dir
        # Создаем директорию, если её нет (включая родительские)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"StorageService инициализирован: {self.storage_dir}")

    def _generate_filename(self, prefix: str, extension: str) -> str:
        """
        Генерирует уникальное имя файла с временной меткой и случайным токеном.

        Формат: {prefix}_{YYYYMMDD_HHMMSS}_{hex_token}.{extension}

        Args:
            prefix: Префикс имени файла
            extension: Расширение файла (без точки)

        Returns:
            Уникальное имя файла
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        token = secrets.token_hex(4)
        return f"{prefix}_{timestamp}_{token}.{extension}"

    @property
    def _mapping_path(self) -> Path:
        """Путь к файлу маппинга filename → act_id."""
        return self.storage_dir / ".file_mapping.json"

    def _load_mapping(self) -> dict:
        """Загружает маппинг filename → act_id из JSON-файла."""
        if self._mapping_path.exists():
            try:
                return json.loads(self._mapping_path.read_text(encoding='utf-8'))
            except (json.JSONDecodeError, OSError):
                logger.warning("Не удалось прочитать маппинг файлов")
        return {}

    def _save_mapping(self, mapping: dict) -> None:
        """Сохраняет маппинг filename → act_id в JSON-файл."""
        try:
            self._mapping_path.write_text(
                json.dumps(mapping, ensure_ascii=False), encoding='utf-8'
            )
        except OSError:
            logger.exception("Не удалось сохранить маппинг файлов")

    def register_file(self, filename: str, act_id: int) -> None:
        """Регистрирует связь filename → act_id."""
        mapping = self._load_mapping()
        mapping[filename] = act_id
        self._save_mapping(mapping)

    def get_act_id_for_file(self, filename: str) -> int | None:
        """Возвращает act_id для файла или None."""
        mapping = self._load_mapping()
        return mapping.get(filename)

    def save(
            self,
            content: str,
            prefix: str = "act",
            extension: str = "txt"
    ) -> str:
        """
        Сохраняет текстовое содержимое в файл с временной меткой.

        Формат имени файла: {prefix}_{YYYYMMDD_HHMMSS}_{hex_token}.{extension}

        Args:
            content: Текстовое содержимое для сохранения
            prefix: Префикс имени файла
            extension: Расширение файла (без точки)

        Returns:
            Имя созданного файла (без полного пути)

        Raises:
            Exception: При ошибке записи файла
        """
        # Генерация уникального имени с временной меткой и токеном
        filename = self._generate_filename(prefix, extension)
        filepath = self.storage_dir / filename

        try:
            # Запись содержимого в файл с кодировкой UTF-8
            filepath.write_text(content, encoding='utf-8')
            logger.info(f"Файл успешно сохранен: {filename}")
            return filename
        except Exception as e:
            logger.exception(f"Ошибка сохранения файла {filename}: {e}")
            raise

    def save_docx(self, document: Document, prefix: str = "act") -> str:
        """
        Сохраняет документ DOCX в файл с временной меткой.

        Args:
            document: Объект Document из библиотеки python-docx
            prefix: Префикс имени файла

        Returns:
            Имя созданного файла (без полного пути)

        Raises:
            Exception: При ошибке сохранения документа
        """
        # Генерация уникального имени с временной меткой и токеном
        filename = self._generate_filename(prefix, "docx")
        filepath = self.storage_dir / filename

        try:
            # Сохранение документа через метод библиотеки python-docx
            document.save(str(filepath))
            logger.info(f"DOCX файл успешно сохранен: {filename}")
            return filename
        except Exception as e:
            logger.exception(f"Ошибка сохранения DOCX файла {filename}: {e}")
            raise

    def validate_filename(self, filename: str) -> bool:
        """
        Валидирует имя файла на безопасность.

        Проверяет:
        - Отсутствие path traversal символов (.. и /)
        - Непустое имя
        - Допустимые символы

        Args:
            filename: Имя файла для проверки

        Returns:
            True если имя безопасно
        """
        if not filename:
            return False

        # Запрещаем path traversal
        if ".." in filename or "/" in filename or "\\" in filename:
            logger.warning(f"Path traversal попытка обнаружена: {filename}")
            return False

        # Проверяем что файл будет внутри storage_dir
        try:
            filepath = (self.storage_dir / filename).resolve()
            if not str(filepath).startswith(str(self.storage_dir.resolve())):
                logger.warning(f"Попытка доступа вне storage_dir: {filename}")
                return False
        except Exception as e:
            logger.exception(f"Ошибка валидации пути {filename}: {e}")
            return False

        return True

    def get_file_path(self, filename: str) -> Path | None:
        """
        Получает безопасный путь к файлу после валидации.

        Args:
            filename: Имя файла

        Returns:
            Path если файл существует и безопасен, иначе None
        """
        if not self.validate_filename(filename):
            return None

        filepath = self.storage_dir / filename
        if not filepath.exists():
            logger.warning(f"Файл не найден: {filename}")
            return None

        return filepath
