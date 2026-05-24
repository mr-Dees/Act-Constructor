"""SSE-форматирование событий для стримингового чата."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator, AsyncIterator
from dataclasses import dataclass, field
import json
from typing import Any

logger = logging.getLogger(__name__)

# SSE-комментарий: строки, начинающиеся с двоеточия, игнорируются клиентом
# (EventSource/SSE-парсер). Используется как heartbeat — даёт серверу повод
# вызвать write на сокет, чтобы uvicorn заметил оборванное соединение
# и подал http.disconnect в ASGI. Без heartbeat в silent-период (например,
# 5 минут polling'а внешнего агента без событий) клиентский abort не
# доходит до сервера, и orchestrator продолжает крутиться впустую,
# держа per-user-семафор и нагружая БД.
SSE_HEARTBEAT_PAYLOAD = ": keep-alive\n\n"

# Маркер усечения, добавляемый к последней delta при переполнении блока.
TRUNCATION_MARKER = "\n\n[…усечено: блок превысил {limit_mb:.1f} МБ…]"


def format_sse_event(event_type: str, data: dict[str, Any]) -> str:
    """Форматирует SSE-событие: event: {type}\\ndata: {json}\\n\\n."""
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event_type}\ndata: {payload}\n\n"


def sse_message_start(*, conversation_id: str, message_id: str) -> str:
    """Начало ответа ассистента."""
    return format_sse_event("message_start", {
        "conversation_id": conversation_id,
        "message_id": message_id,
    })


def sse_block_start(
    *,
    block_index: int,
    block_type: str,
    block_id: str | None = None,
) -> str:
    """Начало нового блока контента.

    ``block_id`` — детерминированный идентификатор блока (используется
    для дедупа при resume SSE: фронт хранит Set уже отрендеренных id и
    игнорирует повторы). Сейчас задаётся только для reasoning-блоков
    в forward-стриме (``f"{message_id}:reasoning:{seq}"``); для прочих
    блоков остаётся None — у них своя идемпотентность (ClientActionBlock
    имеет собственное поле block_id).
    """
    payload: dict[str, Any] = {
        "index": block_index,
        "type": block_type,
    }
    if block_id is not None:
        payload["block_id"] = block_id
    return format_sse_event("block_start", payload)


def sse_block_delta(*, block_index: int, delta: str) -> str:
    """Инкрементальное обновление блока (текстовый дельта)."""
    return format_sse_event("block_delta", {
        "index": block_index,
        "delta": delta,
    })


def sse_block_end(*, block_index: int) -> str:
    """Конец блока контента."""
    return format_sse_event("block_end", {
        "index": block_index,
    })


def sse_tool_call(
    *,
    tool_name: str,
    tool_call_id: str,
    arguments: dict[str, Any],
) -> str:
    """LLM вызвал инструмент."""
    return format_sse_event("tool_call", {
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
        "arguments": arguments,
    })


def sse_tool_result(
    *,
    tool_name: str,
    tool_call_id: str,
    result: str,
) -> str:
    """Результат выполнения инструмента."""
    return format_sse_event("tool_result", {
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
        "result": result[:500],  # лимитируем для SSE
    })


def sse_tool_error(
    *,
    tool_name: str,
    tool_call_id: str,
    message: str,
) -> str:
    """Ошибка вызова инструмента (валидация параметров, недопустимый tool).

    Отличается от ``sse_tool_result`` тем, что фронт показывает пользователю
    нейтральное сообщение и НЕ ожидает дальнейшего content по этому tool.
    """
    return format_sse_event("tool_error", {
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
        "message": message,
    })


def sse_buttons(*, buttons: list[dict[str, Any]]) -> str:
    """Кнопки действий для пользователя."""
    return format_sse_event("buttons", {
        "buttons": buttons,
    })


def sse_client_action(*, block: dict[str, Any]) -> str:
    """Команда фронту выполнить чисто-клиентское действие сразу.

    Содержит полный ClientActionBlock (action, params, label).
    Фронт исполняет команду через ClientActionsRegistry один раз.
    """
    return format_sse_event("client_action", {"block": block})


def sse_block_complete(*, block_index: int, block: dict[str, Any]) -> str:
    """Отдаёт цельный нестримуемый блок (file, image, plan, error, ...).

    Стримуемые типы (text, code, reasoning) передаются триплетом
    block_start/block_delta/block_end. Остальные блоки рендерятся
    разом из payload — этот хелпер и используется фронтом, чтобы
    показать их сразу при получении, не дожидаясь перезагрузки.
    """
    return format_sse_event("block_complete", {
        "index": block_index,
        "block": block,
    })


def sse_agent_request_started(
    *,
    request_id: str,
    conversation_id: str,
) -> str:
    """Сигнал фронту: forward-запрос зарегистрирован, его id известен.

    Фронт сохраняет request_id и после нормального завершения POST SSE
    (или при разрыве соединения) переключается на resume-стрим:
        GET /api/v1/chat/conversations/{cid}/forward-stream/{rid}
    """
    return format_sse_event("agent_request_started", {
        "request_id": request_id,
        "conversation_id": conversation_id,
    })


def sse_message_end(
    *,
    message_id: str,
    model: str | None = None,
    token_usage: dict[str, Any] | None = None,
) -> str:
    """Конец ответа ассистента."""
    return format_sse_event("message_end", {
        "message_id": message_id,
        "model": model,
        "token_usage": token_usage,
    })


def sse_error(*, error: str, code: str | None = None) -> str:
    """Ошибка во время обработки."""
    data: dict[str, Any] = {"error": error}
    if code:
        data["code"] = code
    return format_sse_event("error", data)


@dataclass
class BlockDeltaLimiter:
    """Аккумулятор delta-чанков одного стримуемого блока с защитой от
    self-DoS на гигантских чанках LLM.

    Состояние per-block, сбрасывается на каждый block_start (через
    повторное создание инстанса). Поддерживает два лимита:
    - chunk_flush_bytes — если буфер delta превышает порог, эмитим
      block_delta немедленно (поддерживая отзывчивость стрима).
    - block_max_bytes — общий потолок на блок. При превышении эмитим
      финальный delta с маркером усечения, block_end и помечаем блок
      как truncated. Последующие push'ы игнорируются.

    Размер измеряется в байтах UTF-8 (важно для русского/эмодзи).
    """

    block_index: int
    chunk_flush_bytes: int
    block_max_bytes: int
    block_type: str = "text"
    bytes_emitted: int = 0
    _buffer: str = ""
    _buffer_bytes: int = 0
    truncated: bool = field(default=False)
    closed: bool = field(default=False)

    def push(self, text: str) -> list[str]:
        """Принимает входящий чанк, возвращает готовые SSE-строки.

        Может вернуть от 0 до N событий: несколько block_delta
        (если чанк сам по себе больше flush-порога или вместе с
        буфером превысил лимит блока) и опционально финальный
        block_end (при усечении).
        """
        if self.closed or not text:
            return []

        events: list[str] = []
        remaining = text
        while remaining:
            piece, remaining = self._take_piece(remaining)
            if not piece:
                break
            self._buffer += piece
            self._buffer_bytes += len(piece.encode("utf-8"))
            # Если очередной flush перевалит block_max_bytes —
            # вместо обычного flush'а уходим в truncate (он сам
            # эмитит остаток в пределах лимита + маркер + end).
            if (
                self.bytes_emitted + self._buffer_bytes
                > self.block_max_bytes
            ):
                events.extend(self._truncate_and_close())
                return events
            if self._buffer_bytes >= self.chunk_flush_bytes:
                events.extend(self._flush())
        return events

    def flush_remaining(self) -> list[str]:
        """Возвращает остатки буфера как финальный block_delta.

        Вызывается перед block_end в нормальном потоке (без усечения).
        """
        if self.closed:
            return []
        return self._flush()

    # -- внутренние помощники -----------------------------------------

    def _take_piece(self, text: str) -> tuple[str, str]:
        """Откусывает кусок не больше flush-порога, по границе UTF-8.

        Гарантирует, что мы не разрежем многобайтовый символ пополам.
        """
        encoded = text.encode("utf-8")
        if len(encoded) <= self.chunk_flush_bytes:
            return text, ""
        # Откусываем не больше chunk_flush_bytes байт, отступая назад
        # до валидной UTF-8 границы.
        cut = self.chunk_flush_bytes
        # Не разрезаем последовательность continuation-байтов (10xxxxxx).
        while cut > 0 and (encoded[cut] & 0xC0) == 0x80:
            cut -= 1
        head = encoded[:cut].decode("utf-8")
        tail = encoded[cut:].decode("utf-8")
        return head, tail

    def _flush(self) -> list[str]:
        """Эмитит накопленный буфер как block_delta, обнуляет буфер."""
        if not self._buffer:
            return []
        delta = self._buffer
        delta_bytes = self._buffer_bytes
        self._buffer = ""
        self._buffer_bytes = 0
        self.bytes_emitted += delta_bytes
        return [sse_block_delta(block_index=self.block_index, delta=delta)]

    def _truncate_and_close(self) -> list[str]:
        """Эмитит остаток в пределах лимита + маркер + block_end."""
        events: list[str] = []
        # Сколько ещё байт можно эмитить, чтобы не выйти за лимит.
        room = max(0, self.block_max_bytes - self.bytes_emitted)
        if self._buffer and room > 0:
            piece = self._take_within_bytes(self._buffer, room)
            if piece:
                events.append(
                    sse_block_delta(
                        block_index=self.block_index, delta=piece,
                    ),
                )
                self.bytes_emitted += len(piece.encode("utf-8"))
        self._buffer = ""
        self._buffer_bytes = 0
        marker = TRUNCATION_MARKER.format(
            limit_mb=self.block_max_bytes / (1024 * 1024),
        )
        events.append(
            sse_block_delta(block_index=self.block_index, delta=marker),
        )
        events.append(sse_block_end(block_index=self.block_index))
        self.truncated = True
        self.closed = True
        logger.warning(
            "SSE-блок усечён",
            extra={
                "block_type": self.block_type,
                "bytes_emitted": self.bytes_emitted,
                "limit": self.block_max_bytes,
            },
        )
        return events

    @staticmethod
    def _take_within_bytes(text: str, max_bytes: int) -> str:
        """Возвращает префикс text, помещающийся в max_bytes (UTF-8).

        Уважает границу многобайтового символа.
        """
        if max_bytes <= 0:
            return ""
        encoded = text.encode("utf-8")
        if len(encoded) <= max_bytes:
            return text
        cut = max_bytes
        while cut > 0 and (encoded[cut] & 0xC0) == 0x80:
            cut -= 1
        return encoded[:cut].decode("utf-8")


def emit_text_block_with_limit(
    *,
    block_index: int,
    block_type: str,
    text: str,
    chunk_flush_bytes: int,
    block_max_bytes: int,
    block_id: str | None = None,
) -> list[str]:
    """Сериализует готовый текстовый блок в триплет
    block_start + (block_delta)* + block_end, применяя лимиты.

    Используется для блоков, текст которых уже известен целиком
    (non-streaming ответ LLM, текстовые блоки от tool-handler'ов).
    Большие блоки нарезаются на несколько delta, переполненные — усекаются
    с маркером.

    ``block_id`` пробрасывается в ``sse_block_start``: для reasoning-блоков
    от внешнего агента (forward-стрим) это id вида ``f"{message_id}:reasoning:{seq}"``,
    по которому фронт дедупит повторы при reconnect/reload.
    """
    events: list[str] = [
        sse_block_start(
            block_index=block_index,
            block_type=block_type,
            block_id=block_id,
        ),
    ]
    limiter = BlockDeltaLimiter(
        block_index=block_index,
        chunk_flush_bytes=chunk_flush_bytes,
        block_max_bytes=block_max_bytes,
        block_type=block_type,
    )
    events.extend(limiter.push(text))
    if not limiter.closed:
        events.extend(limiter.flush_remaining())
        events.append(sse_block_end(block_index=block_index))
    return events


async def with_heartbeat(
    source: AsyncIterator[str],
    *,
    interval_sec: float = 7.0,
) -> AsyncGenerator[str, None]:
    """Прозрачно прокидывает SSE-стрим, вставляя heartbeat'ы в тишине.

    Если ``source`` молчит дольше ``interval_sec`` — yield-ит
    :data:`SSE_HEARTBEAT_PAYLOAD`. Это заставляет uvicorn выполнить
    реальный write на сокет; для оборванного соединения write поднимет
    EOF и ASGI пробросит ``http.disconnect``, что в свою очередь
    отменит StreamingResponse-генератор. Без этого silent-периоды
    (polling внешнего ИИ-агента) держат серверный orchestrator живым
    до 5-минутного таймаута, даже если клиент давно ушёл.

    Источник крутится в отдельной задаче через ``asyncio.Queue`` —
    так heartbeat не прерывает текущий ``await`` источника (типа
    ``poll_events``-SQL), а просто сосуществует с ним. Это безопаснее,
    чем ``asyncio.wait_for(source.__anext__())``, которая отменила бы
    активную транзакцию.
    """
    queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

    async def _drain() -> None:
        try:
            async for item in source:
                await queue.put(("item", item))
        except BaseException as exc:  # CancelledError тоже сюда
            await queue.put(("error", exc))
            return
        await queue.put(("done", None))

    drainer = asyncio.create_task(_drain(), name="sse-heartbeat-drain")
    try:
        while True:
            try:
                kind, value = await asyncio.wait_for(
                    queue.get(), timeout=interval_sec,
                )
            except asyncio.TimeoutError:
                yield SSE_HEARTBEAT_PAYLOAD
                continue
            if kind == "item":
                yield value
            elif kind == "done":
                return
            else:  # "error"
                raise value
    finally:
        if not drainer.done():
            drainer.cancel()
        try:
            await drainer
        except BaseException:
            pass
