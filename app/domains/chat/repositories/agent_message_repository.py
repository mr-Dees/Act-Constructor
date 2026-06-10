"""Репозиторий bus-таблицы chat_agent_messages_bus (канал к внешнему агенту)."""

import json
import logging
import uuid

import asyncpg

from app.db.repositories.base import BaseRepository
from app.domains.chat.settings import resolve_bus_schema

logger = logging.getLogger("audit_workstation.domains.chat.repo.agent_message")

# Поля, хранящиеся как JSONB и требующие десериализации при чтении.
_JSONB_FIELDS = ("media", "metadata", "buttons")

# Поля типа UUID на стороне владельца таблицы (внешний агент). asyncpg отдаёт
# их объектами uuid.UUID — нормализуем в str, чтобы остальной код (agent_ref,
# block_id, сравнения с question_uid) работал со строками.
_UUID_FIELDS = ("id", "reply_to")


class AgentMessageRepository(BaseRepository):
    """CRUD-операции с bus-таблицей chat_agent_messages_bus.

    Структуру таблицы задаёт сторона внешнего агента (владелец):
    ``id`` (UUID) — uid одного сообщения шины (на него ссылается ``reply_to``
    и его же хранит ``chat_messages.agent_ref``); ``chat_id`` — uid треда
    (= ``chat_messages.conversation_id``). Отдельной колонки ``conversation_id``
    в шине НЕТ.
    """

    def __init__(
        self,
        conn: asyncpg.Connection,
        table_name: str = "chat_agent_messages_bus",
        schema: str | None = None,
    ):
        super().__init__(conn)
        # schema=None → резолвим из настроек (agent_channel → chat → основная).
        bus_schema = resolve_bus_schema() if schema is None else schema
        # qualify_table_name (НЕ get_table_name): к bus-таблице НЕ клеится
        # префикс приложения (DATABASE__TABLE_PREFIX). Имя задаётся настройкой
        # table_name целиком — шина общая с внешним агентом, её именование вне
        # префикс-схемы AW. Нужен префикс → вписать его в table_name руками.
        self.table = self.adapter.qualify_table_name(table_name, schema=bus_schema)

    @staticmethod
    def _parse_row(row) -> dict | None:
        """Парсит JSONB-поля в Python-объекты, UUID-поля — в str."""
        if row is None:
            return None
        result = dict(row)
        for key in _JSONB_FIELDS:
            val = result.get(key)
            if isinstance(val, str):
                try:
                    result[key] = json.loads(val)
                except json.JSONDecodeError:
                    result[key] = None
        for key in _UUID_FIELDS:
            val = result.get(key)
            if isinstance(val, uuid.UUID):
                result[key] = str(val)
        return result

    async def insert_question(
        self,
        *,
        id: str,
        chat_id: str,
        user_id: str,
        content: str,
        metadata: dict | None = None,
        media: list | None = None,
    ) -> dict:
        """Вставляет строку-вопрос от AW к агенту со статусом 'pending'.

        ``id`` — uid сообщения-вопроса (его же хранит ``chat_messages.agent_ref``).
        created_at/updated_at передаются явно: таблица чужая, DEFAULT'ы на её
        стороне не гарантированы, а колонки NOT NULL.

        Возвращает вставленную запись со всеми колонками.
        """
        row = await self.conn.fetchrow(
            f"""
            INSERT INTO {self.table}
                (id, chat_id, user_id, role, content, media, metadata,
                 status, created_at, updated_at)
            VALUES ($1, $2, $3, 'user', $4, $5::jsonb, $6::jsonb,
                    'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
            """,
            id,
            chat_id,
            user_id,
            content,
            json.dumps(media, ensure_ascii=False) if media is not None else None,
            json.dumps(metadata or {}, ensure_ascii=False),
        )
        return self._parse_row(row)

    async def get_by_uid(self, uid: str) -> dict | None:
        """Возвращает строку по id (uid одного сообщения шины)."""
        row = await self.conn.fetchrow(
            f"SELECT * FROM {self.table} WHERE id = $1",
            uid,
        )
        return self._parse_row(row)

    async def get_answer_for_question(self, question_uid: str) -> dict | None:
        """Возвращает строку-ответ агента на вопрос ``question_uid``.

        Протокол владельца шины: агент вставляет строку-ответ
        (role='assistant') и проставляет ``reply_to`` НА ОТВЕТЕ, указывая на
        id вопроса. Берём самый свежий ответ (агент может ретраить).
        """
        row = await self.conn.fetchrow(
            f"SELECT * FROM {self.table} "
            f"WHERE reply_to = $1 AND role = 'assistant' "
            f"ORDER BY created_at DESC LIMIT 1",
            question_uid,
        )
        return self._parse_row(row)

    async def get_questions(self, uids: list[str]) -> list[dict]:
        """Возвращает строки по списку id (uid сообщений).

        Пустой список uids → возвращает [] без обращения к БД.
        ``ANY($1)`` без явного каста: тип элементов массива Postgres выводит
        из типа колонки ``id`` (uuid на проде, что угодно на dev-стенде).
        """
        if not uids:
            return []
        rows = await self.conn.fetch(
            f"SELECT * FROM {self.table} WHERE id = ANY($1)",
            uids,
        )
        return [self._parse_row(r) for r in rows]

    async def set_status(self, *, uid: str, status: str) -> None:
        """Обновляет статус строки по id (uid сообщения)."""
        await self.conn.execute(
            f"UPDATE {self.table} SET status = $1, updated_at = CURRENT_TIMESTAMP "
            f"WHERE id = $2",
            status,
            uid,
        )

    async def count_active_for_user(self, user_id: str, *, created_after=None) -> int:
        """Считает активные вопросы пользователя в bus-таблице.

        Активные статусы: 'pending' / 'processing' (словарь владельца таблицы;
        'in_progress' — legacy-синоним для старых dev-строк). Фильтр role='user'
        оставляет в счёте только строки-вопросы от AW: ответы агента
        (role='assistant') не должны влиять на лимит параллельных запросов.

        ``created_after`` (tz-aware datetime) отсекает старые зависшие строки:
        терминальный статус на чужой таблице может не записаться (CHECK
        владельца), и без отсечки мёртвый вопрос навсегда съедал бы слот лимита.
        """
        if created_after is not None:
            val = await self.conn.fetchval(
                f"SELECT COUNT(*) FROM {self.table} "
                f"WHERE user_id = $1 AND role = 'user' "
                f"AND status IN ('pending', 'processing', 'in_progress') "
                f"AND created_at > $2",
                user_id,
                created_after,
            )
        else:
            val = await self.conn.fetchval(
                f"SELECT COUNT(*) FROM {self.table} "
                f"WHERE user_id = $1 AND role = 'user' "
                f"AND status IN ('pending', 'processing', 'in_progress')",
                user_id,
            )
        return int(val or 0)
