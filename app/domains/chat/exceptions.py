"""Доменные исключения чата."""

from typing import ClassVar

from app.core.exceptions import AppError


class ConversationNotFoundError(AppError):
    """Беседа не найдена."""
    status_code = 404
    code: ClassVar[str] = "conversation-not-found"


class ChatMessageNotFoundError(AppError):
    """Сообщение чата не найдено."""
    status_code = 404
    code: ClassVar[str] = "chat-message-not-found"


class ChatFileNotFoundError(AppError):
    """Файл чата не найден."""
    status_code = 404
    code: ClassVar[str] = "chat-file-not-found"


class ChatLimitError(AppError):
    """Превышен лимит (бесед, сообщений и т.д.)."""
    status_code = 422
    code: ClassVar[str] = "chat-limit-exceeded"


class ChatFileValidationError(AppError):
    """Файл не проходит валидацию (размер, тип)."""
    status_code = 422
    code: ClassVar[str] = "chat-file-validation"


class ChatToolValidationError(AppError):
    """Вызов ChatTool не прошёл валидацию (например, отсутствует
    обязательный параметр)."""
    status_code = 400
    code: ClassVar[str] = "chat-tool-validation"


class ChatStreamAlreadyActiveError(AppError):
    """У пользователя уже идёт активный SSE-стрим в чате.

    Защита от ситуации, когда фронт по ошибке открывает несколько
    одновременных стримов и забивает пул соединений к LLM.
    """
    status_code = 429
    code: ClassVar[str] = "chat-stream-already-active"


class ConversationLockedError(AppError):
    """Беседа заблокирована активным SSE-стримом и не может быть изменена.

    Бросается при попытке удалить беседу пользователя, у которого
    в данный момент идёт активный стрим — иначе генератор продолжит
    писать сообщения в уже удалённую беседу.
    """
    status_code = 409
    code: ClassVar[str] = "conversation-locked"


class OptimisticLockFailed(AppError):
    """Optimistic locking конфликт при финализации agent_request.

    Бросается внутри транзакции в agent_bridge_runner._run, когда
    finalize обнаруживает, что версия строки уже изменена другим
    воркером. Транзакция откатывается, assistant-message НЕ сохраняется,
    статус остаётся in_progress — reconcile подхватит при следующем старте.
    """
    status_code = 409
    code: ClassVar[str] = "chat-optimistic-lock-failed"


class ChatRateLimitError(AppError):
    """Превышен per-user rate-limit на отправку сообщений.

    Бросается, когда пользователь превышает лимит сообщений за скользящее
    окно 60 секунд (настраивается через CHAT__RATE_LIMIT_MESSAGES_PER_MINUTE_PER_USER).
    """
    status_code = 429
    code: ClassVar[str] = "chat-rate-limit"

    def __init__(self, message: str, retry_after_sec: int = 60) -> None:
        super().__init__(message)
        self.retry_after_sec = retry_after_sec
        self.extra = {"retry_after_sec": retry_after_sec}
