"""Сервис аналитики чата (admin).

Композирует репозитории фидбэка и сообщений + классификатор маршрута, чтобы
дать витрину «что спрашивали / что ответили / почему ошибка / как оценили»:

* статистика обратной связи (всего/up/down/like_rate, срезы);
* список оценок (по умолчанию — дизлайки) с текстом ответа;
* инспектор диалога: сообщения с derive route_type/outcome и оценками всех
  пользователей.
"""

import logging

from app.domains.chat.repositories.chat_message_feedback_repository import (
    ChatMessageFeedbackRepository,
)
from app.domains.chat.repositories.message_repository import MessageRepository
from app.domains.chat.services import route_classifier

logger = logging.getLogger("audit_workstation.domains.chat.service.analytics")

# Поля строки оценки, безопасные к выдаче админу (без тяжёлого message_content).
_FEEDBACK_FIELDS = (
    "message_id", "conversation_id", "user_id", "rating", "reasons", "comment",
    "route_type", "agent_mode", "model", "created_at", "updated_at",
)

# Максимум сообщений в инспекторе диалога. Запас над лимитом создания
# (CHAT__MAX_MESSAGES_PER_CONVERSATION, default 500); диалог длиннее —
# усекается с явным флагом messages_truncated в ответе, не молча.
_INSPECT_MESSAGES_LIMIT = 10000

# Максимум символов текстового содержимого одного блока в выдаче инспектора:
# отдельный блок может быть очень большим (несколько МБ) — без усечения ответ
# admin-API раздувается до мегабайт. Усечённый блок помечается
# content_truncated=true.
_INSPECT_BLOCK_TEXT_LIMIT = 20000

_TRUNCATED_MARKER = " …[обрезано]"


class ChatAnalyticsService:
    """Аналитика чата для админ-просмотра. Только чтение."""

    def __init__(
        self,
        *,
        feedback_repo: ChatMessageFeedbackRepository,
        msg_repo: MessageRepository,
    ):
        self.feedback_repo = feedback_repo
        self.msg_repo = msg_repo

    async def get_stats(
        self,
        *,
        route_type: str | None = None,
        agent_mode: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> dict:
        """Сводные метрики обратной связи с опциональными фильтрами."""
        return await self.feedback_repo.get_stats(
            route_type=route_type, agent_mode=agent_mode,
            date_from=date_from, date_to=date_to,
        )

    async def list_feedback(
        self,
        *,
        rating: str | None = None,
        route_type: str | None = None,
        agent_mode: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Список оценок с предпросмотром текста ответа. Возвращает {items,total}."""
        items, total = await self.feedback_repo.list_feedback(
            rating=rating, route_type=route_type, agent_mode=agent_mode,
            date_from=date_from, date_to=date_to, limit=limit, offset=offset,
        )
        shaped = []
        for r in items:
            entry = {k: r.get(k) for k in _FEEDBACK_FIELDS}
            entry["message_status"] = r.get("message_status")
            entry["answer_text"] = self._extract_text(r.get("message_content"))
            shaped.append(entry)
        return {"items": shaped, "total": total, "limit": limit, "offset": offset}

    async def inspect_conversation(self, conversation_id: str) -> dict:
        """Полный диалог с derive route_type/outcome и оценками всех пользователей.

        Даёт админу контекст: что спрашивали (user-сообщения), что ответил
        ассистент (assistant content, включая error-блоки → «почему ошибка»),
        каким маршрутом и как оценено.
        """
        messages = await self.msg_repo.get_by_conversation(
            conversation_id, limit=_INSPECT_MESSAGES_LIMIT, offset=0,
        )
        fb_by_msg = await self.feedback_repo.get_all_for_conversation(conversation_id)

        out: list[dict] = []
        for m in messages:
            entry = {
                "id": m.get("id"),
                "role": m.get("role"),
                "status": m.get("status"),
                "model": m.get("model"),
                "token_usage": m.get("token_usage"),
                "created_at": m.get("created_at"),
                "agent_ref": m.get("agent_ref"),
                "content": self._shape_content(m.get("content")),
            }
            if m.get("role") == "assistant":
                entry["route_type"] = route_classifier.classify_route(m)
                entry["outcome"] = route_classifier.outcome(m)
                entry["feedback"] = [
                    {k: f.get(k) for k in _FEEDBACK_FIELDS}
                    for f in fb_by_msg.get(m.get("id"), [])
                ]
            out.append(entry)
        return {
            "conversation_id": conversation_id,
            "messages": out,
            # Явный признак усечения: молчаливая потеря хвоста длинного
            # диалога вводила бы админа в заблуждение.
            "messages_truncated": len(messages) >= _INSPECT_MESSAGES_LIMIT,
        }

    @staticmethod
    def _shape_content(content):
        """Копия content с усечением длинных текстовых блоков (только в выдаче).

        Исходные блоки не мутируются; усечённый блок получает
        ``content_truncated=True`` и маркер «…[обрезано]» в тексте.
        """
        if not isinstance(content, list):
            return content
        shaped = []
        for b in content:
            if (
                isinstance(b, dict)
                and isinstance(b.get("content"), str)
                and len(b["content"]) > _INSPECT_BLOCK_TEXT_LIMIT
            ):
                b = {
                    **b,
                    "content": b["content"][:_INSPECT_BLOCK_TEXT_LIMIT] + _TRUNCATED_MARKER,
                    "content_truncated": True,
                }
            shaped.append(b)
        return shaped

    @staticmethod
    def _extract_text(content) -> str:
        """Склеивает текстовое содержимое блоков ответа (для предпросмотра)."""
        if not isinstance(content, list):
            return ""
        parts: list[str] = []
        for b in content:
            if not isinstance(b, dict):
                continue
            t = b.get("type")
            if t in ("text", "reasoning") and b.get("content"):
                parts.append(str(b["content"]))
            elif t == "error" and b.get("message"):
                parts.append(f"[ошибка] {b['message']}")
        return "\n\n".join(parts)
