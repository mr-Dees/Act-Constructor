"""Сервис обратной связи по сообщениям ассистента (лайк/дизлайк).

Валидирует оценку, выводит маршрут ответа (route_type) из сообщения,
сохраняет через репозиторий идемпотентно и пишет best-effort audit-событие.
"""

import logging

from app.core.chat.names import (
    AUDIT_FEEDBACK_CLEARED,
    AUDIT_FEEDBACK_SUBMITTED,
)
from app.domains.chat.exceptions import ChatFeedbackValidationError
from app.domains.chat.repositories.chat_message_feedback_repository import (
    ChatMessageFeedbackRepository,
)
from app.domains.chat.services import route_classifier
from app.domains.chat.services.chat_audit_service import ChatAuditService
from app.domains.chat.services.conversation_service import _get_user_lock

logger = logging.getLogger("audit_workstation.domains.chat.service.feedback")

# Допустимые оценки.
VALID_RATINGS: frozenset[str] = frozenset({"up", "down"})

# Словарь кодов причин дизлайка. Расширяемый — добавление кода НЕ требует
# миграции (reasons хранится в JSONB, без CHECK). Подписи — на фронте и в
# документации docs/guides/chat-observability-and-feedback.md.
FEEDBACK_REASON_CODES: frozenset[str] = frozenset({
    "inaccurate",     # Неточно / ошибка в ответе
    "not_relevant",   # Не по теме / не отвечает на вопрос
    "incomplete",     # Неполный ответ
    "not_from_kb",    # Выдумано / не из базы знаний
    "formatting",     # Плохое оформление
    "unsafe",         # Некорректно / небезопасно
    "other",          # Другое
})

# Максимальная длина свободного комментария.
MAX_COMMENT_LENGTH = 2000

# Допустимые значения снимка режима тумблера «База знаний ОАРБ» на оценке.
# Совпадают со значениями agent_mode в POST /messages (off/adaptive/always).
VALID_AGENT_MODES: frozenset[str] = frozenset({"off", "adaptive", "always"})


def feedback_public_dict(row: dict | None) -> dict | None:
    """Приводит строку обратной связи к минимальной форме для фронта.

    Только user-facing поля (без внутренних route_type/source) — для
    восстановления состояния кнопок и формы причин. None → None.
    """
    if not row:
        return None
    return {
        "rating": row.get("rating"),
        "reasons": row.get("reasons"),
        "comment": row.get("comment"),
        "updated_at": row.get("updated_at"),
    }


class ChatFeedbackService:
    """Бизнес-логика обратной связи по сообщениям ассистента."""

    def __init__(
        self,
        *,
        repo: ChatMessageFeedbackRepository,
        audit_service: ChatAuditService | None = None,
    ):
        self.repo = repo
        self.audit_service = audit_service

    @staticmethod
    def _validate_rating(rating: str) -> str:
        if rating not in VALID_RATINGS:
            raise ChatFeedbackValidationError(
                "Недопустимая оценка. Допустимые значения: «полезно» (up) "
                "или «не полезно» (down)."
            )
        return rating

    @staticmethod
    def _validate_reasons(reasons: list[str] | None) -> list[str] | None:
        """Проверяет коды причин, дедуплицирует. None/пусто → None."""
        if not reasons:
            return None
        if not isinstance(reasons, list) or not all(
            isinstance(r, str) for r in reasons
        ):
            raise ChatFeedbackValidationError(
                "Причины должны быть списком строковых кодов."
            )
        unknown = [r for r in reasons if r not in FEEDBACK_REASON_CODES]
        if unknown:
            raise ChatFeedbackValidationError(
                f"Неизвестные коды причин: {', '.join(sorted(set(unknown)))}."
            )
        # Дедуп с сохранением порядка.
        seen: set[str] = set()
        deduped = [r for r in reasons if not (r in seen or seen.add(r))]
        return deduped or None

    @staticmethod
    def _validate_agent_mode(agent_mode: str | None) -> str | None:
        """Проверяет снимок режима БЗ. None/пусто → None.

        Без валидации произвольная строка клиента сохранялась бы в
        ``chat_message_feedback.agent_mode`` и замусоривала срез by_agent_mode
        в админ-аналитике.
        """
        if agent_mode is None:
            return None
        if not isinstance(agent_mode, str):
            raise ChatFeedbackValidationError("Режим БЗ должен быть строкой.")
        agent_mode = agent_mode.strip()
        if not agent_mode:
            return None
        if agent_mode not in VALID_AGENT_MODES:
            raise ChatFeedbackValidationError(
                "Недопустимый режим БЗ. Допустимые значения: off, adaptive, always."
            )
        return agent_mode

    @staticmethod
    def _validate_comment(comment: str | None) -> str | None:
        if comment is None:
            return None
        if not isinstance(comment, str):
            raise ChatFeedbackValidationError("Комментарий должен быть строкой.")
        comment = comment.strip()
        if not comment:
            return None
        if len(comment) > MAX_COMMENT_LENGTH:
            raise ChatFeedbackValidationError(
                f"Комментарий слишком длинный (максимум {MAX_COMMENT_LENGTH} символов)."
            )
        return comment

    async def submit(
        self,
        *,
        message: dict,
        user_id: str,
        rating: str,
        reasons: list[str] | None = None,
        comment: str | None = None,
        agent_mode: str | None = None,
    ) -> dict:
        """Сохраняет оценку пользователя на сообщение ассистента.

        :param message: загруженная строка ``chat_messages`` (уже проверено
            владение беседой и принадлежность сообщения вызывающим API).
        :raises ChatFeedbackValidationError: невалидная оценка / роль / причины.
        :returns: сохранённая строка обратной связи.
        """
        rating = self._validate_rating(rating)
        agent_mode = self._validate_agent_mode(agent_mode)

        if message.get("role") != "assistant":
            raise ChatFeedbackValidationError(
                "Оценивать можно только ответы ассистента."
            )

        # Причины и комментарий имеют смысл только для дизлайка; для лайка —
        # форма не показывается (UX-практика), поэтому игнорируем.
        if rating == "down":
            reasons = self._validate_reasons(reasons)
            comment = self._validate_comment(comment)
        else:
            reasons = None
            comment = None

        conversation_id = message.get("conversation_id")
        message_id = message["id"]
        route_type = route_classifier.classify_route(message)
        model = message.get("model")

        # Сериализуем оценку одного пользователя на одно сообщение, чтобы
        # двойной клик не привёл к гонке INSERT/INSERT (паттерн message_service).
        async with _get_user_lock(user_id):
            saved = await self.repo.upsert(
                conversation_id=conversation_id,
                message_id=message_id,
                user_id=user_id,
                rating=rating,
                reasons=reasons,
                comment=comment,
                source="user",
                route_type=route_type,
                agent_mode=agent_mode,
                model=model,
            )

        if self.audit_service is not None:
            await self.audit_service.log_feedback(
                username=user_id,
                action=AUDIT_FEEDBACK_SUBMITTED,
                conversation_id=conversation_id,
                message_id=message_id,
                rating=rating,
                reasons=reasons,
                route_type=route_type,
            )
        return saved

    async def clear(
        self,
        *,
        conversation_id: str,
        message_id: str,
        user_id: str,
    ) -> None:
        """Снимает оценку пользователя на сообщение. Идемпотентно."""
        async with _get_user_lock(user_id):
            deleted = await self.repo.clear(
                message_id=message_id, user_id=user_id,
            )
        if deleted and self.audit_service is not None:
            await self.audit_service.log_feedback(
                username=user_id,
                action=AUDIT_FEEDBACK_CLEARED,
                conversation_id=conversation_id,
                message_id=message_id,
            )

    async def get_conversation_feedback_map(
        self, *, conversation_id: str, user_id: str,
    ) -> dict[str, dict]:
        """Карта ``message_id -> оценка`` пользователя в беседе (для истории)."""
        return await self.repo.get_map_for_conversation(
            conversation_id=conversation_id, user_id=user_id,
        )
