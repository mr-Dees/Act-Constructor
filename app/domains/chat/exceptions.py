"""Доменные исключения чата."""

from app.core.exceptions import AppError


class ConversationNotFoundError(AppError):
    """Беседа не найдена."""
    status_code = 404


class ChatFileNotFoundError(AppError):
    """Файл чата не найден."""
    status_code = 404


class ChatLimitError(AppError):
    """Превышен лимит (бесед, сообщений и т.д.)."""
    status_code = 422


class ChatFileValidationError(AppError):
    """Файл не проходит валидацию (размер, тип)."""
    status_code = 422


class ChatToolValidationError(AppError):
    """Вызов ChatTool не прошёл валидацию (например, отсутствует
    обязательный параметр)."""
    status_code = 400


class ChatStreamAlreadyActiveError(AppError):
    """У пользователя уже идёт активный SSE-стрим в чате.

    Защита от ситуации, когда фронт по ошибке открывает несколько
    одновременных стримов и забивает пул соединений к LLM.
    """
    status_code = 429


class ConversationLockedError(AppError):
    """Беседа заблокирована активным SSE-стримом и не может быть изменена.

    Бросается при попытке удалить беседу пользователя, у которого
    в данный момент идёт активный стрим — иначе генератор продолжит
    писать сообщения в уже удалённую беседу.
    """
    status_code = 409
